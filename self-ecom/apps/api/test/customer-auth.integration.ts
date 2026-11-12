// 作用：验证顾客登录域、三种状态、独立限流和登录会话竞态。
import 'reflect-metadata';
import { randomInt, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import type { INestApplication } from '@nestjs/common';
import type { CustomerStatus, Prisma, SubjectType } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuthSessionService, type VerifiedPasswordSnapshot } from '../src/auth/auth-session.service.js';
import { CurrentIdentityService, type CurrentIdentity } from '../src/auth/current-identity.service.js';
import { CustomerAuthController } from '../src/auth/customer-auth.controller.js';
import { CustomerAuthService } from '../src/auth/customer-auth.service.js';
import { CustomerLoginDto } from '../src/auth/customer-login.dto.js';
import { CUSTOMER_LOGIN_RATE_LIMITER } from '../src/auth/customer-login-rate.guard.js';
import { CustomerRegisterController } from '../src/auth/customer-register.controller.js';
import { CustomerRegisterDto } from '../src/auth/customer-register.dto.js';
import { EmployeeAuthController } from '../src/auth/employee-auth.controller.js';
import { EmployeeLoginDto } from '../src/auth/employee-login.dto.js';
import { JwtTokenService } from '../src/auth/jwt-token.service.js';
import { LoginRateLimiter } from '../src/auth/login-rate-limiter.js';
import { DUMMY_LOGIN_HASH } from '../src/auth/login-support.js';
import { PasswordService } from '../src/auth/password.service.js';
import { REGISTRATION_RATE_LIMITER, REGISTRATION_RATE_POLICY } from '../src/auth/registration-rate.guard.js';
import { configureApp } from '../src/common/configure-app.js';
import { APP_CONFIG, loadConfiguration } from '../src/config/environment.js';
import { PermissionService } from '../src/permissions/permission.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { assertSafeTestDatabase } from '../scripts/database-env.js';

const safe = assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('集成测试仅可在test环境执行');
// Vitest不生成参数元数据；编译API子进程另验生产tsc路径。
Reflect.defineMetadata('design:paramtypes', [CustomerLoginDto, Object], CustomerAuthController.prototype, 'login');
Reflect.defineMetadata('design:paramtypes', [CustomerRegisterDto, Object], CustomerRegisterController.prototype, 'register');
Reflect.defineMetadata('design:paramtypes', [EmployeeLoginDto, Object], EmployeeAuthController.prototype, 'login');
const password = ' CustomerLogin#2026 '; const wrongPassword = 'WrongCustomer#2026'; const replacement = 'ReplacementCustomer#2026';
let hash = ''; let replacementHash = ''; let spaceHash = ''; let millis = Date.parse('2026-11-12T01:00:00.500Z'); const clock = () => new Date(millis);
const tokens = new JwtTokenService({ secret: 'customer-login-test-only-'.repeat(3), ttlSeconds: 7200 }, clock);
class ControlledPasswords extends PasswordService {
  checks = 0; hashes: string[] = []; afterVerified: (() => Promise<void>) | undefined;
  override async verify(value: string, passwordHash: string) {
    this.checks++; this.hashes.push(passwordHash); const correct = await super.verify(value, passwordHash); if (correct) await this.afterVerified?.(); return correct;
  }
}
class ControlledSessions extends AuthSessionService {
  fail = false; observedWrites = false; afterCreate: ((tx: Prisma.TransactionClient, input: VerifiedPasswordSnapshot) => Promise<void>) | undefined;
  override async createAfterPasswordVerified(tx: Prisma.TransactionClient, input: VerifiedPasswordSnapshot) {
    const issued = await super.createAfterPasswordVerified(tx, input);
    if (input.subjectType === 'CUSTOMER') {
      this.observedWrites = await tx.authSession.count({ where: { id: issued.sessionId, customerId: input.subjectId } }) === 1
        && (await tx.customer.findUniqueOrThrow({ where: { id: input.subjectId } })).lastLoginAt?.getTime() === millis;
      await this.afterCreate?.(tx, input); if (this.fail) throw new Error('private-session-failure');
    }
    return issued;
  }
}
class ControlledIdentities extends CurrentIdentityService {
  afterRead: ((identity: CurrentIdentity) => Promise<void>) | undefined;
  override async authenticate(db: Pick<Prisma.TransactionClient, '$queryRaw'>, credential: string, type: SubjectType) {
    const identity = await super.authenticate(db, credential, type);
    if (typeof (db as { $connect?: unknown }).$connect === 'function') await this.afterRead?.(identity); return identity;
  }
}
const passwords = new ControlledPasswords(); const sessions = new ControlledSessions(tokens, clock);
const identities = new ControlledIdentities(tokens, new PermissionService(), clock);
const customerLimiter = new LoginRateLimiter(() => millis, undefined, 'CUSTOMER'); const employeeLimiter = new LoginRateLimiter(() => millis);
const registrationLimiter = new LoginRateLimiter(() => millis, REGISTRATION_RATE_POLICY);
let app: INestApplication; let prisma: PrismaService; let peer: PrismaService; let baseUrl = '';
let loginSpy: MockInstance<CustomerAuthService['login']>; let meSpy: MockInstance<CustomerAuthService['me']>;
const customerIds = new Set<string>(); const employeeIds = new Set<string>(); const phones = new Set<string>();
beforeAll(async () => {
  [hash, replacementHash, spaceHash] = await Promise.all([passwords.hash(password), passwords.hash(replacement), passwords.hash('        ')]);
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG).useValue(loadConfiguration({ ...process.env, LOG_LEVEL: 'silent' }))
    .overrideProvider(JwtTokenService).useValue(tokens).overrideProvider(AuthSessionService).useValue(sessions)
    .overrideProvider(CurrentIdentityService).useValue(identities).overrideProvider(PasswordService).useValue(passwords)
    .overrideProvider(CUSTOMER_LOGIN_RATE_LIMITER).useValue(customerLimiter).overrideProvider(LoginRateLimiter).useValue(employeeLimiter)
    .overrideProvider(REGISTRATION_RATE_LIMITER).useValue(registrationLimiter).compile();
  app = module.createNestApplication(); configureApp(app); await app.listen(0, '127.0.0.1'); prisma = app.get(PrismaService); baseUrl = await app.getUrl();
  peer = new PrismaService(loadConfiguration()); await peer.onModuleInit();
  loginSpy = vi.spyOn(app.get(CustomerAuthService), 'login'); meSpy = vi.spyOn(app.get(CustomerAuthService), 'me');
});
beforeEach(() => {
  millis += 360_000; passwords.checks = 0; passwords.hashes = []; passwords.afterVerified = undefined;
  sessions.fail = false; sessions.observedWrites = false; sessions.afterCreate = undefined; identities.afterRead = undefined; loginSpy.mockClear(); meSpy.mockClear();
});
afterEach(async () => {
  passwords.afterVerified = undefined; sessions.fail = false; sessions.afterCreate = undefined; identities.afterRead = undefined;
  if (!prisma) return;
  // 子进程注册仅使用本文件预先确认不存在的随机手机号，不清空未知主体。
  for (const row of await prisma.customer.findMany({ where: { phone: { in: [...phones] } }, select: { id: true } })) customerIds.add(row.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorCustomerId: { in: [...customerIds] } }, { actorEmployeeId: { in: [...employeeIds] } }] } });
  await prisma.authSession.deleteMany({ where: { OR: [{ customerId: { in: [...customerIds] } }, { employeeId: { in: [...employeeIds] } }] } });
  await prisma.customer.deleteMany({ where: { id: { in: [...customerIds] } } }); await prisma.employee.deleteMany({ where: { id: { in: [...employeeIds] } } });
  customerIds.clear(); employeeIds.clear(); phones.clear();
});
afterAll(async () => { loginSpy?.mockRestore(); meSpy?.mockRestore(); await peer?.$disconnect(); await app?.close(); });
async function phone() {
  let value: string;
  do { value = `187${randomInt(100_000_000).toString().padStart(8, '0')}`; }
  while (phones.has(value) || await prisma.customer.findUnique({ where: { phone: value }, select: { id: true } }));
  phones.add(value); return value;
}
async function customer(status: CustomerStatus = 'NORMAL', passwordHash = hash) {
  const id = randomUUID(); customerIds.add(id);
  return prisma.customer.create({ data: { id, phone: await phone(), nickname: '顾客登录夹具', passwordHash, status, createdAt: new Date('2026-01-01T00:00:00Z') } });
}
async function employee(mustChangePassword = false) {
  const id = randomUUID(); employeeIds.add(id); return prisma.employee.create({ data: { id, username: `customer_auth_${randomUUID().slice(0, 8)}`,
    displayName: '域隔离员工', role: 'CUSTOMER_SERVICE', mustChangePassword, passwordHash: hash, createdAt: new Date('2026-01-01T00:00:00Z') } });
}
async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/api/v1/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'private-input', ...headers }, body: JSON.stringify(body) });
}
async function login(body: unknown, headers: Record<string, string> = {}) { return post('store/auth/login', body, headers); }
async function me(credential?: string, suffix = '', headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/api/v1/store/me${suffix}`, { headers: { ...(credential ? { Authorization: `Bearer ${credential}` } : {}), ...headers } });
}
async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status); const body = await response.json() as { code: string; requestId: string; details?: unknown };
  expect(body.code).toBe(code); expect(body.requestId).toBe(response.headers.get('x-request-id'));
  for (const secret of [password, wrongPassword, replacement, hash, replacementHash, 'private-input', 'private-session-failure', ...phones]) expect(JSON.stringify(body)).not.toContain(secret);
  return body;
}
interface Profile { id: string; phone: string; nickname: string; avatarUrl: null; status: 'NORMAL' | 'TRADE_RESTRICTED'; createdAt: string }
interface LoginData { accessToken: string; tokenType: 'Bearer'; expiresAt: string; customer: Profile }
function safeProfile(value: Profile) {
  expect(Object.keys(value).sort()).toEqual(['avatarUrl', 'createdAt', 'id', 'nickname', 'phone', 'status']); expect(value.avatarUrl).toBeNull();
  expect(JSON.stringify(value)).not.toMatch(/password|Hash|tokenVersion|sessionId|effectivePermissions|role|mustChangePassword/);
}
async function signedIn(response: Response) {
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store'); expect(response.headers.get('set-cookie')).toBeNull();
  const body = await response.json() as { data: LoginData; requestId: string };
  expect(Object.keys(body).sort()).toEqual(['data', 'requestId']); expect(body.requestId).toBe(response.headers.get('x-request-id')); expect(body.requestId).not.toBe('private-input');
  expect(Object.keys(body.data).sort()).toEqual(['accessToken', 'customer', 'expiresAt', 'tokenType']); expect(body.data.tokenType).toBe('Bearer'); safeProfile(body.data.customer); return body.data;
}
async function profile(response: Response) {
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json() as { data: Profile; requestId: string }; expect(Object.keys(body).sort()).toEqual(['data', 'requestId']);
  expect(body.requestId).toBe(response.headers.get('x-request-id')); safeProfile(body.data); return body.data;
}
async function signIn(account: { phone: string }, value = password) { return signedIn(await login({ phone: account.phone, password: value })); }
async function facts(id: string) {
  return { customer: await prisma.customer.findUniqueOrThrow({ where: { id } }), sessions: await prisma.authSession.findMany({ where: { customerId: id }, orderBy: { id: 'asc' } }),
    audits: await prisma.auditLog.findMany({ where: { actorCustomerId: id }, orderBy: { id: 'asc' } }) };
}
function barrier() {
  let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
  let signal!: () => void; const ready = new Promise<void>(resolve => { signal = resolve; }); return { hold, release, ready, signal };
}
async function waitForBlocker(pid: number) {
  const deadline = performance.now() + 550;
  while (performance.now() < deadline) {
    const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(pid))) AS waiting`;
    if (row?.waiting) return; await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('未观察到顾客主体锁实际等待');
}

it.each(['NORMAL', 'TRADE_RESTRICTED'] as const)('%s真实bcrypt登录、顾客域JWT/会话及本人资料，白名单字段且查询无副作用', async status => {
  const account = await customer(status); const data = await signIn(account); const claims = await tokens.verify(data.accessToken, 'CUSTOMER');
  expect(Object.keys(claims).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'sid', 'sub', 'subjectType', 'tokenVersion']);
  expect(claims).toMatchObject({ aud: 'shop-store', iss: 'shop-api', sub: account.id, subjectType: 'CUSTOMER', tokenVersion: 0 }); expect(JSON.stringify(claims)).not.toContain(account.phone);
  const before = await facts(account.id); expect(before.sessions).toHaveLength(1);
  expect(before.sessions[0]).toMatchObject({ id: claims.sid, subjectType: 'CUSTOMER', customerId: account.id, employeeId: null, tokenVersion: 0, revokedAt: null, revokeReason: null });
  expect(before.sessions[0]?.expiresAt.getTime()).toBe(claims.exp * 1000); expect(before.sessions[0]?.expiresAt.toISOString()).toBe(data.expiresAt);
  expect(before.customer.lastLoginAt).toEqual(clock()); expect(sessions.observedWrites).toBe(true);
  expect(data.customer).toEqual({ id: account.id, phone: account.phone, nickname: account.nickname, avatarUrl: null, status, createdAt: account.createdAt.toISOString() });
  expect(await profile(await me(data.accessToken))).toEqual(data.customer); expect(await facts(account.id)).toEqual(before); expect(before.audits).toEqual([]);
});
it('手机号去空白，密码八个空格按原文验证，公开登录不受无效Bearer干扰', async () => {
  const account = await customer('NORMAL', spaceHash); const data = await signedIn(await login({ phone: ` ${account.phone} `, password: '        ' }, { Authorization: 'Bearer invalid-public-input' }));
  expect(data.customer.phone).toBe(account.phone); expect((await profile(await me(data.accessToken))).id).toBe(account.id);
});
it('不存在和错误密码统一401，都执行真实bcrypt；冻结状态仅在密码正确后报告', async () => {
  const account = await customer('LOGIN_FROZEN'); const missingPhone = await phone();
  const missing = await error(await login({ phone: missingPhone, password }), 401, 'INVALID_CREDENTIALS');
  const wrong = await error(await login({ phone: account.phone, password: wrongPassword }), 401, 'INVALID_CREDENTIALS');
  expect({ ...missing, requestId: '' }).toEqual({ ...wrong, requestId: '' });
  await error(await login({ phone: account.phone, password }), 401, 'ACCOUNT_UNAVAILABLE'); expect(passwords.checks).toBe(3); expect(passwords.hashes).toEqual([DUMMY_LOGIN_HASH, hash, hash]);
  expect((await facts(account.id)).customer.lastLoginAt).toBeNull(); expect((await facts(account.id)).sessions).toEqual([]);
});
it('注册后真实登录再查本人，注册审计保持一条且首次登录时间合法', async () => {
  const value = await phone(); const registered = await post('store/auth/register', { phone: value, password, nickname: '新注册登录' }); expect(registered.status).toBe(201);
  const result = await registered.json() as { data: { id: string } }; customerIds.add(result.data.id);
  const data = await signIn({ phone: value }); expect((await profile(await me(data.accessToken))).nickname).toBe('新注册登录');
  const after = await facts(result.data.id); expect(after.audits.map(row => row.action)).toEqual(['customer.register']); expect(after.customer.lastLoginAt!.getTime()).toBeGreaterThanOrEqual(after.customer.createdAt.getTime());
});
it('多次登录保留多会话，注销当前sid真实幂等，另一设备继续查询', async () => {
  const account = await customer(); const first = await signIn(account); const second = await signIn(account); expect(first.accessToken).not.toBe(second.accessToken);
  const logout = () => post('auth/logout', {}, { Authorization: `Bearer ${first.accessToken}` });
  for (let index = 0; index < 2; index++) { const response = await logout(); expect(response.status).toBe(200); expect((await response.json() as { data: unknown }).data).toEqual({ loggedOut: true }); }
  await error(await me(first.accessToken), 401, 'SESSION_REVOKED'); expect((await profile(await me(second.accessToken))).id).toBe(account.id);
  const after = await facts(account.id); expect(after.sessions).toHaveLength(2); expect(after.sessions.filter(row => row.revokedAt !== null)).toHaveLength(1);
  expect(after.audits.map(row => row.action)).toEqual(['auth.logout']);
});

const invalidCases: [string, Record<string, unknown>][] = [
  ['手机号null', { phone: null }], ['手机号数字', { phone: 18700000000 }], ['手机号数组', { phone: [] }], ['手机号对象', { phone: {} }],
  ['手机号短', { phone: '1870000000' }], ['手机号前缀', { phone: '12700000000' }], ['手机号国际码', { phone: '+8618700000000' }],
  ['密码null', { password: null }], ['密码数字', { password: 12345678 }], ['密码数组', { password: [] }], ['密码不足8码点', { password: '😀'.repeat(7) }],
  ['密码超64码点', { password: 'a'.repeat(65) }], ['中文超72字节', { password: '密'.repeat(25) }], ['emoji超72字节', { password: '😀'.repeat(19) }], ['非法Unicode', { password: 'abcdefg\ud800' }],
  ['注入昵称', { nickname: 'private-input' }], ['注入岗位', { role: 'SUPER_ADMIN' }], ['注入状态', { status: 'NORMAL' }], ['注入ID', { id: randomUUID() }],
  ['注入版本', { tokenVersion: 0 }], ['注入token', { accessToken: 'private-input' }],
];
it.each(invalidCases)('%s400且服务/bcrypt未执行，无会话/登录时间变化', async (_name, patch) => {
  const account = await customer(); const before = await facts(account.id); await error(await login({ phone: account.phone, password, ...patch }), 400, 'VALIDATION_FAILED');
  expect(loginSpy).not.toHaveBeenCalled(); expect(passwords.checks).toBe(0); expect(await facts(account.id)).toEqual(before);
});
it.each(['phone', 'password'] as const)('缺少%s400且不验证密码', async field => {
  const body: Partial<CustomerLoginDto> = { phone: await phone(), password }; delete body[field]; await error(await login(body), 400, 'VALIDATION_FAILED'); expect(passwords.checks).toBe(0);
});

it('本人查询只认已验证ID，忽略查询/请求头自报对象，读到最新昵称和状态，不暴露别人的资料', async () => {
  const account = await customer(); const other = await customer(); const data = await signIn(account);
  await peer.customer.update({ where: { id: account.id }, data: { nickname: '更新后的本人昵称', status: 'TRADE_RESTRICTED' } }); const before = await facts(account.id);
  const result = await profile(await me(data.accessToken, `?id=${other.id}&phone=${other.phone}&role=SUPER_ADMIN`, { 'X-Subject-Id': other.id, 'X-Role': 'SUPER_ADMIN' }));
  expect(result).toMatchObject({ id: account.id, phone: account.phone, nickname: '更新后的本人昵称', status: 'TRADE_RESTRICTED' }); expect(JSON.stringify(result)).not.toContain(other.phone);
  expect(await facts(account.id)).toEqual(before);
});
it('Guard通过后资料读取前被冻结，资料服务仍拒绝，不返回冻结资料', async () => {
  const account = await customer(); const data = await signIn(account);
  identities.afterRead = async identity => { expect(identity.subjectId).toBe(account.id); identities.afterRead = undefined; await peer.customer.update({ where: { id: account.id }, data: { status: 'LOGIN_FROZEN' } }); };
  await error(await me(data.accessToken), 401, 'ACCOUNT_UNAVAILABLE'); expect(meSpy).toHaveBeenCalledTimes(1);
});
it.each(['缺凭证', 'Cookie', '查询token'] as const)('本人接口%s不能补出Bearer，不进入资料服务', async source => {
  const account = await customer(); const data = await signIn(account);
  await error(await me(undefined, source === '查询token' ? `?token=${data.accessToken}` : '', source === 'Cookie' ? { Cookie: `token=${data.accessToken}` } : {}), 401, 'TOKEN_INVALID');
  expect(meSpy).not.toHaveBeenCalled();
});
it.each([true, false])('员工强制改密=%s，真实员工token访问顾客本人接口均401登录域错误', async forced => {
  const account = await employee(forced); const response = await post('admin/auth/login', { username: account.username, password }); expect(response.status).toBe(200);
  const data = (await response.json() as { data: { accessToken: string } }).data; await error(await me(data.accessToken), 401, 'TOKEN_SUBJECT_MISMATCH'); expect(meSpy).not.toHaveBeenCalled();
});
it('真实顾客token访问员工本人和管理入口均401，仍可查询顾客本人', async () => {
  const account = await customer(); const data = await signIn(account);
  for (const path of ['admin/me', 'admin/employees']) await error(await fetch(`${baseUrl}/api/v1/${path}`, { headers: { Authorization: `Bearer ${data.accessToken}` } }), 401, 'TOKEN_SUBJECT_MISMATCH');
  expect((await profile(await me(data.accessToken))).id).toBe(account.id);
});
it.each(['未知sid', '账号版本', '会话版本', '签名', '到期', '直接冻结'] as const)('%s失效返回固定401，不进入资料服务', async kind => {
  const account = await customer(); const data = await signIn(account); let credential = data.accessToken; const claims = await tokens.verify(credential, 'CUSTOMER');
  if (kind === '未知sid') credential = (await tokens.issue({ subjectType: 'CUSTOMER', subjectId: account.id, sessionId: randomUUID(), tokenVersion: 0 })).accessToken;
  if (kind === '账号版本') await peer.customer.update({ where: { id: account.id }, data: { tokenVersion: 1 } });
  if (kind === '会话版本') await peer.authSession.update({ where: { id: claims.sid }, data: { tokenVersion: 1 } });
  if (kind === '签名') credential = (await new JwtTokenService({ secret: 'other-customer-test-only-'.repeat(3), ttlSeconds: 7200 }, clock).issue({ subjectType: 'CUSTOMER', subjectId: account.id, sessionId: claims.sid, tokenVersion: 0 })).accessToken;
  if (kind === '到期') millis = claims.exp * 1000;
  if (kind === '直接冻结') await peer.customer.update({ where: { id: account.id }, data: { status: 'LOGIN_FROZEN' } });
  await error(await me(credential), 401, kind === '到期' ? 'TOKEN_EXPIRED' : kind === '直接冻结' ? 'ACCOUNT_UNAVAILABLE' : 'TOKEN_INVALID'); expect(meSpy).not.toHaveBeenCalled();
});
it('冻结夹具递增版本/撤销会话，恢复后旧token不复活，重新登录按新版本成功', async () => {
  const account = await customer(); const first = await signIn(account); const second = await signIn(account);
  await peer.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM customer WHERE id=${account.id}::uuid FOR UPDATE`;
    await tx.customer.update({ where: { id: account.id }, data: { status: 'LOGIN_FROZEN', tokenVersion: { increment: 1 } } });
    await sessions.revokeAll(tx, { subjectType: 'CUSTOMER', subjectId: account.id }, 'LOGIN_FROZEN');
  });
  for (const value of [first, second]) await error(await me(value.accessToken), 401, 'SESSION_REVOKED');
  await error(await login({ phone: account.phone, password }), 401, 'ACCOUNT_UNAVAILABLE');
  await peer.customer.update({ where: { id: account.id }, data: { status: 'NORMAL' } });
  await error(await me(first.accessToken), 401, 'SESSION_REVOKED'); const fresh = await signIn(account); expect((await tokens.verify(fresh.accessToken, 'CUSTOMER')).tokenVersion).toBe(1);
  expect((await profile(await me(fresh.accessToken))).status).toBe('NORMAL'); expect((await facts(account.id)).sessions.filter(row => row.revokeReason === 'LOGIN_FROZEN')).toHaveLength(2);
});

it.each(['密码', '令牌版本', '冻结', '限制交易', '删除'] as const)('bcrypt完成后并发%s，锁内复核快照或状态，不越过最新事实', async operation => {
  const account = await customer(); const gate = barrier(); passwords.afterVerified = async () => { gate.signal(); await gate.hold; };
  const pending = login({ phone: account.phone, password });
  try {
    await Promise.race([gate.ready, pending.then(() => { throw new Error('未进入密码屏障'); })]);
    await peer.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM customer WHERE id=${account.id}::uuid FOR UPDATE`;
      if (operation === '删除') { await tx.customer.delete({ where: { id: account.id } }); return; }
      await tx.customer.update({ where: { id: account.id }, data: operation === '密码' ? { passwordHash: replacementHash, tokenVersion: 1 }
        : operation === '令牌版本' ? { tokenVersion: 1 } : { status: operation === '冻结' ? 'LOGIN_FROZEN' : 'TRADE_RESTRICTED' } });
    }); gate.release();
    if (operation === '限制交易') expect((await signedIn(await pending)).customer.status).toBe('TRADE_RESTRICTED');
    else {
      await error(await pending, 401, operation === '冻结' || operation === '删除' ? 'ACCOUNT_UNAVAILABLE' : 'INVALID_CREDENTIALS');
      expect(await prisma.authSession.count({ where: { customerId: account.id } })).toBe(0);
      if (operation !== '删除') expect((await facts(account.id)).customer.lastLoginAt).toBeNull();
    }
  } finally { gate.release(); await pending; passwords.afterVerified = undefined; }
});
it('会话创建及登录时间写后故障整体回滚；五次系统故障不计账号失败，第六次可成功', async () => {
  const account = await customer(); const before = await facts(account.id); sessions.fail = true;
  sessions.afterCreate = async tx => {
    expect((await tx.customer.findUniqueOrThrow({ where: { id: account.id } })).lastLoginAt).toEqual(clock());
    expect((await peer.customer.findUniqueOrThrow({ where: { id: account.id } })).lastLoginAt).toBeNull(); expect(await peer.authSession.count({ where: { customerId: account.id } })).toBe(0);
  };
  for (let index = 0; index < 5; index++) { await error(await login({ phone: account.phone, password }), 500, 'INTERNAL_ERROR'); expect(sessions.observedWrites).toBe(true); expect(await facts(account.id)).toEqual(before); }
  sessions.fail = false; sessions.afterCreate = undefined; await signIn(account); expect((await facts(account.id)).sessions).toHaveLength(1);
});
it('冻结先持顾客锁，登录真实等待后拒绝，不产生新会话', async () => {
  const account = await customer(); const gate = barrier(); let pid = 0;
  const blocker = peer.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM customer WHERE id=${account.id}::uuid FOR UPDATE`;
    await tx.customer.update({ where: { id: account.id }, data: { status: 'LOGIN_FROZEN', tokenVersion: 1 } });
    pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold;
  }); let pending: Promise<Response> | undefined;
  try {
    await gate.ready; pending = login({ phone: account.phone, password }); await waitForBlocker(pid); gate.release(); await blocker; await error(await pending, 401, 'ACCOUNT_UNAVAILABLE');
    expect((await facts(account.id)).sessions).toEqual([]); expect((await facts(account.id)).customer.lastLoginAt).toBeNull();
  } finally { gate.release(); await Promise.allSettled([blocker, ...(pending ? [pending] : [])]); }
});
it('登录先持顾客锁，冻结实际等待，登录可先成功但随后冻结撤销该会话', async () => {
  const account = await customer(); const gate = barrier(); let pid = 0;
  sessions.afterCreate = async tx => { pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold; };
  const pending = login({ phone: account.phone, password }); let freezing: Promise<unknown> | undefined;
  try {
    await Promise.race([gate.ready, pending.then(() => { throw new Error('未进入会话屏障'); })]);
    freezing = peer.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM customer WHERE id=${account.id}::uuid FOR UPDATE`;
      await tx.customer.update({ where: { id: account.id }, data: { status: 'LOGIN_FROZEN', tokenVersion: 1 } });
      await sessions.revokeAll(tx, { subjectType: 'CUSTOMER', subjectId: account.id }, 'LOGIN_FROZEN');
    }); await waitForBlocker(pid); gate.release(); const data = await signedIn(await pending); await freezing;
    await error(await me(data.accessToken), 401, 'SESSION_REVOKED'); expect((await facts(account.id)).sessions[0]?.revokeReason).toBe('LOGIN_FROZEN');
  } finally { gate.release(); await Promise.allSettled([pending, ...(freezing ? [freezing] : [])]); }
});

it('同规范化手机号/IP五次失败后第六次429，CORS暴露Retry-After，窗口等号恢复', async () => {
  const account = await customer();
  for (let index = 0; index < 5; index++) await error(await login({ phone: index % 2 ? ` ${account.phone} ` : account.phone, password: wrongPassword }), 401, 'INVALID_CREDENTIALS');
  const blocked = await login({ phone: account.phone, password }, { Origin: 'http://localhost:5174' }); await error(blocked, 429, 'AUTH_RATE_LIMITED');
  expect(blocked.headers.get('retry-after')).toBe('300'); expect(blocked.headers.get('access-control-expose-headers')).toContain('Retry-After'); expect(passwords.checks).toBe(5);
  millis += 300_000; await signIn(account);
});
it('成功登录不清除此前失败计数，不同手机号各自计算失败预算', async () => {
  const account = await customer(); const other = await customer();
  for (let index = 0; index < 4; index++) await error(await login({ phone: account.phone, password: wrongPassword }), 401, 'INVALID_CREDENTIALS');
  await signIn(account); await error(await login({ phone: account.phone, password: wrongPassword }), 401, 'INVALID_CREDENTIALS');
  await error(await login({ phone: account.phone, password }), 429, 'AUTH_RATE_LIMITED'); await signIn(other);
});
it('IP30次预算在DTO前计数，伪造代理IP不能绕过，到60秒恢复', async () => {
  for (let index = 0; index < 30; index++) await error(await login({}, { 'X-Forwarded-For': `192.0.2.${index + 1}` }), 400, 'VALIDATION_FAILED');
  const blocked = await login({}, { 'X-Forwarded-For': '203.0.113.1' }); await error(blocked, 429, 'AUTH_RATE_LIMITED'); expect(blocked.headers.get('retry-after')).toBe('60');
  expect(passwords.checks).toBe(0); expect(loginSpy).not.toHaveBeenCalled(); millis += 60_000; await error(await login({}), 400, 'VALIDATION_FAILED');
});
it('6个并发错误密码仅5次bcrypt，第6个由在途预留拦截', async () => {
  const account = await customer(); const responses = await Promise.all(Array.from({ length: 6 }, () => login({ phone: account.phone, password: wrongPassword })));
  expect(responses.map(response => response.status).sort()).toEqual([401, 401, 401, 401, 401, 429]); expect(passwords.checks).toBe(5); expect((await facts(account.id)).sessions).toEqual([]);
});
it('顾客登录、员工登录和注册额度独立，耗尽一种不占另外两种', async () => {
  for (let index = 0; index < 5; index++) await error(await post('store/auth/register', {}), 400, 'VALIDATION_FAILED');
  await error(await post('store/auth/register', {}), 429, 'AUTH_RATE_LIMITED');
  for (let index = 0; index < 30; index++) await error(await login({}), 400, 'VALIDATION_FAILED');
  await error(await login({}), 429, 'AUTH_RATE_LIMITED');
  for (let index = 0; index < 30; index++) await error(await post('admin/auth/login', {}), 400, 'VALIDATION_FAILED');
  await error(await post('admin/auth/login', {}), 429, 'AUTH_RATE_LIMITED');
});

it('编译API注册/登录/本人/域隔离/多会话注销/默认失败限流完整验证', async () => {
  const value = await phone(); const staff = await employee();
  const source = String.raw`
    require('reflect-metadata');const {NestFactory}=require('@nestjs/core');const {AppModule}=require('./dist/app.module.js');const {configureApp}=require('./dist/common/configure-app.js');
    (async()=>{const app=await NestFactory.create(AppModule,{logger:false});try{configureApp(app);await app.listen(0,'127.0.0.1');const url=await app.getUrl();
      const post=(path,body,token)=>fetch(url+'/api/v1/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
      const get=(path,token)=>fetch(url+'/api/v1/'+path,{headers:{Authorization:'Bearer '+token}});const input={phone:process.env.SHOP_TEST_PHONE,password:process.env.SHOP_TEST_PASSWORD};
      const registered=await post('store/auth/register',input);const reg=await registered.json();const invalid=await post('store/auth/login',{...input,id:reg.data.id});
      const login=await post('store/auth/login',input);const body=await login.json();const token=body.data.accessToken;
      const second=await post('store/auth/login',input);const two=await second.json();const me=await get('store/me',token);const profile=await me.json();const wrongDomain=await get('admin/me',token);const denied=await wrongDomain.json();
      const staff=await post('admin/auth/login',{username:process.env.SHOP_TEST_STAFF,password:process.env.SHOP_TEST_PASSWORD});const employee=await staff.json();const staffDenied=await get('store/me',employee.data.accessToken);
      const logout=await post('auth/logout',{},token);const old=await get('store/me',token);const active=await get('store/me',two.data.accessToken);
      const failures=[];for(let n=0;n<5;n++){const r=await post('store/auth/login',{...input,password:'WrongCustomer#2026'});failures.push(r.status);}
      const limited=await post('store/auth/login',input);const limit=await limited.json();
      console.log(JSON.stringify({id:reg.data.id,registered:registered.status,invalid:invalid.status,login:login.status,fields:Object.keys(body.data).sort(),me:me.status,
        profileFields:Object.keys(profile.data).sort(),avatar:profile.data.avatarUrl,status:profile.data.status,wrongDomain:wrongDomain.status,domainCode:denied.code,
        staff:staff.status,staffDenied:staffDenied.status,logout:logout.status,old:old.status,active:active.status,failures,limited:limited.status,limitCode:limit.code,retryPositive:Number(limited.headers.get('retry-after'))>0}));
    }finally{await app.close();}})().catch(()=>{console.error('编译后顾客登录资料验证失败');process.exitCode=1;});`;
  const child = spawnSync(process.execPath, ['-e', source], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true, timeout: 15_000,
    env: { ...process.env, DATABASE_URL: safe.testUrl, LOG_LEVEL: 'silent', SHOP_TEST_PHONE: value, SHOP_TEST_PASSWORD: password, SHOP_TEST_STAFF: staff.username } });
  expect(child.status).toBe(0); const result = JSON.parse(child.stdout.trim()) as { id: string }; customerIds.add(result.id);
  expect(result).toEqual({ id: result.id, registered: 201, invalid: 400, login: 200, fields: ['accessToken', 'customer', 'expiresAt', 'tokenType'], me: 200,
    profileFields: ['avatarUrl', 'createdAt', 'id', 'nickname', 'phone', 'status'], avatar: null, status: 'NORMAL', wrongDomain: 401, domainCode: 'TOKEN_SUBJECT_MISMATCH',
    staff: 200, staffDenied: 401, logout: 200, old: 401, active: 200, failures: [401, 401, 401, 401, 401], limited: 429, limitCode: 'AUTH_RATE_LIMITED', retryPositive: true });
  const after = await facts(result.id); expect(after.sessions).toHaveLength(2); expect(after.sessions.filter(row => row.revokedAt === null)).toHaveLength(1); expect(after.audits).toHaveLength(2);
  for (const secret of [password, wrongPassword, hash, value]) expect(child.stdout + child.stderr).not.toContain(secret);
});
