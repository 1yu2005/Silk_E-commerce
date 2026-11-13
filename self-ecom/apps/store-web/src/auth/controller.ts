/** 文件作用：协调顾客注册、登录恢复、昵称修改、改密及注销状态。 */
import { ApiClientError, type createCustomerClient, type CustomerProfile, type CustomerLoginInput,
  type CustomerRegisterInput, type CustomerProfileInput, type ChangePasswordInput } from '@shop/api-client';

type CustomerClient = ReturnType<typeof createCustomerClient>;
export interface CustomerAuthSnapshot {
  readonly status: 'anonymous' | 'checking' | 'ready' | 'error';
  readonly customer: CustomerProfile | null;
  readonly error: ApiClientError | null;
  readonly notice: string | null;
}

/** 顾客资料只保存在内存；登录恢复始终向API查询本人，不信任浏览器中的自报身份。 */
export class CustomerAuthController {
  private readonly client: CustomerClient;
  private snapshot: CustomerAuthSnapshot;
  private readonly listeners = new Set<() => void>();
  private stopSession: (() => void) | undefined;
  private observedRevision = -1;
  private generation = 0;
  private pending: Promise<void> | null = null;
  private signingOutRevision: number | null = null;
  private profileUpdate = 0;
  private avatarUpdate = 0;
  private passwordAttempt = 0;

  constructor(client: CustomerClient) {
    this.client = client;
    this.snapshot = Object.freeze({ status: client.session.getSnapshot().credential ? 'checking' : 'anonymous',
      customer: null, error: null, notice: null });
  }

  getSnapshot = (): CustomerAuthSnapshot => this.snapshot;
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

  restore = (force = false, keepReady = false): Promise<void> => {
    const current = this.client.session.current();
    if (!current.credential) {
      const lost = this.snapshot.status !== 'anonymous';
      this.observedRevision = current.revision; this.generation++;
      this.update({ status: 'anonymous', customer: null, error: lost ? null : this.snapshot.error,
        notice: lost ? '登录已失效，请重新登录。' : this.snapshot.notice });
      return Promise.resolve();
    }
    // 注销未完成时不因焦点事件重新展示旧身份，新登录的不同revision仍可恢复。
    if (this.signingOutRevision === current.revision) return Promise.resolve();
    if (current.revision === this.observedRevision && (this.pending || !force)) return this.pending ?? Promise.resolve();
    const background = keepReady && force && current.revision === this.observedRevision && this.snapshot.status === 'ready';
    this.observedRevision = current.revision;
    const generation = ++this.generation;
    // 同一会话的焦点复核保持页面挂载，避免系统选图对话框返回焦点时丢掉上传选择。
    if (!background) this.update({ status: 'checking', customer: null, error: null, notice: null });
    const task = this.load(current.revision, generation).finally(() => {
      if (this.pending === task) this.pending = null;
    });
    this.pending = task; return task;
  };

  private async load(revision: number, generation: number) {
    const isCurrent = () => this.generation === generation && this.client.session.current().revision === revision;
    try {
      const { data: customer } = await this.client.auth.me();
      if (isCurrent()) this.update({ status: 'ready', customer, error: null, notice: null });
    } catch (error) {
      if (!isCurrent()) return;
      this.update({ status: 'error', customer: null, notice: null,
        error: error instanceof ApiClientError ? error : new ApiClientError('REQUEST_FAILED', '账号信息读取失败，请重试') });
    }
  }

  onUnauthorized = () => {
    this.generation++;
    this.update({ status: 'anonymous', customer: null, error: null, notice: '登录已失效，请重新登录。' });
  };

  onForbidden = () => {
    if (!this.client.session.current().credential) return;
    // 顾客没有员工权限目录或强制改密流程；403保留会话，不自动重试请求。
    this.update({ ...this.snapshot, notice: '当前操作暂不可用，请确认账号状态后重试。' });
  };

  register = async (input: CustomerRegisterInput): Promise<boolean> => {
    const initial = this.client.session.current();
    const revision = initial.revision;
    if (!initial.credential) this.update({ status: 'anonymous', customer: null, error: null, notice: null });
    await this.client.auth.register(input);
    const current = this.client.session.current();
    if (current.revision !== revision || current.credential) return false;
    this.update({ status: 'anonymous', customer: null, error: null, notice: '注册成功，请使用手机号和密码登录。' });
    return true;
  };

  login = async (input: CustomerLoginInput) => {
    this.passwordAttempt++;
    if (!this.client.session.current().credential) this.update({ status: 'anonymous', customer: null, error: null, notice: null });
    await this.client.auth.login(input);
    await this.restore();
  };

  updateProfile = async (input: CustomerProfileInput): Promise<boolean> => {
    const revision = this.client.session.current().revision;
    const attempt = ++this.profileUpdate;
    const avatarAttempt = this.avatarUpdate;
    const { data: customer } = await this.client.auth.updateProfile({ nickname: input.nickname.trim() });
    const current = this.client.session.current();
    if (!current.credential || current.revision !== revision || attempt !== this.profileUpdate || this.signingOutRevision === revision) return false;
    // 写入响应比此前发出的本人查询更新；使旧查询失效，避免导航昵称被迟到结果覆盖。
    this.generation++; this.pending = null; this.observedRevision = revision;
    // 昵称响应与并发头像命令可能交错，仅合并本命令修改的字段，避免覆盖更新后的头像。
    this.update({ status: 'ready', customer: this.avatarUpdate !== avatarAttempt && this.snapshot.customer?.id === customer.id
      ? { ...this.snapshot.customer, nickname: customer.nickname } : customer, error: null, notice: '昵称已保存。' });
    return true;
  };

  changeAvatar = async (fileId: string | null): Promise<boolean> => {
    const revision = this.client.session.current().revision; const attempt = ++this.avatarUpdate;
    const result = fileId === null ? await this.client.auth.removeAvatar() : await this.client.auth.setAvatar(fileId);
    const current = this.client.session.current();
    if (!current.credential || current.revision !== revision || attempt !== this.avatarUpdate
      || this.signingOutRevision === revision || !this.snapshot.customer) return false;
    this.generation++; this.pending = null; this.observedRevision = revision;
    this.update({ status: 'ready', customer: { ...this.snapshot.customer, avatarUrl: result.data.avatarUrl }, error: null,
      notice: fileId === null ? '头像已移除。' : '头像已保存。' }); return true;
  };

  changePassword = async (input: ChangePasswordInput) => {
    const revision = this.client.session.current().revision;
    const loginRevision = this.client.session.getLoginRevision();
    const attempt = ++this.passwordAttempt;
    try {
      await this.client.auth.changePassword({ oldPassword: input.oldPassword, newPassword: input.newPassword });
      const current = this.client.session.current();
      if (attempt === this.passwordAttempt && !current.credential && current.revision === revision + 1
        && this.client.session.getLoginRevision() === loginRevision + 1) {
        this.generation++;
        this.update({ status: 'anonymous', customer: null, error: null, notice: '密码已修改，请使用新密码重新登录。' });
      }
    } catch (error) {
      const current = this.client.session.current();
      // 沿用受保护401清本域会话的规则；跳转后保留安全错误及请求编号，不保留密码。
      if (error instanceof ApiClientError && error.status === 401 && attempt === this.passwordAttempt
        && !current.credential && current.revision === revision + 1 && this.client.session.getLoginRevision() === loginRevision) {
        this.update({ status: 'anonymous', customer: null, error,
          notice: error.code === 'INVALID_CREDENTIALS' ? '密码未修改，请重新登录后确认旧密码。' : '改密未完成，请重新登录。' });
      }
      throw error;
    }
  };

  logout = async () => {
    this.passwordAttempt++;
    const revision = this.client.session.current().revision;
    this.signingOutRevision = revision; this.generation++;
    this.update({ status: 'checking', customer: null, error: null, notice: null });
    let failed = false;
    try { await this.client.auth.logout(); } catch { failed = true; }
    finally { if (this.signingOutRevision === revision) this.signingOutRevision = null; }
    if (!this.client.session.getSnapshot().credential) {
      this.update({ status: 'anonymous', customer: null, error: null,
        notice: failed ? '本页已退出登录；服务器注销未确认，请勿在共享设备上保留其他已登录页面。' : '已退出登录。' });
    }
  };

  private update(value: CustomerAuthSnapshot) {
    this.snapshot = Object.freeze(value);
    for (const listener of this.listeners) listener();
  }
}
