/** 文件作用：防止任务重复提交，隔离旧会话响应；冲突和不确定结果必须先重新读取，绝不自动重发写入。 */
import { ApiClientError, type ApiResponse, type AuthSessionStore } from '@shop/api-client';
import type { runEmployeeMutation } from '../employees/management';
interface MutationState { sending: boolean; blocked: 'conflict' | 'uncertain' | null; error: unknown }
export class TaskMutationController {
  private state: MutationState = { sending: false, blocked: null, error: null };
  private generation = 0; private disposed = false;
  private readonly listeners = new Set<() => void>();
  private readonly session: AuthSessionStore;
  private readonly mutate: typeof runEmployeeMutation;
  constructor(session: AuthSessionStore, mutate: typeof runEmployeeMutation) { this.session = session; this.mutate = mutate; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  async submit<Data>(send: () => Promise<ApiResponse<Data>>, saved: (data: Data) => void) {
    if (this.disposed || this.state.sending || this.state.blocked || !this.session.current().credential) return;
    const generation = ++this.generation; const revision = this.session.current().revision;
    const current = () => !this.disposed && generation === this.generation && revision === this.session.current().revision;
    this.update({ sending: true, blocked: null, error: null });
    try {
      await this.mutate(this.session, send, data => { if (current()) saved(data); });
      if (current()) this.update({ sending: false, blocked: null, error: null });
    } catch (error) {
      if (!current()) return;
      const failure = error instanceof ApiClientError ? error : null;
      this.update({ sending: false, error, blocked: failure?.status === 409 || failure?.status === 404 ? 'conflict'
        : !failure?.status || failure.status >= 500 ? 'uncertain' : null });
    }
  }
  dispose = () => { this.disposed = true; this.generation++; this.listeners.clear(); };
  private update(state: MutationState) { this.state = state; for (const listener of this.listeners) listener(); }
}
