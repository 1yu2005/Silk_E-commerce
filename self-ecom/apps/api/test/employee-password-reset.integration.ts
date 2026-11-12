// 作用：验证他人密码重置、禁止本人重置、强制改密、并发与原子回滚。
import 'reflect-metadata';
import { randomInt, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import type { INestApplication } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuditService, type AuditPayload } from '../src/audit/audit.service.js';
import { AuthSessionService } from '../src/auth/auth-session.service.js';
import { ChangePasswordDto } from '../src/auth/change-password.dto.js';
import { CurrentIdentityService } from '../src/auth/current-identity.service.js';
import { EmployeeAuthController } from '../src/auth/employee-auth.controller.js';
import { EmployeeLoginDto } from '../src/auth/employee-login.dto.js';
import { JwtTokenService } from '../src/auth/jwt-token.service.js';
import { PasswordService } from '../src/auth/password.service.js';
import { configureApp } from '../src/common/configure-app.js';
import { APP_CONFIG, loadConfiguration } from '../src/config/environment.js';
import { EmployeeEligibilityService } from '../src/employees/employee-eligibility.service.js';
import { EmployeePasswordResetController } from '../src/employees/employee-password-reset.controller.js';
import { EmployeePasswordResetDto } from '../src/employees/employee-password-reset.dto.js';
import { EmployeePasswordResetService } from '../src/employees/employee-password-reset.service.js';
import { EmployeeIdParamsDto } from '../src/employees/employee-query.dto.js';
import { seedPermissionCatalog } from '../src/permissions/permission-seed.js';
import { PermissionService } from '../src/permissions/permission.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { assertSafeTestDatabase } from '../scripts/database-env.js';

assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('集成测试仅可在test环境执行');
// Vitest不生成参数元数据；另用编译API子进程验证生产tsc路径。
Reflect.defineMetadata('design:paramtypes', [EmployeeIdParamsDto, EmployeePasswordResetDto, Object, Object], EmployeePasswordResetController.prototype, 'reset');
Reflect.defineMetadata('design:paramtypes', [EmployeeLoginDto, Object], EmployeeAuthController.prototype, 'login');
Reflect.defineMetadata('design:paramtypes', [ChangePasswordDto, Object, Object], EmployeeAuthController.prototype, 'changePassword');
const oldPassword = 'OldResetEmployee#2026'; const temporaryPassword = ' TemporaryReset#2026 '; const newPassword = 'AfterReset#2026';
let passwordHash = ''; let millis = Date.parse('2026-11-12T01:00:00.500Z'); const clock = () => new Date(millis);
const tokens = new JwtTokenService({ secret: 'employee-reset-integration-only-'.repeat(3), ttlSeconds: 7200 }, clock);
const sessions = new AuthSessionService(tokens, clock);
class ControlledPasswords extends PasswordService {
  hashes = 0; checks = 0; failHash = false;
  afterHash: (() => Promise<void>) | undefined;
  afterVerify: ((value: string, result: boolean) => Promise<void>) | undefined;
  override async hash(value: string) {
    this.hashes++; const result = await super.hash(value); await this.afterHash?.();
    if (this.failHash) throw new Error('测试专用重置哈希故障'); return result;
  }
  override async verify(value: string, hash: string) {
    this.checks++; const result = await super.verify(value, hash); await this.afterVerify?.(value, result); return result;
  }
}
class ControlledAudit extends AuditService {
  fail = false; observedWrites = false; afterWrite: ((tx: Prisma.TransactionClient) => Promise<void>) | undefined;
  override async appendAudit(tx: Prisma.TransactionClient, payload: AuditPayload) {
    await super.appendAudit(tx, payload); if (payload.action !== 'employee.password.reset') return;
    const target = await tx.employee.findUniqueOrThrow({ where: { id: payload.targetId } });
    this.observedWrites = target.mustChangePassword && target.tokenVersion > 0 && target.passwordHash !== passwordHash
      && await tx.authSession.count({ where: { employeeId: target.id, revokedAt: null } }) === 0
      && await tx.auditLog.count({ where: { requestId: payload.requestId } }) === 1;
    await this.afterWrite?.(tx); if (this.fail) throw new Error('测试专用重置审计故障');
  }
}
const passwords = new ControlledPasswords(); const audit = new ControlledAudit();
let app: INestApplication; let prisma: PrismaService; let peer: PrismaService; let baseUrl = ''; let actorId = ''; let token = '';
let resetSpy: MockInstance<EmployeePasswordResetService['reset']>;
let eligibilitySpy: MockInstance<EmployeeEligibilityService['onEmployeeEligibilityChanged']>;
const ids = new Set<string>(); const customerIds = new Set<string>();
beforeAll(async () => {
  passwordHash = await new PasswordService().hash(oldPassword);
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG).useValue(loadConfiguration({ ...process.env, LOG_LEVEL: 'silent' }))
    .overrideProvider(JwtTokenService).useValue(tokens).overrideProvider(AuthSessionService).useValue(sessions)
    .overrideProvider(CurrentIdentityService).useValue(new CurrentIdentityService(tokens, new PermissionService(), clock))
    .overrideProvider(PasswordService).useValue(passwords).overrideProvider(AuditService).useValue(audit).compile();
  app = module.createNestApplication(); configureApp(app); await app.listen(0, '127.0.0.1');
  prisma = app.get(PrismaService); baseUrl = await app.getUrl(); peer = new PrismaService(loadConfiguration()); await peer.onModuleInit();
  await seedPermissionCatalog(prisma); resetSpy = vi.spyOn(app.get(EmployeePasswordResetService), 'reset');
  eligibilitySpy = vi.spyOn(app.get(EmployeeEligibilityService), 'onEmployeeEligibilityChanged');
});
beforeEach(async () => {
  millis += 360_000; passwords.hashes = 0; passwords.checks = 0; passwords.failHash = false; passwords.afterHash = undefined; passwords.afterVerify = undefined;
  audit.fail = false; audit.observedWrites = false; audit.afterWrite = undefined; resetSpy.mockClear(); eligibilitySpy.mockClear();
  const actor = await employee({ role: 'SUPER_ADMIN' }); actorId = actor.id; token = await access(actor.id);
});
afterEach(async () => {
  passwords.afterHash = undefined; passwords.afterVerify = undefined; passwords.failHash = false; audit.fail = false; audit.afterWrite = undefined;
  // 只清理本文件创建的UUID，保留独立测试库已有及未知数据。
  if (!prisma) return;
  await prisma.employeeExtraPermission.deleteMany({ where: { employeeId: { in: [...ids] } } });
  await prisma.auditLog.deleteMany({ where: { actorEmployeeId: { in: [...ids] } } });
  await prisma.authSession.deleteMany({ where: { OR: [{ employeeId: { in: [...ids] } }, { customerId: { in: [...customerIds] } }] } });
  await prisma.employee.deleteMany({ where: { id: { in: [...ids] } } });
  await prisma.customer.deleteMany({ where: { id: { in: [...customerIds] } } }); ids.clear(); customerIds.clear();
});
afterAll(async () => { resetSpy?.mockRestore(); eligibilitySpy?.mockRestore(); await peer?.$disconnect(); await app?.close(); });
async function employee(input: Partial<Prisma.EmployeeUncheckedCreateInput> = {}) {
  const id = input.id ?? randomUUID(); ids.add(id);
  return prisma.employee.create({ data: { id, username: `er_${randomUUID().replaceAll('-', '').slice(0, 20)}`, displayName: '重置员工夹具',
    role: 'CUSTOMER_SERVICE', passwordHash, mustChangePassword: false, createdAt: new Date('2026-01-01T00:00:00Z'), ...input } });
}
async function access(id: string) {
  return (await prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx, {
    subjectType: 'EMPLOYEE', subjectId: id, expectedPasswordHash: passwordHash, expectedTokenVersion: 0 }))).accessToken;
}
function input(patch: Partial<EmployeePasswordResetDto> = {}): EmployeePasswordResetDto {
  return { temporaryPassword, expectedVersion: 0, reason: ' 员工忘记密码 ', ...patch };
}
async function reset(id: string, body: unknown = input(), credential: string | null = token) {
  return fetch(`${baseUrl}/api/v1/admin/employees/${id}/reset-password`, { method: 'POST', headers: {
    'Content-Type': 'application/json', ...(credential ? { Authorization: `Bearer ${credential}` } : {}), 'X-Request-Id': 'private-input' }, body: JSON.stringify(body) });
}
async function me(credential: string) { return fetch(`${baseUrl}/api/v1/admin/me`, { headers: { Authorization: `Bearer ${credential}` } }); }
async function login(username: string, password: string) {
  return fetch(`${baseUrl}/api/v1/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
}
async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status); const body = await response.json() as { code: string; requestId: string; details?: unknown };
  expect(body.code).toBe(code); expect(body.requestId).toBe(response.headers.get('x-request-id'));
  for (const secret of [oldPassword, temporaryPassword, newPassword, passwordHash, token, 'private-input']) expect(JSON.stringify(body)).not.toContain(secret); return body;
}
async function success(response: Response, id: string, version: number) {
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json() as { data: { id: string; version: number; mustChangePassword: boolean }; requestId: string };
  expect(Object.keys(body).sort()).toEqual(['data', 'requestId']); expect(body.requestId).toBe(response.headers.get('x-request-id'));
  expect(body.data).toEqual({ id, version, mustChangePassword: true });
  for (const secret of [oldPassword, temporaryPassword, newPassword, passwordHash, token]) expect(JSON.stringify(body)).not.toContain(secret); return body;
}
async function facts(id: string) {
  return { employee: await prisma.employee.findUniqueOrThrow({ where: { id } }),
    sessions: await prisma.authSession.findMany({ where: { employeeId: id }, orderBy: { id: 'asc' } }),
    extras: await prisma.employeeExtraPermission.findMany({ where: { employeeId: id }, orderBy: { permissionCode: 'asc' } }),
    audits: await prisma.auditLog.findMany({ where: { targetId: id }, orderBy: { id: 'asc' } }) };
}
function barrier() {
  let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
  let signal!: () => void; const ready = new Promise<void>(resolve => { signal = resolve; }); return { hold, release, ready, signal };
}
async function waitForBlocker(pid: number) {
  // 请求先在事务外执行两次真实bcrypt；只延长观察窗口，不放宽数据库750ms语句预算。
  const deadline = performance.now() + 1500;
  while (performance.now() < deadline) {
    const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(pid))) AS waiting`;
    if (row?.waiting) return; await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('未观察到重置事务的实际锁等待');
}

it.each(['SUPER_ADMIN', 'MERCH_WAREHOUSE', 'CUSTOMER_SERVICE'] as const)('重置%s的密码/version/全部会话及审计原子变化，岗位授权不变', async role => {
  const target = await employee({ role, version: 4, permissionVersion: 7 }); const first = await access(target.id); const second = await access(target.id); const revoked = await access(target.id);
  const claims = await tokens.verify(revoked, 'EMPLOYEE'); await prisma.$transaction(tx => sessions.revokeCurrent(tx, { subjectType: 'EMPLOYEE', subjectId: target.id }, claims.sid));
  if (role === 'CUSTOMER_SERVICE') await prisma.employeeExtraPermission.create({ data: { employeeId: target.id, permissionCode: 'order.fulfillment.read', grantedById: actorId } });
  const before = await facts(target.id); const actorBefore = await facts(actorId);
  const response = await success(await reset(target.id.toUpperCase(), input({ expectedVersion: 4 })), target.id, 5); const after = await facts(target.id);
  expect(after.employee).toEqual({ ...before.employee, passwordHash: after.employee.passwordHash, mustChangePassword: true, version: 5, tokenVersion: 1, updatedAt: after.employee.updatedAt });
  expect(after.employee.passwordHash).toMatch(/^\$2[aby]\$12\$/); expect(after.employee.passwordHash).not.toBe(passwordHash);
  expect(await new PasswordService().verify(temporaryPassword, after.employee.passwordHash)).toBe(true);
  expect(await new PasswordService().verify(temporaryPassword.trim(), after.employee.passwordHash)).toBe(false);
  expect(await new PasswordService().verify(oldPassword, after.employee.passwordHash)).toBe(false);
  expect(after.extras).toEqual(before.extras); expect(await facts(actorId)).toEqual(actorBefore); expect(eligibilitySpy).not.toHaveBeenCalled();
  expect(after.sessions.filter(s => s.id !== claims.sid).every(s => s.revokedAt !== null && s.revokeReason === 'PASSWORD_RESET')).toBe(true);
  expect(after.sessions.find(s => s.id === claims.sid)).toEqual(before.sessions.find(s => s.id === claims.sid));
  expect(after.audits).toHaveLength(1); expect(after.audits[0]).toMatchObject({ action: 'employee.password.reset', actorType: 'EMPLOYEE', actorEmployeeId: actorId,
    reason: '员工忘记密码', requestId: response.requestId, beforeData: { mustChangePassword: false }, afterData: { passwordChanged: true, mustChangePassword: true } });
  for (const secret of [oldPassword, temporaryPassword, after.employee.passwordHash, first, second]) expect(JSON.stringify(after.audits)).not.toContain(secret);
  await error(await me(first), 401, 'SESSION_REVOKED'); await error(await me(second), 401, 'SESSION_REVOKED'); expect((await me(token)).status).toBe(200);
});

it('真实登录链：旧密码失效，临时密码强制改密，改密后重新登录恢复业务', async () => {
  const target = await employee(); await success(await reset(target.id), target.id, 1);
  await error(await login(target.username, oldPassword), 401, 'INVALID_CREDENTIALS'); const response = await login(target.username, temporaryPassword); expect(response.status).toBe(200);
  const issued = (await response.json() as { data: { accessToken: string; mustChangePassword: boolean } }).data;
  expect(issued.mustChangePassword).toBe(true); expect((await me(issued.accessToken)).status).toBe(200);
  await error(await fetch(`${baseUrl}/api/v1/admin/me/permissions`, { headers: { Authorization: `Bearer ${issued.accessToken}` } }), 403, 'PASSWORD_CHANGE_REQUIRED');
  const changed = await fetch(`${baseUrl}/api/v1/admin/auth/change-password`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${issued.accessToken}` },
    body: JSON.stringify({ oldPassword: temporaryPassword, newPassword }) }); expect(changed.status).toBe(200);
  await error(await me(issued.accessToken), 401, 'SESSION_REVOKED'); await error(await login(target.username, temporaryPassword), 401, 'INVALID_CREDENTIALS');
  const fresh = await login(target.username, newPassword); expect(fresh.status).toBe(200); const final = (await fresh.json() as { data: { accessToken: string; mustChangePassword: boolean } }).data;
  expect(final.mustChangePassword).toBe(false); expect((await fetch(`${baseUrl}/api/v1/admin/me/permissions`, { headers: { Authorization: `Bearer ${final.accessToken}` } })).status).toBe(200);
  expect((await facts(target.id)).employee).toMatchObject({ version: 2, tokenVersion: 2, mustChangePassword: false });
});

it.each([true, false])('可重置停用或已强制改密员工（停用=%s），不改变原状态/授权', async disabled => {
  const target = await employee({ status: disabled ? 'DISABLED' : 'ACTIVE', mustChangePassword: true });
  await success(await reset(target.id), target.id, 1); const after = await facts(target.id);
  expect(after.employee).toMatchObject({ status: target.status, mustChangePassword: true, permissionVersion: 0 });
  expect(after.audits[0]?.beforeData).toEqual({ mustChangePassword: true }); expect(eligibilitySpy).not.toHaveBeenCalled();
  const response = await login(target.username, temporaryPassword);
  if (disabled) await error(response, 401, 'ACCOUNT_UNAVAILABLE'); else expect(response.status).toBe(200);
});

it('本人（含大写UUID）返回专用400，版本或相同密码不覆盖此规则，原会话保留', async () => {
  const before = await facts(actorId);
  await error(await reset(actorId.toUpperCase(), input({ expectedVersion: 99, temporaryPassword: oldPassword })), 400, 'SELF_PASSWORD_RESET_NOT_ALLOWED');
  expect(await facts(actorId)).toEqual(before); expect((await me(token)).status).toBe(200);
});

it('临时密码等于当前密码400无写入，版本冲突优先409，不把重置当无变化成功', async () => {
  const target = await employee(); await access(target.id); const before = await facts(target.id);
  await error(await reset(target.id, input({ temporaryPassword: oldPassword })), 400, 'VALIDATION_FAILED'); expect(await facts(target.id)).toEqual(before);
  await error(await reset(target.id, input({ temporaryPassword: oldPassword, expectedVersion: 1 })), 409, 'VERSION_CONFLICT'); expect(await facts(target.id)).toEqual(before);
});

const invalidCases: [string, Record<string, unknown>][] = [
  ['短密码', { temporaryPassword: 'a'.repeat(7) }], ['超长密码', { temporaryPassword: 'a'.repeat(65) }],
  ['超72字节', { temporaryPassword: '密'.repeat(25) }], ['非法Unicode', { temporaryPassword: '\ud800'.repeat(8) }], ['密码类型', { temporaryPassword: 123 }],
  ['版本字符串', { expectedVersion: '0' }], ['版本布尔', { expectedVersion: true }], ['版本null', { expectedVersion: null }],
  ['负版本', { expectedVersion: -1 }], ['小数版本', { expectedVersion: 0.1 }], ['超安全版本', { expectedVersion: Number.MAX_SAFE_INTEGER + 1 }],
  ['空原因', { reason: ' ' }], ['超长原因', { reason: '原'.repeat(501) }], ['原因类型', { reason: [] }],
  ['注入岗位', { role: 'SUPER_ADMIN' }], ['注入状态', { status: 'ACTIVE' }], ['注入账号', { username: 'private-input' }],
  ['注入关闭改密', { mustChangePassword: false }], ['注入哈希', { passwordHash: 'private-input' }],
  ['注入授权', { extraPermissions: ['employee.create'] }], ['注入令牌版本', { tokenVersion: 9 }], ['注入普通密码', { password: 'private-input' }],
];
it.each(invalidCases)('%s返回400且未进入服务/bcrypt，原事实保持', async (_name, patch) => {
  const target = await employee(); const before = await facts(target.id);
  await error(await reset(target.id, { ...input(), ...patch }), 400, 'VALIDATION_FAILED');
  expect(resetSpy).not.toHaveBeenCalled(); expect(passwords.hashes).toBe(0); expect(passwords.checks).toBe(0); expect(await facts(target.id)).toEqual(before);
});
it.each(['temporaryPassword', 'expectedVersion', 'reason'] as const)('缺少%s返回400且未进入服务', async field => {
  const target = await employee(); const body: Partial<EmployeePasswordResetDto> = input(); delete body[field];
  await error(await reset(target.id, body), 400, 'VALIDATION_FAILED'); expect(resetSpy).not.toHaveBeenCalled(); expect(passwords.hashes).toBe(0);
});
it.each(['        ', 'a'.repeat(64), '密'.repeat(24), '😀'.repeat(18)])('合法密码边界 %# 与500字原因接受，原文真实bcrypt生效', async value => {
  const target = await employee(); await success(await reset(target.id, input({ temporaryPassword: value, reason: '原'.repeat(500) })), target.id, 1);
  const after = await facts(target.id); expect(await new PasswordService().verify(value, after.employee.passwordHash)).toBe(true);
});
it('非法UUID400且不进服务，有权未知目标404，最大安全整数旧版本409', async () => {
  await error(await reset('not-a-uuid'), 400, 'VALIDATION_FAILED'); expect(resetSpy).not.toHaveBeenCalled(); expect(passwords.hashes).toBe(0);
  await error(await reset(randomUUID()), 404, 'EMPLOYEE_NOT_FOUND'); const target = await employee(); const before = await facts(target.id);
  await error(await reset(target.id, input({ expectedVersion: Number.MAX_SAFE_INTEGER })), 409, 'VERSION_CONFLICT'); expect(await facts(target.id)).toEqual(before);
});

it.each(['MERCH_WAREHOUSE', 'CUSTOMER_SERVICE'] as const)('%s对存在/不存在/非法目标统一403，未执行服务或bcrypt', async role => {
  const actor = await employee({ role }); const credential = await access(actor.id); const target = await employee();
  for (const id of [target.id, randomUUID(), 'not-a-uuid']) expect((await error(await reset(id, { ...input(), role: 'SUPER_ADMIN' }, credential), 403, 'FORBIDDEN')).details).toBeUndefined();
  expect(resetSpy).not.toHaveBeenCalled(); expect(passwords.hashes).toBe(0); expect(passwords.checks).toBe(0);
});
it('缺凭证、顾客域、强制改密、停用、撤销及到期在bcrypt前拒绝', async () => {
  const target = await employee(); await error(await reset(target.id, input(), null), 401, 'TOKEN_INVALID');
  const id = randomUUID(); customerIds.add(id); await prisma.customer.create({ data: { id, phone: `139${randomInt(100_000_000).toString().padStart(8, '0')}`,
    nickname: '重置域夹具', passwordHash, createdAt: new Date('2026-01-01T00:00:00Z') } });
  const customer = await prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx, { subjectType: 'CUSTOMER', subjectId: id, expectedPasswordHash: passwordHash, expectedTokenVersion: 0 }));
  await error(await reset(target.id, input(), customer.accessToken), 401, 'TOKEN_SUBJECT_MISMATCH');
  await prisma.employee.update({ where: { id: actorId }, data: { mustChangePassword: true } }); await error(await reset(target.id), 403, 'PASSWORD_CHANGE_REQUIRED');
  await prisma.employee.update({ where: { id: actorId }, data: { mustChangePassword: false, status: 'DISABLED' } }); await error(await reset(target.id), 401, 'ACCOUNT_UNAVAILABLE');
  await prisma.employee.update({ where: { id: actorId }, data: { status: 'ACTIVE' } }); const claims = await tokens.verify(token, 'EMPLOYEE');
  await prisma.$transaction(tx => sessions.revokeCurrent(tx, { subjectType: 'EMPLOYEE', subjectId: actorId }, claims.sid)); await error(await reset(target.id), 401, 'SESSION_REVOKED');
  millis += 7_200_000; await error(await reset(target.id), 401, 'TOKEN_EXPIRED'); expect(resetSpy).not.toHaveBeenCalled(); expect(passwords.hashes).toBe(0); expect(passwords.checks).toBe(0);
});

it.each(['降岗', '强制改密', '停用', '注销', '令牌版本', '到期', '降岗且目标不存在'] as const)('bcrypt完成后%s，锁内重验优先于目标和版本错误', async operation => {
  const target = await employee(); const before = await facts(target.id); const claims = await tokens.verify(token, 'EMPLOYEE');
  passwords.afterHash = async () => {
    await peer.$transaction(async tx => {
      await tx.$queryRaw`SELECT key FROM system_guard WHERE key='ADMIN_AVAILABILITY' FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM employee WHERE id=${actorId}::uuid FOR UPDATE`;
      if (operation.startsWith('降岗')) await tx.employee.update({ where: { id: actorId }, data: { role: 'CUSTOMER_SERVICE', permissionVersion: { increment: 1 }, version: { increment: 1 } } });
      if (operation === '强制改密') await tx.employee.update({ where: { id: actorId }, data: { mustChangePassword: true } });
      if (operation === '停用') await tx.employee.update({ where: { id: actorId }, data: { status: 'DISABLED' } });
      if (operation === '注销') await sessions.revokeCurrent(tx, { subjectType: 'EMPLOYEE', subjectId: actorId }, claims.sid);
      if (operation === '令牌版本') await tx.employee.update({ where: { id: actorId }, data: { tokenVersion: { increment: 1 } } });
    }); if (operation === '到期') millis += 7_200_000;
  };
  const code = { 降岗: 'FORBIDDEN', 强制改密: 'PASSWORD_CHANGE_REQUIRED', 停用: 'ACCOUNT_UNAVAILABLE', 注销: 'SESSION_REVOKED', 令牌版本: 'TOKEN_INVALID', 到期: 'TOKEN_EXPIRED', 降岗且目标不存在: 'FORBIDDEN' }[operation];
  await error(await reset(operation === '降岗且目标不存在' ? randomUUID() : target.id, input({ expectedVersion: 99 })), operation.startsWith('降岗') || operation === '强制改密' ? 403 : 401, code);
  expect(resetSpy).toHaveBeenCalledTimes(1); expect(passwords.hashes).toBe(1); expect(await facts(target.id)).toEqual(before);
});

it('审计真实写入后故障回滚密码/版本/标志/全部会话，旧密码和会话仍可用，解除后可重试', async () => {
  const target = await employee(); const first = await access(target.id); await access(target.id); const before = await facts(target.id); audit.fail = true;
  await error(await reset(target.id), 500, 'INTERNAL_ERROR'); expect(audit.observedWrites).toBe(true); expect(await facts(target.id)).toEqual(before);
  expect((await me(first)).status).toBe(200); await error(await login(target.username, temporaryPassword), 401, 'INVALID_CREDENTIALS');
  expect((await login(target.username, oldPassword)).status).toBe(200); audit.fail = false;
  await success(await reset(target.id), target.id, 1); expect((await facts(target.id)).audits).toHaveLength(1); await error(await me(first), 401, 'SESSION_REVOKED');
});
it('事务外bcrypt故障不改任何员工/会话/审计事实', async () => {
  const target = await employee(); const before = await facts(target.id); passwords.failHash = true;
  await error(await reset(target.id), 500, 'INTERNAL_ERROR'); expect(await facts(target.id)).toEqual(before); expect(audit.observedWrites).toBe(false);
});

it('两个管理员同版本重置同一目标，实际等待后仅一次成功及一条审计', async () => {
  const target = await employee(); const other = await employee({ role: 'SUPER_ADMIN' }); const credential = await access(other.id); const gate = barrier(); let pid = 0;
  audit.afterWrite = async tx => { pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold; };
  const first = reset(target.id); let second: Promise<Response> | undefined;
  try {
    await Promise.race([gate.ready, first.then(() => { throw new Error('重置未进入审计屏障'); })]);
    second = reset(target.id, input({ temporaryPassword: 'OtherReset#2026' }), credential); await waitForBlocker(pid); gate.release();
    await success(await first, target.id, 1); await error(await second, 409, 'VERSION_CONFLICT');
    const after = await facts(target.id); expect(after.employee).toMatchObject({ version: 1, tokenVersion: 1 }); expect(after.audits).toHaveLength(1);
    expect(await new PasswordService().verify(temporaryPassword, after.employee.passwordHash)).toBe(true);
  } finally { gate.release(); await Promise.allSettled([first, ...(second ? [second] : [])]); }
});

it.each([true, false])('操作者ID在前=%s，等待较小ID时未占较大ID，员工锁按升序', async actorFirst => {
  const low = `1${randomUUID().slice(1)}`; const high = `f${randomUUID().slice(1)}`;
  const actor = await employee({ id: actorFirst ? low : high, role: 'SUPER_ADMIN' }); const credential = await access(actor.id);
  const target = await employee({ id: actorFirst ? high : low }); const gate = barrier(); let pid = 0;
  const blocker = peer.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM employee WHERE id=${low}::uuid FOR UPDATE`;
    pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold;
    await tx.$queryRaw`SELECT id FROM employee WHERE id=${high}::uuid FOR UPDATE NOWAIT`;
  }); let pending: Promise<Response> | undefined;
  try {
    await Promise.race([gate.ready, blocker.then(() => { throw new Error('未取得较小员工锁'); })]);
    pending = reset(target.id, input(), credential); await waitForBlocker(pid); gate.release(); await blocker; await success(await pending, target.id, 1);
  } finally { gate.release(); await Promise.allSettled([blocker, ...(pending ? [pending] : [])]); }
});

it('两个管理员交叉重置，先提交者撤销对方会话，后请求锁内401，原操作者密码不变', async () => {
  const other = await employee({ role: 'SUPER_ADMIN' }); const credential = await access(other.id); const before = await facts(actorId); const gate = barrier(); let pid = 0;
  audit.afterWrite = async tx => { pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold; };
  const first = reset(other.id); let second: Promise<Response> | undefined;
  try {
    await Promise.race([gate.ready, first.then(() => { throw new Error('交叉重置未进入屏障'); })]);
    second = reset(actorId, input(), credential); await waitForBlocker(pid); gate.release();
    await success(await first, other.id, 1); await error(await second, 401, 'SESSION_REVOKED'); expect(await facts(actorId)).toEqual(before);
  } finally { gate.release(); await Promise.allSettled([first, ...(second ? [second] : [])]); }
});

it('bcrypt后目标版本先改变则409，保留先提交事实且不覆盖密码', async () => {
  const target = await employee(); passwords.afterHash = async () => { await peer.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM employee WHERE id=${target.id}::uuid FOR UPDATE`;
    await tx.employee.update({ where: { id: target.id }, data: { displayName: '先提交修改', version: { increment: 1 } } });
  }); };
  await error(await reset(target.id), 409, 'VERSION_CONFLICT'); const after = await facts(target.id);
  expect(after.employee).toMatchObject({ displayName: '先提交修改', version: 1, tokenVersion: 0, passwordHash }); expect(after.audits).toHaveLength(0);
});

it('即使直接夹具改哈希而未改version，也拒绝使用旧密码比较快照', async () => {
  const target = await employee(); const changedHash = await new PasswordService().hash(newPassword);
  passwords.afterHash = async () => { await peer.employee.update({ where: { id: target.id }, data: { passwordHash: changedHash } }); };
  await error(await reset(target.id), 409, 'VERSION_CONFLICT'); expect((await facts(target.id)).employee).toMatchObject({ passwordHash: changedHash, version: 0, tokenVersion: 0 });
});

it('重置先持操作者锁，随后降岗等待；已合法提交重置保留，后续请求403', async () => {
  const target = await employee(); const gate = barrier(); let pid = 0;
  audit.afterWrite = async tx => { pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold; };
  const first = reset(target.id); let downgrade: Promise<unknown> | undefined;
  try {
    await Promise.race([gate.ready, first.then(() => { throw new Error('重置未进入屏障'); })]);
    downgrade = peer.$transaction(async tx => {
      await tx.$queryRaw`SELECT key FROM system_guard WHERE key='ADMIN_AVAILABILITY' FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM employee WHERE id=${actorId}::uuid FOR UPDATE`;
      await tx.employee.update({ where: { id: actorId }, data: { role: 'CUSTOMER_SERVICE', version: { increment: 1 }, permissionVersion: { increment: 1 } } });
    }); await waitForBlocker(pid); gate.release(); await success(await first, target.id, 1); await downgrade;
    await error(await reset(target.id, input({ expectedVersion: 1 })), 403, 'FORBIDDEN'); expect((await facts(target.id)).audits).toHaveLength(1);
  } finally { gate.release(); await Promise.allSettled([first, ...(downgrade ? [downgrade] : [])]); }
});

it('降岗先持操作者锁，重置实际等待后按新权限403，无密码写入', async () => {
  const target = await employee(); const before = await facts(target.id); const gate = barrier(); let pid = 0;
  const blocker = peer.$transaction(async tx => {
    await tx.$queryRaw`SELECT key FROM system_guard WHERE key='ADMIN_AVAILABILITY' FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM employee WHERE id=${actorId}::uuid FOR UPDATE`;
    await tx.employee.update({ where: { id: actorId }, data: { role: 'CUSTOMER_SERVICE', version: { increment: 1 }, permissionVersion: { increment: 1 } } });
    pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold;
  }); let pending: Promise<Response> | undefined;
  try {
    await Promise.race([gate.ready, blocker.then(() => { throw new Error('降岗未进入锁屏障'); })]);
    pending = reset(target.id); await waitForBlocker(pid); gate.release(); await blocker; await error(await pending, 403, 'FORBIDDEN'); expect(await facts(target.id)).toEqual(before);
  } finally { gate.release(); await Promise.allSettled([blocker, ...(pending ? [pending] : [])]); }
});

it('旧密码真实验证通过后完成重置，登录锁内拒绝旧快照，不创建旧版本会话', async () => {
  const target = await employee(); let observed = false;
  passwords.afterVerify = async (value, correct) => {
    if (value !== oldPassword || !correct) return; passwords.afterVerify = undefined; observed = true;
    await success(await reset(target.id), target.id, 1);
  };
  const beforeSessions = await prisma.authSession.count({ where: { employeeId: target.id } });
  await error(await login(target.username, oldPassword), 401, 'INVALID_CREDENTIALS'); expect(observed).toBe(true);
  expect(await prisma.authSession.count({ where: { employeeId: target.id } })).toBe(beforeSessions);
  expect((await login(target.username, temporaryPassword)).status).toBe(200);
});

it('重置未提交时旧密码登录校验通过并实际等待，提交后仍拒绝旧快照', async () => {
  const target = await employee(); const gate = barrier(); let pid = 0;
  audit.afterWrite = async tx => { pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold; };
  const first = reset(target.id); let pending: Promise<Response> | undefined;
  try {
    await Promise.race([gate.ready, first.then(() => { throw new Error('重置未进入登录竞态屏障'); })]);
    pending = login(target.username, oldPassword); await waitForBlocker(pid); gate.release(); await success(await first, target.id, 1);
    await error(await pending, 401, 'INVALID_CREDENTIALS'); expect(await prisma.authSession.count({ where: { employeeId: target.id } })).toBe(0);
  } finally { gate.release(); await Promise.allSettled([first, ...(pending ? [pending] : [])]); }
});

it('编译API真实登录及重置、旧密码失效和临时密码强制改密链路', async () => {
  const target = await employee(); const actor = await prisma.employee.findUniqueOrThrow({ where: { id: actorId } });
  const source = String.raw`
    require('reflect-metadata');
    const { NestFactory } = require('@nestjs/core'); const { AppModule } = require('./dist/app.module.js');
    const { configureApp } = require('./dist/common/configure-app.js');
    (async () => { const app = await NestFactory.create(AppModule, { logger: false });
      try { configureApp(app); await app.listen(0, '127.0.0.1'); const url = await app.getUrl();
        const login = async (username,password) => { const r = await fetch(url+'/api/v1/admin/auth/login', { method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({username,password}) }); return {status:r.status,body:await r.json()}; };
        const actor = await login(process.env.SHOP_TEST_ACTOR,process.env.SHOP_TEST_OLD);
        const old = await login(process.env.SHOP_TEST_USERNAME,process.env.SHOP_TEST_OLD);
        const reset = (id,body) => fetch(url+'/api/v1/admin/employees/'+id+'/reset-password', {method:'POST',headers:{'Content-Type':'application/json',
          Authorization:'Bearer '+actor.body.data.accessToken},body:JSON.stringify(body)});
        const input = {temporaryPassword:process.env.SHOP_TEST_TEMP,expectedVersion:0,reason:'编译后重置验证'};
        const invalid = await reset(process.env.SHOP_TEST_TARGET,{...input,mustChangePassword:false});
        const self = await reset(process.env.SHOP_TEST_ACTOR_ID,input); const selfBody = await self.json();
        const response = await reset(process.env.SHOP_TEST_TARGET,input); const body = await response.json();
        const stale = await reset(process.env.SHOP_TEST_TARGET,input); const conflict = await stale.json();
        const oldMe = await fetch(url+'/api/v1/admin/me',{headers:{Authorization:'Bearer '+old.body.data.accessToken}});
        const oldLogin = await login(process.env.SHOP_TEST_USERNAME,process.env.SHOP_TEST_OLD);
        const temp = await login(process.env.SHOP_TEST_USERNAME,process.env.SHOP_TEST_TEMP);
        const permissions = await fetch(url+'/api/v1/admin/me/permissions',{headers:{Authorization:'Bearer '+temp.body.data.accessToken}});
        const changed = await fetch(url+'/api/v1/admin/auth/change-password',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+temp.body.data.accessToken},
          body:JSON.stringify({oldPassword:process.env.SHOP_TEST_TEMP,newPassword:process.env.SHOP_TEST_NEW})});
        const fresh = await login(process.env.SHOP_TEST_USERNAME,process.env.SHOP_TEST_NEW);
        console.log(JSON.stringify({actor:actor.status,login:old.status,invalid:invalid.status,self:self.status,selfCode:selfBody.code,reset:response.status,
          fields:Object.keys(body.data??{}).sort(),version:body.data?.version,mustChange:body.data?.mustChangePassword,stale:stale.status,code:conflict.code,
          oldMe:oldMe.status,oldLogin:oldLogin.status,temp:temp.status,tempMustChange:temp.body.data?.mustChangePassword,permissions:permissions.status,
          changed:changed.status,fresh:fresh.status,freshMustChange:fresh.body.data?.mustChangePassword}));
      } finally {await app.close();}
    })().catch(()=>{console.error('编译后员工重置验证失败');process.exitCode=1;});`;
  const child = spawnSync(process.execPath, ['-e', source], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true, timeout: 15_000,
    env: { ...process.env, LOG_LEVEL: 'silent', SHOP_TEST_ACTOR: actor.username, SHOP_TEST_ACTOR_ID: actorId, SHOP_TEST_USERNAME: target.username,
      SHOP_TEST_TARGET: target.id, SHOP_TEST_OLD: oldPassword, SHOP_TEST_TEMP: temporaryPassword, SHOP_TEST_NEW: newPassword } });
  expect(child.status).toBe(0); expect(JSON.parse(child.stdout.trim())).toEqual({actor:200,login:200,invalid:400,self:400,selfCode:'SELF_PASSWORD_RESET_NOT_ALLOWED',reset:200,
    fields:['id','mustChangePassword','version'],version:1,mustChange:true,stale:409,code:'VERSION_CONFLICT',oldMe:401,oldLogin:401,temp:200,tempMustChange:true,permissions:403,
    changed:200,fresh:200,freshMustChange:false});
  expect((await facts(target.id)).audits.filter(a=>a.action==='employee.password.reset')).toHaveLength(1);
  for (const secret of [oldPassword, temporaryPassword, newPassword, passwordHash]) expect(child.stdout+child.stderr).not.toContain(secret);
});
