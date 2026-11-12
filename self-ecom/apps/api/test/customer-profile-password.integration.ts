// 作用：验证顾客本人昵称和改密的身份归属、状态检查、竞态与事务回滚。
import 'reflect-metadata';
import { randomInt, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import type { INestApplication } from '@nestjs/common';
import type { CustomerStatus, Prisma, SubjectType } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuditService, type AuditPayload } from '../src/audit/audit.service.js';
import { AuthSessionService } from '../src/auth/auth-session.service.js';
import { ChangePasswordDto } from '../src/auth/change-password.dto.js';
import { CurrentIdentityService, type CurrentIdentity } from '../src/auth/current-identity.service.js';
import { CustomerAuthController } from '../src/auth/customer-auth.controller.js';
import { CUSTOMER_LOGIN_RATE_LIMITER } from '../src/auth/customer-login-rate.guard.js';
import { CustomerLoginDto } from '../src/auth/customer-login.dto.js';
import { CustomerPasswordService } from '../src/auth/customer-password.service.js';
import { CustomerProfileDto } from '../src/auth/customer-profile.dto.js';
import { CustomerProfileService } from '../src/auth/customer-profile.service.js';
import { JwtTokenService } from '../src/auth/jwt-token.service.js';
import { LoginRateLimiter } from '../src/auth/login-rate-limiter.js';
import { PasswordService } from '../src/auth/password.service.js';
import { configureApp } from '../src/common/configure-app.js';
import { APP_CONFIG, loadConfiguration } from '../src/config/environment.js';
import { PermissionService } from '../src/permissions/permission.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { assertSafeTestDatabase } from '../scripts/database-env.js';

const safe = assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('集成测试仅可在test环境执行');
// Vitest不生成DTO参数元数据，编译API子进程另验真实tsc路径。
Reflect.defineMetadata('design:paramtypes', [CustomerLoginDto, Object], CustomerAuthController.prototype, 'login');
Reflect.defineMetadata('design:paramtypes', [CustomerProfileDto, Object, Object], CustomerAuthController.prototype, 'update');
Reflect.defineMetadata('design:paramtypes', [ChangePasswordDto, Object, Object], CustomerAuthController.prototype, 'changePassword');
const oldPassword = ' CustomerOld#2026 '; const newPassword = ' CustomerNew#2026 ';
const wrongPassword = 'WrongCustomer#2026'; const otherPassword = 'OtherCustomer#2026';
let oldHash = ''; let otherHash = ''; let spaceHash = ''; let millis = Date.parse('2026-11-12T01:00:00.500Z'); const clock = () => new Date(millis);
const tokens = new JwtTokenService({ secret: 'customer-profile-password-test-'.repeat(3), ttlSeconds: 7200 }, clock);
const sessions = new AuthSessionService(tokens, clock);
class ControlledPasswords extends PasswordService {
  checks = 0; hashes = 0; afterHash: (() => Promise<void>) | undefined;
  override async verify(value: string, hash: string) { this.checks++; return super.verify(value, hash); }
  override async hash(value: string) { this.hashes++; const hash = await super.hash(value); await this.afterHash?.(); return hash; }
}
class ControlledAudit extends AuditService {
  fail = false; afterAppend: ((tx: Prisma.TransactionClient, payload: AuditPayload) => Promise<void>) | undefined;
  override async appendAudit(tx: Prisma.TransactionClient, payload: AuditPayload) {
    await super.appendAudit(tx, payload); await this.afterAppend?.(tx, payload);
    if (this.fail) throw new Error('private-customer-audit-failure');
  }
}
class ControlledIdentities extends CurrentIdentityService {
  afterRead: ((identity: CurrentIdentity) => Promise<void>) | undefined;
  override async authenticate(db: Pick<Prisma.TransactionClient, '$queryRaw'>, token: string, subject: SubjectType) {
    const identity = await super.authenticate(db, token, subject);
    if (typeof (db as { $connect?: unknown }).$connect === 'function') await this.afterRead?.(identity);
    return identity;
  }
}
const passwords = new ControlledPasswords(); const audit = new ControlledAudit();
const identities = new ControlledIdentities(tokens, new PermissionService(), clock);
let app: INestApplication; let prisma: PrismaService; let peer: PrismaService; let baseUrl = '';
let profileSpy: MockInstance<CustomerProfileService['update']>; let passwordSpy: MockInstance<CustomerPasswordService['changePassword']>;
const customerIds = new Set<string>(); const employeeIds = new Set<string>(); const phones = new Set<string>();
beforeAll(async () => {
  [oldHash, otherHash, spaceHash] = await Promise.all([passwords.hash(oldPassword), passwords.hash(otherPassword), passwords.hash('        ')]);
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG).useValue(loadConfiguration({ ...process.env, LOG_LEVEL: 'silent' }))
    .overrideProvider(JwtTokenService).useValue(tokens).overrideProvider(AuthSessionService).useValue(sessions)
    .overrideProvider(CurrentIdentityService).useValue(identities).overrideProvider(PasswordService).useValue(passwords)
    .overrideProvider(AuditService).useValue(audit)
    .overrideProvider(CUSTOMER_LOGIN_RATE_LIMITER).useValue(new LoginRateLimiter(() => millis, undefined, 'CUSTOMER')).compile();
  app = module.createNestApplication(); configureApp(app); await app.listen(0, '127.0.0.1'); prisma = app.get(PrismaService); baseUrl = await app.getUrl();
  peer = new PrismaService(loadConfiguration()); await peer.onModuleInit();
  profileSpy = vi.spyOn(app.get(CustomerProfileService), 'update'); passwordSpy = vi.spyOn(app.get(CustomerPasswordService), 'changePassword');
});
beforeEach(() => {
  millis += 360_000; passwords.checks = 0; passwords.hashes = 0; passwords.afterHash = undefined;
  audit.fail = false; audit.afterAppend = undefined; identities.afterRead = undefined; profileSpy.mockClear(); passwordSpy.mockClear();
});
afterEach(async () => {
  passwords.afterHash = undefined; audit.fail = false; audit.afterAppend = undefined; identities.afterRead = undefined;
  if (!prisma) return;
  // 只清理本文件自建UUID和预先确认不存在的随机手机号，不清空测试库未知数据。
  for (const row of await prisma.customer.findMany({ where: { phone: { in: [...phones] } }, select: { id: true } })) customerIds.add(row.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorCustomerId: { in: [...customerIds] } }, { actorEmployeeId: { in: [...employeeIds] } }] } });
  await prisma.authSession.deleteMany({ where: { OR: [{ customerId: { in: [...customerIds] } }, { employeeId: { in: [...employeeIds] } }] } });
  await prisma.customer.deleteMany({ where: { id: { in: [...customerIds] } } }); await prisma.employee.deleteMany({ where: { id: { in: [...employeeIds] } } });
  customerIds.clear(); employeeIds.clear(); phones.clear();
});
afterAll(async () => { profileSpy?.mockRestore(); passwordSpy?.mockRestore(); await peer?.$disconnect(); await app?.close(); });
async function phone() {
  let value: string;
  do { value = `186${randomInt(100_000_000).toString().padStart(8, '0')}`; }
  while (phones.has(value) || await prisma.customer.findUnique({ where: { phone: value }, select: { id: true } }));
  phones.add(value); return value;
}
async function customer(status: CustomerStatus = 'NORMAL', passwordHash = oldHash) {
  const id = randomUUID(); customerIds.add(id);
  return prisma.customer.create({ data: { id, phone: await phone(), nickname: '本人原昵称', status, passwordHash, createdAt: new Date('2026-01-01T00:00:00Z') } });
}
async function request(path: string, method: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/api/v1/${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'private-input',
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function login(account: { phone: string }, password = oldPassword) { return request('store/auth/login', 'POST', { phone: account.phone, password }); }
async function access(account: { phone: string }, password = oldPassword) {
  const response = await login(account, password); expect(response.status).toBe(200);
  return (await response.json() as { data: { accessToken: string } }).data.accessToken;
}
async function update(token?: string, input: unknown = { nickname: '本人新昵称' }, suffix = '', headers: Record<string, string> = {}) {
  return request(`store/me${suffix}`, 'PATCH', input, token, headers);
}
async function change(token?: string, input: unknown = { oldPassword, newPassword }, suffix = '', headers: Record<string, string> = {}) {
  return request(`store/auth/change-password${suffix}`, 'POST', input, token, headers);
}
async function me(token: string) { return request('store/me', 'GET', undefined, token); }
async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status); const body = await response.json() as { code: string; requestId: string };
  expect(body.code).toBe(code); expect(body.requestId).toBe(response.headers.get('x-request-id'));
  for (const secret of [oldPassword, newPassword, wrongPassword, otherPassword, oldHash, otherHash, 'private-input', 'private-customer-audit-failure', ...phones]) expect(JSON.stringify(body)).not.toContain(secret);
}
async function success(response: Response) {
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store'); expect(response.headers.get('set-cookie')).toBeNull();
  const body = await response.json() as { data: Record<string, unknown>; requestId: string };
  expect(Object.keys(body).sort()).toEqual(['data', 'requestId']); expect(body.requestId).toBe(response.headers.get('x-request-id')); expect(body.requestId).not.toBe('private-input'); return body;
}
async function facts(id: string) {
  return { customer: await prisma.customer.findUniqueOrThrow({ where: { id } }),
    sessions: await prisma.authSession.findMany({ where: { customerId: id }, orderBy: { id: 'asc' } }),
    audits: await prisma.auditLog.findMany({ where: { actorCustomerId: id }, orderBy: { id: 'asc' } }) };
}
function barrier() {
  let release!: () => void; let signal!: () => void; const hold = new Promise<void>(resolve => { release = resolve; }); const ready = new Promise<void>(resolve => { signal = resolve; });
  return { release, signal, hold, ready };
}
async function waitForBlocker(pid: number) {
  const deadline = performance.now() + 550;
  while (performance.now() < deadline) {
    const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(pid))) AS waiting`;
    if (row?.waiting) return; await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('未观察到顾客主体锁等待');
}

it.each(['NORMAL', 'TRADE_RESTRICTED'] as const)('%s可修改本人昵称，仅改变昵称/更新时间，审计和安全六字段一致', async status => {
  const account = await customer(status); const token = await access(account); const second = await access(account); const before = await facts(account.id);
  const body = await success(await update(token, { nickname: '  顾客甲（新昵称）  ' }));
  expect(body.data).toEqual({ id: account.id, phone: account.phone, nickname: '顾客甲（新昵称）', status, avatarUrl: null, createdAt: account.createdAt.toISOString() });
  const after = await facts(account.id);
  expect({ ...after.customer, nickname: before.customer.nickname, updatedAt: before.customer.updatedAt }).toEqual(before.customer);
  expect(after.sessions).toEqual(before.sessions); expect(after.audits).toHaveLength(1);
  expect(after.audits[0]).toMatchObject({ actorType: 'CUSTOMER', actorCustomerId: account.id, actorEmployeeId: null,
    action: 'customer.profile.update', targetType: 'Customer', targetId: account.id, reason: null, requestId: body.requestId,
    beforeData: { nickname: account.nickname }, afterData: { nickname: '顾客甲（新昵称）' } });
  for (const secret of [account.phone, oldHash, token]) expect(JSON.stringify(after.audits)).not.toContain(secret);
  expect((await success(await me(second))).data.nickname).toBe('顾客甲（新昵称）');
});
it('同名保存不更新账号/会话/审计，40个emoji昵称可保存', async () => {
  const account = await customer(); const token = await access(account); const before = await facts(account.id); audit.fail = true;
  await success(await update(token, { nickname: ` ${account.nickname} ` })); expect(await facts(account.id)).toEqual(before);
  audit.fail = false; const nickname = '😀'.repeat(40); expect((await success(await update(token, { nickname }))).data.nickname).toBe(nickname);
});
it('查询参数及请求头不能切换他人，头像与手机号保持', async () => {
  const account = await customer(); const other = await customer(); const token = await access(account); const otherBefore = await facts(other.id);
  const result = await success(await update(token, undefined, `?id=${other.id}&phone=${other.phone}`, { 'X-Subject-Id': other.id, 'X-Role': 'SUPER_ADMIN' }));
  expect(result.data.id).toBe(account.id); expect(result.data.phone).toBe(account.phone); expect(result.data.avatarUrl).toBeNull(); expect(await facts(other.id)).toEqual(otherBefore);
});
const badProfiles: [string, unknown][] = [
  ['缺昵称', {}], ['null昵称', { nickname: null }], ['数字昵称', { nickname: 123 }], ['数组昵称', { nickname: [] }], ['对象昵称', { nickname: {} }],
  ['空昵称', { nickname: '' }], ['空白昵称', { nickname: ' \t ' }], ['41中文', { nickname: '名'.repeat(41) }], ['41emoji', { nickname: '😀'.repeat(41) }],
  ...['id', 'customerId', 'phone', 'status', 'role', 'avatarUrl', 'avatarAssetId', 'password', 'passwordHash', 'tokenVersion', 'reason', 'expectedVersion'].map(field => [field, { nickname: '不能注入', [field]: 'private-input' }] as [string, unknown]),
  ['数组正文', []], ['数字正文', 123], ['null正文', null],
];
it.each(badProfiles)('昵称非法输入%s400，不进入服务且事实不变', async (_name, input) => {
  const account = await customer(); const token = await access(account); const before = await facts(account.id);
  await error(await update(token, input), 400, 'VALIDATION_FAILED'); expect(profileSpy).not.toHaveBeenCalled(); expect(await facts(account.id)).toEqual(before);
});

it.each(['NORMAL', 'TRADE_RESTRICTED'] as const)('%s改密撤销全部会话，保留既有注销和他人资料，新密码重登', async status => {
  const account = await customer(status); const token = await access(account); const second = await access(account); const revoked = await access(account);
  await success(await request('auth/logout', 'POST', {}, revoked)); const claims = await tokens.verify(revoked, 'CUSTOMER');
  const previous = await prisma.authSession.findUniqueOrThrow({ where: { id: claims.sid } });
  const other = await customer(); const otherToken = await access(other); const otherBefore = await facts(other.id); const before = await facts(account.id);
  const body = await success(await change(token, undefined, `?id=${other.id}`, { 'X-Subject-Id': other.id })); expect(body.data).toEqual({ changed: true, requireLogin: true });
  const after = await facts(account.id); expect(after.customer.tokenVersion).toBe(1);
  expect({ ...after.customer, passwordHash: before.customer.passwordHash, tokenVersion: before.customer.tokenVersion, updatedAt: before.customer.updatedAt }).toEqual(before.customer);
  expect(after.customer.passwordHash).not.toBe(oldHash); expect(after.customer.passwordHash).toMatch(/^\$2[aby]\$12\$/);
  expect(await new PasswordService().verify(newPassword, after.customer.passwordHash)).toBe(true);
  expect(after.sessions).toHaveLength(3); expect(after.sessions.every(row => row.revokedAt !== null)).toBe(true);
  expect(after.sessions.find(row => row.id === claims.sid)).toEqual(previous);
  expect(after.sessions.filter(row => row.id !== claims.sid).every(row => row.revokeReason === 'PASSWORD_CHANGED')).toBe(true);
  const changes = after.audits.filter(row => row.action === 'customer.password.change'); expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({ actorType: 'CUSTOMER', actorCustomerId: account.id, actorEmployeeId: null, targetType: 'Customer', targetId: account.id,
    requestId: body.requestId, reason: null, beforeData: null, afterData: { passwordChanged: true } }); expect(after.audits).toHaveLength(2);
  for (const secret of [oldPassword, newPassword, oldHash, after.customer.passwordHash, token, account.phone]) expect(JSON.stringify(after.audits)).not.toContain(secret);
  for (const credential of [token, second]) { await error(await me(credential), 401, 'SESSION_REVOKED'); await error(await update(credential), 401, 'SESSION_REVOKED'); }
  await error(await change(token), 401, 'SESSION_REVOKED'); await error(await login(account), 401, 'INVALID_CREDENTIALS');
  const fresh = await access(account, newPassword); expect((await tokens.verify(fresh, 'CUSTOMER')).tokenVersion).toBe(1); await success(await me(fresh));
  expect(await facts(other.id)).toEqual(otherBefore); await success(await me(otherToken));
});
it('旧密码错误不哈希新密码，不写任何资料、会话或审计，原会话仍可用', async () => {
  const account = await customer(); const token = await access(account); const before = await facts(account.id); passwords.checks = 0; passwords.hashes = 0;
  await error(await change(token, { oldPassword: wrongPassword, newPassword }), 401, 'INVALID_CREDENTIALS');
  expect(passwords.checks).toBe(1); expect(passwords.hashes).toBe(0); expect(await facts(account.id)).toEqual(before); await success(await me(token));
});
const badPasswords: [string, unknown][] = [
  ['缺全部', {}], ['缺旧密码', { newPassword }], ['缺新密码', { oldPassword }], ['旧密码null', { oldPassword: null, newPassword }],
  ['新密码数字', { oldPassword, newPassword: 12345678 }], ['旧密码数组', { oldPassword: [], newPassword }], ['新密码对象', { oldPassword, newPassword: {} }],
  ['旧密码不足8码点', { oldPassword: 'short', newPassword }], ['新密码不足8码点', { oldPassword, newPassword: '😀'.repeat(7) }],
  ['新密码超64码点', { oldPassword, newPassword: 'a'.repeat(65) }], ['旧密码超72字节', { oldPassword: '密'.repeat(25), newPassword }],
  ['新密码超72字节', { oldPassword, newPassword: '😀'.repeat(19) }], ['非法Unicode', { oldPassword, newPassword: 'abcdefg\ud800' }],
  ['新旧相同', { oldPassword, newPassword: oldPassword }],
  ...['id', 'customerId', 'phone', 'status', 'tokenVersion', 'passwordHash', 'nickname', 'reason'].map(field => [field, { oldPassword, newPassword, [field]: 'private-input' }] as [string, unknown]),
];
it.each(badPasswords)('改密非法输入%s400且不执行bcrypt，事实保持', async (_name, input) => {
  const account = await customer(); const token = await access(account); const before = await facts(account.id); passwords.checks = 0; passwords.hashes = 0;
  await error(await change(token, input), 400, 'VALIDATION_FAILED'); expect(passwords.checks).toBe(0); expect(passwords.hashes).toBe(0); expect(await facts(account.id)).toEqual(before);
});
it('改密保留空格且八个空格和九个空格为不同密码', async () => {
  const account = await customer('NORMAL', spaceHash); const token = await access(account, '        ');
  await success(await change(token, { oldPassword: '        ', newPassword: '         ' }));
  await error(await login(account, '        '), 401, 'INVALID_CREDENTIALS'); await access(account, '         ');
});
it('72字节Unicode新密码完整生效，不静默截断', async () => {
  const account = await customer(); const token = await access(account); const value = '😀'.repeat(18);
  await success(await change(token, { oldPassword, newPassword: value })); await access(account, value);
  expect(await new PasswordService().verify(value, (await facts(account.id)).customer.passwordHash)).toBe(true);
});

it.each(['昵称', '改密'] as const)('%s拒绝缺凭证/其他认证来源/员工域/冻结/注销/到期，服务未调用', async operation => {
  const account = await customer(); const token = await access(account); const act = operation === '昵称' ? update : change;
  await error(await act(), 401, 'TOKEN_INVALID');
  await error(await act(undefined, undefined, '', { Cookie: `token=${token}` }), 401, 'TOKEN_INVALID');
  await error(await act(undefined, undefined, `?token=${token}`), 401, 'TOKEN_INVALID');
  const id = randomUUID(); employeeIds.add(id); await prisma.employee.create({ data: { id, username: `cp_${id.replaceAll('-', '').slice(0, 20)}`, displayName: '员工域', role: 'CUSTOMER_SERVICE', mustChangePassword: false, passwordHash: oldHash, createdAt: new Date('2026-01-01T00:00:00Z') } });
  const issued = await prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx, { subjectType: 'EMPLOYEE', subjectId: id, expectedPasswordHash: oldHash, expectedTokenVersion: 0 }));
  await error(await act(issued.accessToken, {}), 401, 'TOKEN_SUBJECT_MISMATCH');
  await peer.customer.update({ where: { id: account.id }, data: { status: 'LOGIN_FROZEN' } }); await error(await act(token, {}), 401, 'ACCOUNT_UNAVAILABLE');
  await peer.customer.update({ where: { id: account.id }, data: { status: 'NORMAL' } });
  const fresh = await access(account); await success(await request('auth/logout', 'POST', {}, token)); await error(await act(token, {}), 401, 'SESSION_REVOKED');
  const claims = await tokens.verify(fresh, 'CUSTOMER'); millis = claims.exp * 1000; await error(await act(fresh, {}), 401, 'TOKEN_EXPIRED');
  expect(profileSpy).not.toHaveBeenCalled(); expect(passwordSpy).not.toHaveBeenCalled(); expect(passwords.hashes).toBe(0);
  expect((await facts(account.id)).customer.passwordHash).toBe(oldHash); expect((await facts(account.id)).customer.nickname).toBe(account.nickname);
});
it.each(['昵称', '改密'] as const)('%s审计写后故障回滚全部变更，peer不见半提交，解除故障可重试', async operation => {
  const account = await customer(); const token = await access(account); const second = await access(account); const before = await facts(account.id); let observed = false;
  audit.fail = true; audit.afterAppend = async (tx, payload) => {
    const current = await tx.customer.findUniqueOrThrow({ where: { id: account.id } });
    expect(await tx.auditLog.count({ where: { requestId: payload.requestId } })).toBe(1);
    if (operation === '昵称') expect(current.nickname).toBe('本人新昵称');
    else { expect(current.passwordHash).not.toBe(oldHash); expect(current.tokenVersion).toBe(1); expect(await tx.authSession.count({ where: { customerId: account.id, revokedAt: null } })).toBe(0); }
    expect(await peer.customer.findUniqueOrThrow({ where: { id: account.id } })).toEqual(before.customer);
    expect(await peer.authSession.findMany({ where: { customerId: account.id }, orderBy: { id: 'asc' } })).toEqual(before.sessions); observed = true;
  };
  const act = operation === '昵称' ? update : change; await error(await act(token), 500, 'INTERNAL_ERROR'); expect(observed).toBe(true); expect(await facts(account.id)).toEqual(before);
  await success(await me(token)); await success(await me(second)); audit.fail = false; audit.afterAppend = undefined; await success(await act(token)); expect((await facts(account.id)).audits).toHaveLength(1);
});
it.each(['冻结', '注销', '到期', '版本变化'] as const)('昵称Guard通过后发生%s，锁内重验优先且不写审计', async operation => {
  const account = await customer(); const token = await access(account); const claims = await tokens.verify(token, 'CUSTOMER');
  identities.afterRead = async () => {
    identities.afterRead = undefined;
    if (operation === '到期') { millis = claims.exp * 1000; return; }
    await peer.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM customer WHERE id=${account.id}::uuid FOR UPDATE`;
      if (operation === '注销') await sessions.revokeCurrent(tx, { subjectType: 'CUSTOMER', subjectId: account.id }, claims.sid);
      else await tx.customer.update({ where: { id: account.id }, data: operation === '冻结' ? { status: 'LOGIN_FROZEN' } : { tokenVersion: 1 } });
    });
  };
  await error(await update(token), 401, operation === '冻结' ? 'ACCOUNT_UNAVAILABLE' : operation === '注销' ? 'SESSION_REVOKED' : operation === '到期' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID');
  expect(profileSpy).toHaveBeenCalledTimes(1); const after = await facts(account.id); expect(after.customer.nickname).toBe(account.nickname); expect(after.audits).toEqual([]);
});
it.each(['冻结', '注销', '到期', '仅换哈希', '令牌版本', '限制交易'] as const)('改密bcrypt完成后并发%s，锁内检查最新状态和密码快照', async operation => {
  const account = await customer(); const token = await access(account); const claims = await tokens.verify(token, 'CUSTOMER'); const gate = barrier();
  passwords.afterHash = async () => { gate.signal(); await gate.hold; }; const pending = change(token);
  try {
    await Promise.race([gate.ready, pending.then(() => { throw new Error('未进入顾客改密屏障'); })]);
    if (operation === '到期') millis = claims.exp * 1000;
    else await peer.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM customer WHERE id=${account.id}::uuid FOR UPDATE`;
      if (operation === '注销') await sessions.revokeCurrent(tx, { subjectType: 'CUSTOMER', subjectId: account.id }, claims.sid);
      else {
        await tx.customer.update({ where: { id: account.id }, data: operation === '仅换哈希' ? { passwordHash: otherHash }
          : operation === '令牌版本' ? { tokenVersion: 1 } : { status: operation === '冻结' ? 'LOGIN_FROZEN' : 'TRADE_RESTRICTED' } });
        if (operation === '冻结') { await tx.customer.update({ where: { id: account.id }, data: { tokenVersion: 1 } }); await sessions.revokeAll(tx, { subjectType: 'CUSTOMER', subjectId: account.id }, 'LOGIN_FROZEN'); }
      }
    });
    const beforeRelease = await facts(account.id); gate.release();
    if (operation === '限制交易') { await success(await pending); expect((await facts(account.id)).customer.status).toBe('TRADE_RESTRICTED'); }
    else { await error(await pending, 401, operation === '到期' ? 'TOKEN_EXPIRED' : operation === '仅换哈希' ? 'INVALID_CREDENTIALS' : operation === '令牌版本' ? 'TOKEN_INVALID' : 'SESSION_REVOKED'); expect(await facts(account.id)).toEqual(beforeRelease); }
  } finally { gate.release(); await pending; passwords.afterHash = undefined; }
});
it('两个会话均通过旧密码验证后并发改密，仅一次成功/版本递增/审计', async () => {
  const account = await customer(); const first = await access(account); const second = await access(account); const gate = barrier(); let count = 0;
  passwords.afterHash = async () => { if (++count === 2) gate.signal(); await gate.hold; };
  const requests = [change(first), change(second, { oldPassword, newPassword: otherPassword })];
  try {
    await Promise.race([gate.ready, ...requests.map(pending => pending.then(() => { throw new Error('并发顾客改密未进入屏障'); }))]);
    gate.release(); const results = await Promise.all(requests); expect(results.map(row => row.status).sort()).toEqual([200, 401]);
    const after = await facts(account.id); expect(after.customer.tokenVersion).toBe(1); expect(after.audits).toHaveLength(1); expect(after.sessions.every(row => row.revokeReason === 'PASSWORD_CHANGED')).toBe(true);
    expect(await new PasswordService().verify(results[0]!.status === 200 ? newPassword : otherPassword, after.customer.passwordHash)).toBe(true);
  } finally { gate.release(); await Promise.all(requests); passwords.afterHash = undefined; }
});
it.each(['昵称先', '改密先'] as const)('%s持顾客锁，另一真实HTTP命令等待后按最新会话裁决', async order => {
  const account = await customer(); const token = await access(account); const gate = barrier(); const hashed = barrier(); let pid = 0;
  audit.afterAppend = async (tx, payload) => {
    if (payload.action !== (order === '昵称先' ? 'customer.profile.update' : 'customer.password.change')) return;
    pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold;
  };
  // 先完成慢速bcrypt，再控制实际取锁顺序，避免把CPU耗时算入750ms持锁预算。
  let second: Promise<Response> | undefined;
  if (order === '昵称先') {
    passwords.afterHash = async () => { hashed.signal(); await hashed.hold; }; second = change(token);
    await Promise.race([hashed.ready, second.then(() => { throw new Error('未进入改密哈希屏障'); })]);
  }
  const first = order === '昵称先' ? update(token) : change(token);
  try {
    await Promise.race([gate.ready, first.then(() => { throw new Error('未进入首命令审计屏障'); })]);
    if (order === '昵称先') hashed.release(); else second = update(token);
    await waitForBlocker(pid); gate.release(); await success(await first);
    if (!second) throw new Error('缺少第二命令');
    if (order === '昵称先') { await success(await second); expect((await facts(account.id)).customer.nickname).toBe('本人新昵称'); expect((await facts(account.id)).audits).toHaveLength(2); }
    else { await error(await second, 401, 'SESSION_REVOKED'); expect((await facts(account.id)).customer.nickname).toBe(account.nickname); expect((await facts(account.id)).audits).toHaveLength(1); }
    expect((await facts(account.id)).customer.tokenVersion).toBe(1); await error(await me(token), 401, 'SESSION_REVOKED');
  } finally { hashed.release(); gate.release(); await Promise.allSettled([first, ...(second ? [second] : [])]); }
});
it('并发昵称修改按锁顺序提交，后审计的原昵称来自首提交结果', async () => {
  const account = await customer(); const token = await access(account); const gate = barrier(); let pid = 0;
  audit.afterAppend = async (tx, payload) => {
    if (payload.after?.nickname !== '首个昵称') return;
    pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold;
  };
  const first = update(token, { nickname: '首个昵称' }); let second: Promise<Response> | undefined;
  try {
    await gate.ready; second = update(token, { nickname: '后个昵称' }); await waitForBlocker(pid); gate.release(); await success(await first); await success(await second);
    const after = await facts(account.id); expect(after.customer.nickname).toBe('后个昵称'); expect(after.audits).toHaveLength(2);
    expect(after.audits.find(row => (row.afterData as { nickname: string }).nickname === '后个昵称')?.beforeData).toEqual({ nickname: '首个昵称' });
  } finally { gate.release(); await Promise.allSettled([first, ...(second ? [second] : [])]); }
});
it('编译API真实注册/登录/改昵称/改密/全部会话失效/新密码重登完整链路', async () => {
  const value = await phone();
  const source = String.raw`
    require('reflect-metadata');const {NestFactory}=require('@nestjs/core');const {AppModule}=require('./dist/app.module.js');const {configureApp}=require('./dist/common/configure-app.js');
    (async()=>{const app=await NestFactory.create(AppModule,{logger:false});try{configureApp(app);await app.listen(0,'127.0.0.1');const url=await app.getUrl();
      const send=(path,method,body,token)=>fetch(url+'/api/v1/'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
      const input={phone:process.env.SHOP_TEST_PHONE,password:process.env.SHOP_TEST_OLD_PASSWORD};const reg=await send('store/auth/register','POST',input);const registered=await reg.json();
      const login=await send('store/auth/login','POST',input);const token=(await login.json()).data.accessToken;const two=await send('store/auth/login','POST',input);const second=(await two.json()).data.accessToken;
      const invalidProfile=await send('store/me','PATCH',{nickname:'编译顾客',id:registered.data.id},token);const profile=await send('store/me','PATCH',{nickname:' 编译顾客 '},token);const details=await profile.json();
      const pwd={oldPassword:input.password,newPassword:process.env.SHOP_TEST_NEW_PASSWORD};const invalidPassword=await send('store/auth/change-password','POST',{...pwd,status:'NORMAL'},token);
      const changed=await send('store/auth/change-password','POST',pwd,token);const result=await changed.json();const old=await send('store/me','GET',undefined,token);const other=await send('store/me','GET',undefined,second);
      const oldLogin=await send('store/auth/login','POST',input);const fresh=await send('store/auth/login','POST',{...input,password:pwd.newPassword});const credential=(await fresh.json()).data.accessToken;const me=await send('store/me','GET',undefined,credential);const own=await me.json();
      console.log(JSON.stringify({id:registered.data.id,registered:reg.status,login:login.status,invalidProfile:invalidProfile.status,profile:profile.status,profileFields:Object.keys(details.data).sort(),nickname:details.data.nickname,avatar:details.data.avatarUrl,
        invalidPassword:invalidPassword.status,changed:changed.status,data:result.data,old:old.status,other:other.status,oldLogin:oldLogin.status,fresh:fresh.status,me:me.status,newNickname:own.data.nickname}));
    }finally{await app.close();}})().catch(()=>{console.error('编译后顾客资料改密验证失败');process.exitCode=1;});`;
  const child = spawnSync(process.execPath, ['-e', source], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true, timeout: 15_000,
    env: { ...process.env, DATABASE_URL: safe.testUrl, LOG_LEVEL: 'silent', SHOP_TEST_PHONE: value, SHOP_TEST_OLD_PASSWORD: oldPassword, SHOP_TEST_NEW_PASSWORD: newPassword } });
  expect(child.status).toBe(0); const result = JSON.parse(child.stdout.trim()) as { id: string }; customerIds.add(result.id);
  expect(result).toEqual({ id: result.id, registered: 201, login: 200, invalidProfile: 400, profile: 200, profileFields: ['avatarUrl', 'createdAt', 'id', 'nickname', 'phone', 'status'], nickname: '编译顾客', avatar: null,
    invalidPassword: 400, changed: 200, data: { changed: true, requireLogin: true }, old: 401, other: 401, oldLogin: 401, fresh: 200, me: 200, newNickname: '编译顾客' });
  const after = await facts(result.id); expect(after.customer.tokenVersion).toBe(1); expect(after.sessions).toHaveLength(3); expect(after.sessions.filter(row => row.revokedAt === null)).toHaveLength(1);
  expect(after.audits.map(row => row.action).sort()).toEqual(['customer.password.change', 'customer.profile.update', 'customer.register']);
  for (const secret of [oldPassword, newPassword, oldHash, value]) expect(child.stdout + child.stderr).not.toContain(secret);
});
