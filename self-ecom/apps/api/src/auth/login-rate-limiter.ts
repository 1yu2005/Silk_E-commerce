// 作用：以有界内存窗口和在途预留限制来源 IP 及账号的认证尝试。
export class AuthRateLimitedError extends Error {
  readonly code = 'AUTH_RATE_LIMITED';
  constructor(public readonly retryAfterSeconds: number) {
    super('认证尝试过于频繁，请稍后重试');
    this.name = 'AuthRateLimitedError';
  }
}

export interface LoginRatePolicy {
  ipAttempts: number; ipWindowMs: number; accountFailures: number; accountWindowMs: number;
  maxIpEntries: number; maxAccountEntries: number; cleanupIntervalMs: number;
}
export const LOGIN_RATE_POLICY: Readonly<LoginRatePolicy> = Object.freeze({ ipAttempts: 30, ipWindowMs: 60_000,
  accountFailures: 5, accountWindowMs: 300_000, maxIpEntries: 10_000, maxAccountEntries: 20_000, cleanupIntervalMs: 30_000 });
interface AccountBucket { failures: number[]; pending: number }
export type LoginReservation = object;

/** 单进程有界内存限流；重启清零，多实例须替换为共享存储。生产时钟使用单调时间。 */
export class LoginRateLimiter {
  private readonly ips = new Map<string, { count: number; expiresAt: number }>();
  private readonly accounts = new Map<string, AccountBucket>();
  private readonly reservations = new WeakMap<LoginReservation, { key: string; bucket: AccountBucket }>();
  private nextCleanup = 0;
  private readonly policy: Readonly<LoginRatePolicy>;

  constructor(private readonly clock: () => number = () => performance.now(), policy: LoginRatePolicy = LOGIN_RATE_POLICY,
    private readonly domain: 'EMPLOYEE' | 'CUSTOMER' = 'EMPLOYEE') {
    if (Object.values(policy).some(value => !Number.isSafeInteger(value) || value < 1)) throw new Error('登录限流配置不合法');
    if (domain !== 'EMPLOYEE' && domain !== 'CUSTOMER') throw new Error('登录限流登录域不合法');
    this.policy = Object.freeze({ ...policy });
  }
  private now(): number {
    const now = this.clock();
    if (!Number.isFinite(now) || now < 0) throw new Error('登录限流时钟不合法');
    return now;
  }
  private prune(bucket: AccountBucket, now: number) {
    bucket.failures = bucket.failures.filter(time => time + this.policy.accountWindowMs > now);
  }
  private cleanup(now: number) {
    if (now < this.nextCleanup) return;
    this.nextCleanup = now + this.policy.cleanupIntervalMs;
    for (const [key, value] of this.ips) if (value.expiresAt <= now) this.ips.delete(key);
    for (const [key, value] of this.accounts) {
      this.prune(value, now);
      if (value.pending === 0 && value.failures.length === 0) this.accounts.delete(key);
    }
  }
  /** 在DTO校验前调用，格式错误的登录请求也占用IP预算。 */
  consumeIp(ip: string): void {
    const now = this.now(); this.cleanup(now);
    let bucket = this.ips.get(ip);
    if (bucket && bucket.expiresAt <= now) { this.ips.delete(ip); bucket = undefined; }
    if (!bucket) {
      if (this.ips.size >= this.policy.maxIpEntries) throw new AuthRateLimitedError(60);
      bucket = { count: 0, expiresAt: now + this.policy.ipWindowMs }; this.ips.set(ip, bucket);
    }
    if (bucket.count >= this.policy.ipAttempts) throw new AuthRateLimitedError(Math.max(1, Math.ceil((bucket.expiresAt - now) / 1000)));
    bucket.count++;
  }
  /** 为尚未完成的验证预留名额，防止并发请求同时越过五次失败上限。 */
  reserveAccount(account: string, ip: string): LoginReservation {
    const now = this.now(); this.cleanup(now);
    const key = `${this.domain}:${ip}:${account}`;
    let bucket = this.accounts.get(key);
    if (bucket) this.prune(bucket, now);
    if (!bucket) {
      if (this.accounts.size >= this.policy.maxAccountEntries) throw new AuthRateLimitedError(60);
      bucket = { failures: [], pending: 0 }; this.accounts.set(key, bucket);
    }
    if (bucket.failures.length + bucket.pending >= this.policy.accountFailures) {
      const wait = bucket.failures.length >= this.policy.accountFailures
        ? Math.ceil((bucket.failures[0]! + this.policy.accountWindowMs - now) / 1000) : 1;
      throw new AuthRateLimitedError(Math.max(1, wait));
    }
    bucket.pending++;
    const reservation = {}; this.reservations.set(reservation, { key, bucket }); return reservation;
  }
  finish(reservation: LoginReservation, authenticationFailed: boolean): void {
    const entry = this.reservations.get(reservation);
    if (!entry) return;
    this.reservations.delete(reservation);
    const now = this.now(); const { key, bucket } = entry;
    bucket.pending--; this.prune(bucket, now);
    if (authenticationFailed) bucket.failures.push(now);
    // 成功不会清除此前失败记录；完成所有请求且无失败记录时立即释放内存。
    if (bucket.pending === 0 && bucket.failures.length === 0) this.accounts.delete(key);
  }
}
