/** 文件作用：协调员工登录恢复、权限刷新、强制改密及注销状态。 */
import { ApiClientError, type createEmployeeClient, type EmployeeProfile, type EmployeePermissions,
  type EmployeeLoginInput, type ChangePasswordInput } from '@shop/api-client';

type EmployeeClient = ReturnType<typeof createEmployeeClient>;
export interface EmployeeAuthSnapshot {
  readonly status: 'anonymous' | 'checking' | 'ready' | 'password-change' | 'error';
  readonly employee: EmployeeProfile | null;
  readonly permissions: EmployeePermissions | null;
  readonly error: ApiClientError | null;
  readonly notice: string | null;
}

/** 资料和权限只放内存；每次恢复先查本人，强制改密账号不请求业务权限。 */
export class EmployeeAuthController {
  private readonly client: EmployeeClient;
  private snapshot: EmployeeAuthSnapshot;
  private readonly listeners = new Set<() => void>();
  private stopSession: (() => void) | undefined;
  private observedRevision = -1;
  private generation = 0;
  private pending: Promise<void> | null = null;
  private signingOutRevision: number | null = null;

  constructor(client: EmployeeClient) {
    this.client = client;
    this.snapshot = Object.freeze({ status: client.session.getSnapshot().credential ? 'checking' : 'anonymous',
      employee: null, permissions: null, error: null, notice: null });
  }

  getSnapshot = (): EmployeeAuthSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  start = (): (() => void) => {
    const stop = this.client.session.subscribe(() => { void this.restore(); });
    this.stopSession?.(); this.stopSession = stop;
    void this.restore();
    return () => { stop(); if (this.stopSession === stop) this.stopSession = undefined; };
  };

  restore = (force = false, notice: string | null = null): Promise<void> => {
    const current = this.client.session.current();
    if (!current.credential) {
      const lost = this.snapshot.status !== 'anonymous';
      this.observedRevision = current.revision; this.generation++;
      this.update({ status: 'anonymous', employee: null, permissions: null, error: null,
        notice: lost ? '登录已失效，请重新登录。' : this.snapshot.notice });
      return Promise.resolve();
    }
    // 注销期间焦点事件不能重新恢复旧身份；另一轮新登录仍可正常恢复。
    if (this.signingOutRevision === current.revision) return Promise.resolve();
    // StrictMode重挂载、多个403和同一时刻的焦点事件共用正在进行的恢复。
    if (current.revision === this.observedRevision && (this.pending || !force)) return this.pending ?? Promise.resolve();
    this.observedRevision = current.revision;
    const generation = ++this.generation;
    this.update({ status: 'checking', employee: null, permissions: null, error: null, notice });
    const task = this.load(current.revision, generation, notice).finally(() => {
      if (this.pending === task) this.pending = null;
    });
    this.pending = task; return task;
  };

  private async load(revision: number, generation: number, notice: string | null) {
    const isCurrent = () => this.generation === generation && this.client.session.current().revision === revision;
    try {
      const { data: employee } = await this.client.auth.me();
      if (!isCurrent()) return;
      if (employee.mustChangePassword) {
        this.update({ status: 'password-change', employee, permissions: null, error: null, notice }); return;
      }
      const { data: permissions } = await this.client.auth.permissions();
      if (!isCurrent()) return;
      this.update({ status: 'ready', employee: { ...employee, role: permissions.role }, permissions, error: null, notice });
    } catch (error) {
      if (!isCurrent()) return;
      this.update({ status: 'error', employee: null, permissions: null, notice,
        error: error instanceof ApiClientError ? error : new ApiClientError('REQUEST_FAILED', '身份信息读取失败，请重试') });
    }
  }

  onUnauthorized = () => {
    this.generation++;
    this.update({ status: 'anonymous', employee: null, permissions: null, error: null, notice: '登录已失效，请重新登录。' });
  };

  onForbidden = (code: 'FORBIDDEN' | 'PASSWORD_CHANGE_REQUIRED') => {
    if (!this.client.session.current().credential) return;
    if (code === 'PASSWORD_CHANGE_REQUIRED') {
      this.generation++;
      this.update({ status: 'password-change', employee: this.snapshot.employee ? { ...this.snapshot.employee, mustChangePassword: true } : null,
        permissions: null, error: null, notice: null });
    } else if (!this.pending) {
      // 只重读身份和权限，不重放原业务请求；恢复自身的403也不再次触发恢复。
      void this.restore(true, '当前操作没有权限，已重新读取账号权限。');
    }
  };

  login = async (input: EmployeeLoginInput) => {
    await this.client.auth.login(input);
    await this.restore();
  };

  changePassword = async (input: ChangePasswordInput) => {
    await this.client.auth.changePassword(input);
    if (!this.client.session.getSnapshot().credential) {
      this.update({ status: 'anonymous', employee: null, permissions: null, error: null, notice: '密码已修改，请使用新密码重新登录。' });
    }
  };

  logout = async () => {
    const revision = this.client.session.current().revision;
    this.signingOutRevision = revision;
    this.generation++;
    this.update({ status: 'checking', employee: null, permissions: null, error: null, notice: null });
    let failed = false;
    try { await this.client.auth.logout(); } catch { failed = true; }
    finally { if (this.signingOutRevision === revision) this.signingOutRevision = null; }
    if (!this.client.session.getSnapshot().credential) {
      this.update({ status: 'anonymous', employee: null, permissions: null, error: null,
        notice: failed ? '本页已退出登录；服务器注销未确认，请勿在共享设备上保留其他已登录页面。' : '已退出登录。' });
    }
  };

  private update(value: EmployeeAuthSnapshot) {
    this.snapshot = Object.freeze(value);
    for (const listener of this.listeners) listener();
  }
}
