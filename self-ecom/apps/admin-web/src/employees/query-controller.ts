/** 文件作用：管理员工查询的内存状态、取消、失效和会话隔离。 */
import { ApiClientError, type AuthSessionStore, type ApiResponse } from '@shop/api-client';

interface QuerySnapshot<Data> {
  readonly key: string | null;
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly data: Data | null;
  readonly error: ApiClientError | null;
}

/** 查询只保存在内存，切换登录即清空；403在权限刷新重挂载后等待手动重试。 */
export class EmployeeQueryController<Input, Data> {
  private snapshot: QuerySnapshot<Data> = Object.freeze({ key: null, status: 'idle', data: null, error: null });
  private readonly session: AuthSessionStore;
  private readonly fetch: (input: Input, signal: AbortSignal) => Promise<ApiResponse<Data>>;
  private readonly listeners = new Set<() => void>();
  private readonly stopSession: () => void;
  private revision: number;
  private generation = 0;
  private abort: AbortController | null = null;
  private pending: Promise<void> | null = null;
  private lastRead: { key: string; input: Input } | null = null;
  private readonly failureMessage: string;
  private readonly preserveOnRefresh: boolean;

  constructor(session: AuthSessionStore, fetch: (input: Input, signal: AbortSignal) => Promise<ApiResponse<Data>>,
    failureMessage = '员工信息读取失败，请重试',preserveOnRefresh=false) {
    this.preserveOnRefresh = preserveOnRefresh;
    this.failureMessage = failureMessage;
    this.session = session; this.fetch = fetch; this.revision = session.getSnapshot().revision;
    this.stopSession = session.subscribe(() => {
      const current = session.getSnapshot().revision;
      if (current === this.revision) return;
      this.revision = current; this.generation++; this.abort?.abort(); this.pending = null; this.lastRead = null;
      this.update({ key: null, status: 'idle', data: null, error: null });
    });
  }

  getSnapshot = (): QuerySnapshot<Data> => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  };

  read = (key: string, input: Input, force = false): Promise<void> => {
    if (!this.session.current().credential) return Promise.resolve();
    this.lastRead = { key, input };
    if (!force && key === this.snapshot.key) {
      if (this.pending) return this.pending;
      if (this.snapshot.error?.status === 403) return Promise.resolve();
    }
    const generation = ++this.generation; const revision = this.session.getSnapshot().revision;
    this.abort?.abort(); const abort = new AbortController(); this.abort = abort;
    const data=this.preserveOnRefresh&&key===this.snapshot.key?this.snapshot.data:null;
    this.update({ key, status: 'loading', data, error: null });
    const task = this.load(key, input, abort.signal, revision, generation).finally(() => { if (this.pending === task) this.pending = null; });
    this.pending = task; return task;
  };

  /** 写入后只失效指定员工；活跃页面重读，迟到的旧查询不能恢复旧版本。 */
  invalidate = (key?: string): Promise<void> => {
    if (key !== undefined && this.snapshot.key !== key) return Promise.resolve();
    const previous = this.lastRead;
    this.generation++; this.abort?.abort(); this.pending = null;
    if(this.preserveOnRefresh&&previous&&this.listeners.size)return this.read(previous.key,previous.input,true);
    this.update({ key: null, status: 'idle', data: null, error: null });
    return previous && this.listeners.size ? this.read(previous.key, previous.input, true) : Promise.resolve();
  };

  private async load(key: string, input: Input, signal: AbortSignal, revision: number, generation: number) {
    const isCurrent = () => generation === this.generation && revision === this.session.current().revision;
    try {
      const { data } = await this.fetch(input, signal);
      if (isCurrent()) this.update({ key, status: 'ready', data, error: null });
    } catch (error) {
      if (isCurrent()) this.update({ key, status: 'error', data: null,
        error: error instanceof ApiClientError ? error : new ApiClientError('REQUEST_FAILED', this.failureMessage) });
    }
  }

  dispose = () => { this.stopSession(); this.generation++; this.abort?.abort(); this.listeners.clear(); };

  private update(value: QuerySnapshot<Data>) {
    this.snapshot = Object.freeze(value); for (const listener of this.listeners) listener();
  }
}
