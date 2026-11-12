/** 文件作用：保存分域最小登录凭证，并用版本号隔离过期异步响应。 */
import type { AuthDomain, LoginCredential } from '@shop/shared';

export interface SessionStorageAccess {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface SessionOptions { storage?: () => SessionStorageAccess | undefined; now?: () => number }
export interface StoredCredential { readonly domain: AuthDomain; readonly accessToken: string; readonly expiresAt: string }
export interface SessionSnapshot { readonly revision: number; readonly credential: StoredCredential | null }
export const SESSION_KEYS: Readonly<Record<AuthDomain, string>> = Object.freeze({
  EMPLOYEE: 'self-ecom.employee.session', CUSTOMER: 'self-ecom.customer.session',
});

function validCredential(value: unknown, domain: AuthDomain, now: number): value is StoredCredential {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.domain === domain && typeof record.accessToken === 'string' && /^[^\s,]{1,8192}$/.test(record.accessToken)
    && typeof record.expiresAt === 'string' && Number.isFinite(Date.parse(record.expiresAt)) && Date.parse(record.expiresAt) > now;
}

/** 只存最小凭证，不持久化密码、本人资料或权限；真正的认证仍由API执行。 */
export class AuthSessionStore {
  private snapshot: SessionSnapshot = Object.freeze({ revision: 0, credential: null });
  private loginRevision = 0;
  private readonly listeners = new Set<() => void>();
  private readonly storage: () => SessionStorageAccess | undefined;
  private readonly now: () => number;

  constructor(readonly domain: AuthDomain, options: SessionOptions = {}) {
    this.storage = options.storage ?? (() => globalThis.sessionStorage);
    this.now = options.now ?? Date.now;
    try {
      const raw = this.storage()?.getItem(SESSION_KEYS[domain]);
      if (raw) {
        const value: unknown = JSON.parse(raw);
        if (validCredential(value, domain, this.now())) this.replace(value);
        else this.removeStored();
      }
    } catch { this.removeStored(); }
  }

  // 稳定快照和订阅可直接供后续React会话层使用；读取快照本身不触发通知。
  getSnapshot = (): SessionSnapshot => this.snapshot;
  getLoginRevision = (): number => this.loginRevision;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  current(): SessionSnapshot {
    const value = this.snapshot.credential;
    if (value && Date.parse(value.expiresAt) <= this.now()) this.invalidateIfCurrent(this.snapshot.revision);
    return this.snapshot;
  }

  save(input: LoginCredential): void {
    const value = { domain: this.domain, accessToken: input.accessToken, expiresAt: input.expiresAt };
    if (input.tokenType !== 'Bearer' || !validCredential(value, this.domain, this.now())) throw new Error('登录凭证格式不合法');
    this.loginRevision++;
    try { this.storage()?.setItem(SESSION_KEYS[this.domain], JSON.stringify(value)); }
    catch { this.removeStored(); } // 浏览器禁止存储时继续使用本标签页内存，不保留可能过时的旧记录。
    // 持久化先完成再通知；订阅者若立即退出，不会被外层save重新写回旧凭证。
    this.replace(value);
  }

  clear(): void { this.loginRevision++; this.removeStored(); this.replace(null); }
  clearIfCurrent(revision: number): boolean {
    if (this.snapshot.revision !== revision) return false;
    this.clear(); return true;
  }
  /** 401或到期只使旧凭证失效，不取消用户正在进行的新登录；主动退出仍使用clear。 */
  invalidateIfCurrent(revision: number): boolean {
    if (this.snapshot.revision !== revision) return false;
    this.removeStored(); this.replace(null); return true;
  }
  private removeStored(): void { try { this.storage()?.removeItem(SESSION_KEYS[this.domain]); } catch { /* 禁止存储不妨碍清除内存会话。 */ } }
  private replace(value: StoredCredential | null): void {
    this.snapshot = Object.freeze({ revision: this.snapshot.revision + 1, credential: value ? Object.freeze({ domain: value.domain, accessToken: value.accessToken, expiresAt: value.expiresAt }) : null });
    for (const listener of this.listeners) { try { listener(); } catch { /* 订阅者异常不能阻断其它订阅者或会话清理。 */ } }
  }
}
