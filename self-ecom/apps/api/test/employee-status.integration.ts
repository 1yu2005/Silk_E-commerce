// 作用：验证员工启停、旧会话失效、最后管理员保护、版本冲突及并发回滚。
import 'reflect-metadata';
import { randomInt, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
import type { INestApplication } from '@nestjs/common';
import type { Prisma, SubjectType } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuditService, type AuditPayload } from '../src/audit/audit.service.js';
import { AuthSessionService } from '../src/auth/auth-session.service.js';
import { CurrentIdentityService, type CurrentIdentity } from '../src/auth/current-identity.service.js';
import { seedInitialAdmin } from '../src/auth/initial-admin-seed.js';
import { EmployeeAuthController } from '../src/auth/employee-auth.controller.js';
import { EmployeeLoginDto } from '../src/auth/employee-login.dto.js';
import { JwtTokenService } from '../src/auth/jwt-token.service.js';
import { PasswordService } from '../src/auth/password.service.js';
import { configureApp } from '../src/common/configure-app.js';
import { APP_CONFIG, loadConfiguration } from '../src/config/environment.js';
import { EmployeeEligibilityService } from '../src/employees/employee-eligibility.service.js';
import { EmployeeCreateController } from '../src/employees/employee-create.controller.js';
import { EmployeeCreateDto } from '../src/employees/employee-create.dto.js';
import { EmployeeStatusController } from '../src/employees/employee-status.controller.js';
import { EmployeeStatusDto } from '../src/employees/employee-status.dto.js';
import { EmployeeStatusService } from '../src/employees/employee-status.service.js';
import { EmployeeIdParamsDto } from '../src/employees/employee-query.dto.js';
import { roleTemplates } from '../src/permissions/permission-catalog.js';
import { seedPermissionCatalog } from '../src/permissions/permission-seed.js';
import { PermissionService } from '../src/permissions/permission.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { assertSafeTestDatabase } from '../scripts/database-env.js';
import { runPrisma } from '../scripts/database.js';

const base = assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('集成测试仅可在test环境执行');
// 最后管理员数量需要独占空库；只删除本轮CREATE成功的随机库，不重置shop_test或未知账号。
const databaseName = `employee_status_${randomUUID().replaceAll('-', '')}_test`;
const targetUrl = new URL(base.testUrl); targetUrl.pathname = `/${databaseName}`;
const safe = assertSafeTestDatabase(base.developmentUrl, targetUrl.toString());
const adminUrl = new URL(base.developmentUrl); adminUrl.pathname = '/postgres';
const admin = new Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 2000 }); let databaseCreated = false;
const config = { ...loadConfiguration({ ...process.env, LOG_LEVEL: 'silent' }), databaseUrl: safe.testUrl };
Reflect.defineMetadata('design:paramtypes', [EmployeeIdParamsDto, EmployeeStatusDto, Object, Object], EmployeeStatusController.prototype, 'disable');
Reflect.defineMetadata('design:paramtypes', [EmployeeIdParamsDto, EmployeeStatusDto, Object, Object], EmployeeStatusController.prototype, 'enable');
Reflect.defineMetadata('design:paramtypes', [EmployeeLoginDto, Object], EmployeeAuthController.prototype, 'login');
Reflect.defineMetadata('design:paramtypes', [EmployeeCreateDto, Object, Object], EmployeeCreateController.prototype, 'create');
const password = 'EmployeeStatus#2026'; let passwordHash = '';
let millis = Date.parse('2026-11-12T01:00:00.500Z'); const clock = () => new Date(millis);
const tokens = new JwtTokenService({ secret: 'employee-status-integration-only-'.repeat(3), ttlSeconds: 7200 }, clock);
const sessions = new AuthSessionService(tokens, clock);
class ControlledIdentities extends CurrentIdentityService {
  afterGuard: (() => Promise<void>) | undefined;
  override async authenticate(db: Pick<Prisma.TransactionClient, '$queryRaw'>, credential: string, domain: SubjectType): Promise<CurrentIdentity> {
    const identity = await super.authenticate(db, credential, domain);
    if (typeof (db as { $connect?: unknown }).$connect === 'function') await this.afterGuard?.();
    return identity;
  }
}
class ControlledAudit extends AuditService {
  fail = false; observedWrites = false; tx: Prisma.TransactionClient | undefined;
  afterWrite: ((tx: Prisma.TransactionClient, payload: AuditPayload) => Promise<void>) | undefined;
  override async appendAudit(tx: Prisma.TransactionClient, payload: AuditPayload) {
    await super.appendAudit(tx, payload);
    if (!['employee.disable', 'employee.enable'].includes(payload.action)) return;
    this.tx = tx;
    const target = await tx.employee.findUniqueOrThrow({ where: { id: payload.targetId } });
    this.observedWrites = target.status === payload.after?.status && target.version > 0
      && await tx.auditLog.count({ where: { requestId: payload.requestId } }) === 1;
    await this.afterWrite?.(tx, payload); if (this.fail) throw new Error('测试专用启停审计故障');
  }
}
interface EligibilityCall { id: string; oldEffective: string[]; newEffective: string[]; reason: string;
  sameTransaction: boolean; insideStatus: string; outsideStatus: string; insideAudits: number; activeSessions: number }
class ControlledEligibility extends EmployeeEligibilityService {
  fail = false; calls: EligibilityCall[] = [];
  override async onEmployeeEligibilityChanged(tx: Prisma.TransactionClient, id: string,
    oldEffective: readonly string[], newEffective: readonly string[], reason: string) {
    await super.onEmployeeEligibilityChanged(tx, id, oldEffective, newEffective, reason);
    this.calls.push({ id, oldEffective: [...oldEffective], newEffective: [...newEffective], reason, sameTransaction: tx === audit.tx,
      insideStatus: (await tx.employee.findUniqueOrThrow({ where: { id } })).status,
      outsideStatus: (await peer.employee.findUniqueOrThrow({ where: { id } })).status,
      insideAudits: await tx.auditLog.count({ where: { targetId: id, action: { in: ['employee.disable', 'employee.enable'] } } }),
      activeSessions: await tx.authSession.count({ where: { employeeId: id, revokedAt: null } }) });
    if (this.fail) throw new Error('测试专用资格入口故障');
  }
}
const identities = new ControlledIdentities(tokens, new PermissionService(), clock);
const audit = new ControlledAudit(); const eligibility = new ControlledEligibility();
let app: INestApplication; let prisma: PrismaService; let peer: PrismaService; let baseUrl = '';
let actorId = ''; let token = ''; let changeSpy: MockInstance<EmployeeStatusService['change']>;
type Action = 'disable' | 'enable';
beforeAll(async () => {
  await admin.connect(); await admin.query(`CREATE DATABASE "${databaseName}" ENCODING 'UTF8' TEMPLATE template0`); databaseCreated = true;
  runPrisma(['migrate', 'deploy'], { ...process.env, DATABASE_URL: safe.testUrl });
  passwordHash = await new PasswordService().hash(password);
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(APP_CONFIG).useValue(config)
    .overrideProvider(JwtTokenService).useValue(tokens).overrideProvider(AuthSessionService).useValue(sessions)
    .overrideProvider(CurrentIdentityService).useValue(identities).overrideProvider(AuditService).useValue(audit)
    .overrideProvider(EmployeeEligibilityService).useValue(eligibility).compile();
  app = module.createNestApplication(); configureApp(app); await app.listen(0, '127.0.0.1');
  prisma = app.get(PrismaService); baseUrl = await app.getUrl(); peer = new PrismaService(config); await peer.onModuleInit();
  await seedPermissionCatalog(prisma); changeSpy = vi.spyOn(app.get(EmployeeStatusService), 'change');
}, 30_000);
beforeEach(async () => {
  millis += 360_000; identities.afterGuard = undefined; audit.fail = false; audit.observedWrites = false; audit.tx = undefined; audit.afterWrite = undefined;
  eligibility.fail = false; eligibility.calls = []; changeSpy.mockClear(); const actor = await employee({ role: 'SUPER_ADMIN' }); actorId = actor.id; token = await access(actor.id);
});
afterEach(async () => {
  if (!prisma) return;
  identities.afterGuard = undefined; audit.fail = false; audit.afterWrite = undefined; eligibility.fail = false;
  // 全表清理只针对本文件新建且独占的随机库，原shop_test完全不参与本文件夹具。
  await prisma.auditLog.deleteMany(); await prisma.employeeExtraPermission.deleteMany(); await prisma.authSession.deleteMany();
  await prisma.employee.deleteMany(); await prisma.customer.deleteMany();
});
afterAll(async () => {
  changeSpy?.mockRestore(); await app?.close(); await peer?.$disconnect();
  try {
    if (databaseCreated) {
      const checked = assertSafeTestDatabase(base.developmentUrl, safe.testUrl);
      if (!/^employee_status_[a-f0-9]{32}_test$/.test(databaseName) || checked.testName !== databaseName) throw new Error('临时启停库清理目标不合法');
      await admin.query(`DROP DATABASE "${databaseName}"`);
    }
  } finally { await admin.end(); }
});
async function employee(input: Partial<Prisma.EmployeeUncheckedCreateInput> = {}) {
  return prisma.employee.create({ data: { username: `es_${randomUUID().replaceAll('-', '').slice(0, 20)}`, displayName: '员工启停夹具',
    role: 'CUSTOMER_SERVICE', mustChangePassword: false, passwordHash, createdAt: new Date('2026-01-01T00:00:00Z'), ...input } });
}
async function access(id: string) {
  return (await prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx, {
    subjectType: 'EMPLOYEE', subjectId: id, expectedPasswordHash: passwordHash, expectedTokenVersion: 0,
  }))).accessToken;
}
function input(expectedVersion = 0) { return { expectedVersion, reason: ' 员工启停测试 ' }; }
async function change(action: Action, id: string, body: unknown = input(), credential: string | null = token) {
  return fetch(`${baseUrl}/api/v1/admin/employees/${id}/${action}`, { method: 'POST', headers: {
    'Content-Type': 'application/json', ...(credential ? { Authorization: `Bearer ${credential}` } : {}), 'X-Request-Id': 'private-input' }, body: JSON.stringify(body) });
}
async function me(credential: string) { return fetch(`${baseUrl}/api/v1/admin/me`, { headers: { Authorization: `Bearer ${credential}` } }); }
async function login(username: string) {
  return fetch(`${baseUrl}/api/v1/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
}
async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status); const body = await response.json() as { code: string; requestId: string; details?: unknown };
  expect(body.code).toBe(code); expect(body.requestId).toBe(response.headers.get('x-request-id'));
  for (const secret of [password, passwordHash, token, 'private-input']) expect(JSON.stringify(body)).not.toContain(secret); return body;
}
async function success(response: Response, status: 'ACTIVE' | 'DISABLED', version: number, changed = true) {
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json() as { data: { id: string; status: string; version: number; changed: boolean }; requestId: string };
  expect(Object.keys(body).sort()).toEqual(['data', 'requestId']); expect(body.requestId).toBe(response.headers.get('x-request-id'));
  expect(Object.keys(body.data).sort()).toEqual(['changed', 'id', 'status', 'version']); expect(body.data).toMatchObject({ status, version, changed });
  for (const secret of [password, passwordHash, token]) expect(JSON.stringify(body)).not.toContain(secret); return body;
}
async function facts(id: string) {
  return { employee: await prisma.employee.findUniqueOrThrow({ where: { id } }),
    sessions: await prisma.authSession.findMany({ where: { employeeId: id }, orderBy: { id: 'asc' } }),
    extras: await prisma.employeeExtraPermission.findMany({ where: { employeeId: id }, orderBy: { permissionCode: 'asc' } }),
    audits: await prisma.auditLog.findMany({ where: { targetId: id }, orderBy: { createdAt: 'asc' } }) };
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
  throw new Error('未观察到启停并发事务的实际锁等待');
}

it.each(['SUPER_ADMIN', 'MERCH_WAREHOUSE', 'CUSTOMER_SERVICE'] as const)('%s停用撤销全部会话、启用保留撤销事实，原权限和密码不变', async role => {
  const target = await employee({ role, version: 3, permissionVersion: 7 });
  const first = await access(target.id); const second = await access(target.id); const revoked = await access(target.id);
  const claims = await tokens.verify(revoked, 'EMPLOYEE'); await prisma.$transaction(tx => sessions.revokeCurrent(tx, { subjectType: 'EMPLOYEE', subjectId: target.id }, claims.sid));
  if (role === 'CUSTOMER_SERVICE') await prisma.employeeExtraPermission.create({ data: { employeeId: target.id, permissionCode: 'order.fulfillment.read', grantedById: actorId } });
  const before = await facts(target.id); const actorBefore = await facts(actorId);
  const result = await success(await change('disable', target.id.toUpperCase(), input(3)), 'DISABLED', 4);
  const disabled = await facts(target.id);
  expect(disabled.employee).toEqual({ ...before.employee, status: 'DISABLED', version: 4, tokenVersion: 1, updatedAt: disabled.employee.updatedAt });
  expect(disabled.extras).toEqual(before.extras); expect(await facts(actorId)).toEqual(actorBefore);
  expect(disabled.sessions.every(session => session.revokedAt !== null)).toBe(true);
  expect(disabled.sessions.find(session => session.id === claims.sid)).toEqual(before.sessions.find(session => session.id === claims.sid));
  expect(disabled.sessions.filter(session => session.id !== claims.sid).every(session => session.revokeReason === 'ACCOUNT_DISABLED')).toBe(true);
  expect(disabled.audits).toHaveLength(1); expect(disabled.audits[0]).toMatchObject({ action: 'employee.disable', actorType: 'EMPLOYEE', actorEmployeeId: actorId,
    reason: '员工启停测试', requestId: result.requestId, beforeData: { status: 'ACTIVE' }, afterData: { status: 'DISABLED' } });
  for (const secret of [password, passwordHash, first, second]) expect(JSON.stringify(disabled.audits)).not.toContain(secret);
  expect(eligibility.calls[0]).toMatchObject({ id: target.id, sameTransaction: true, insideStatus: 'DISABLED', outsideStatus: 'ACTIVE', insideAudits: 1, activeSessions: 0, newEffective: [] });
  const effective = [...roleTemplates[role], ...(role === 'CUSTOMER_SERVICE' ? ['order.fulfillment.read'] : [])].sort();
  expect(eligibility.calls[0]?.oldEffective).toEqual(effective);
  await error(await me(first), 401, 'SESSION_REVOKED'); await error(await me(second), 401, 'SESSION_REVOKED');
  await error(await login(target.username), 401, 'ACCOUNT_UNAVAILABLE');
  await error(await change('enable', target.id, input(3)), 409, 'VERSION_CONFLICT');
  await success(await change('enable', target.id, input(4)), 'ACTIVE', 5);
  const enabled = await facts(target.id);
  expect(enabled.employee).toEqual({ ...disabled.employee, status: 'ACTIVE', version: 5, updatedAt: enabled.employee.updatedAt });
  expect(enabled.sessions).toEqual(disabled.sessions); expect(enabled.extras).toEqual(before.extras);
  expect(eligibility.calls[1]).toMatchObject({ sameTransaction: true, insideStatus: 'ACTIVE', outsideStatus: 'DISABLED', oldEffective: [], newEffective: effective });
  await error(await me(first), 401, 'SESSION_REVOKED'); const fresh = await login(target.username); expect(fresh.status).toBe(200);
  const issued = (await fresh.json() as { data: { accessToken: string } }).data; expect((await me(issued.accessToken)).status).toBe(200);
});

it.each(['disable', 'enable'] as const)('%s相同状态匹配版本无写入/重复审计/资格调用，旧版本仍409', async action => {
  const target = await employee({ status: action === 'disable' ? 'DISABLED' : 'ACTIVE', version: 2 }); const before = await facts(target.id);
  audit.fail = true; eligibility.fail = true;
  await success(await change(action, target.id, input(2)), target.status, 2, false);
  await error(await change(action, target.id, input(1)), 409, 'VERSION_CONFLICT'); expect(await facts(target.id)).toEqual(before); expect(eligibility.calls).toHaveLength(0);
});

it('唯一ACTIVE管理员不能停用本人，停用管理员不计数，强制改密的ACTIVE管理员计入保护', async () => {
  await employee({ role: 'SUPER_ADMIN', status: 'DISABLED' }); const before = await facts(actorId);
  await error(await change('disable', actorId), 409, 'LAST_ADMIN_REQUIRED'); expect(await facts(actorId)).toEqual(before); expect(eligibility.calls).toHaveLength(0);
  const other = await employee({ role: 'SUPER_ADMIN', mustChangePassword: true });
  await success(await change('disable', actorId), 'DISABLED', 1);
  expect(await prisma.employee.count({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE' } })).toBe(1);
  expect((await prisma.employee.findUniqueOrThrow({ where: { id: other.id } })).mustChangePassword).toBe(true); await error(await me(token), 401, 'SESSION_REVOKED');
});

it('启用保留强制改密，重新登录后本人可读、业务入口仍403', async () => {
  const target = await employee({ status: 'DISABLED', mustChangePassword: true }); await success(await change('enable', target.id), 'ACTIVE', 1);
  const response = await login(target.username); expect(response.status).toBe(200);
  const issued = (await response.json() as { data: { accessToken: string; mustChangePassword: boolean } }).data;
  expect(issued.mustChangePassword).toBe(true); expect((await me(issued.accessToken)).status).toBe(200);
  await error(await change('disable', actorId, input(), issued.accessToken), 403, 'PASSWORD_CHANGE_REQUIRED');
});

const invalidCases: [string, Record<string, unknown>][] = [
  ['版本字符串', { expectedVersion: '0' }], ['版本布尔值', { expectedVersion: false }], ['版本null', { expectedVersion: null }],
  ['版本负数', { expectedVersion: -1 }], ['版本小数', { expectedVersion: 0.1 }], ['版本超安全整数', { expectedVersion: Number.MAX_SAFE_INTEGER + 1 }],
  ['空原因', { reason: ' ' }], ['原因超长', { reason: '原'.repeat(501) }], ['原因类型', { reason: [] }],
  ['注入状态', { status: 'ACTIVE' }], ['注入岗位', { role: 'SUPER_ADMIN' }], ['注入令牌版本', { tokenVersion: 5 }],
  ['注入改密标志', { mustChangePassword: false }], ['注入授权', { extraPermissions: ['employee.status.manage'] }],
];
it.each(invalidCases)('%s在两个入口均400且未进入状态服务', async (_name, patch) => {
  const target = await employee(); const before = await facts(target.id);
  for (const action of ['disable', 'enable'] as const) await error(await change(action, target.id, { ...input(), ...patch }), 400, 'VALIDATION_FAILED');
  expect(changeSpy).not.toHaveBeenCalled(); expect(await facts(target.id)).toEqual(before);
});
it.each(['expectedVersion', 'reason'] as const)('缺少%s在两个入口均400', async field => {
  const target = await employee(); const body: Partial<ReturnType<typeof input>> = input(); delete body[field];
  for (const action of ['disable', 'enable'] as const) await error(await change(action, target.id, body), 400, 'VALIDATION_FAILED');
  expect(changeSpy).not.toHaveBeenCalled();
});
it('500字原因接受，非法UUID400、有权未知目标404，最大安全整数旧版本409', async () => {
  const target = await employee(); await success(await change('disable', target.id, { expectedVersion: 0, reason: '原'.repeat(500) }), 'DISABLED', 1);
  changeSpy.mockClear();
  for (const action of ['disable', 'enable'] as const) {
    await error(await change(action, 'not-a-uuid'), 400, 'VALIDATION_FAILED'); expect(changeSpy).not.toHaveBeenCalled();
  }
  for (const action of ['disable', 'enable'] as const) {
    await error(await change(action, randomUUID()), 404, 'EMPLOYEE_NOT_FOUND');
    await error(await change(action, target.id, input(Number.MAX_SAFE_INTEGER)), 409, 'VERSION_CONFLICT');
  }
});

it.each(['MERCH_WAREHOUSE', 'CUSTOMER_SERVICE'] as const)('%s两个入口对存在/不存在/非法目标统一403，不泄漏参数或目标', async role => {
  const actor = await employee({ role }); const credential = await access(actor.id); const target = await employee();
  for (const action of ['disable', 'enable'] as const) for (const id of [target.id, randomUUID(), 'not-a-uuid']) {
    expect((await error(await change(action, id, { ...input(), role: 'SUPER_ADMIN' }, credential), 403, 'FORBIDDEN')).details).toBeUndefined();
  }
  expect(changeSpy).not.toHaveBeenCalled();
});

it('两个入口拒绝缺凭证、顾客域、强制改密、停用、撤销、到期', async () => {
  const target = await employee(); const check = async (credential: string | null, status: number, code: string) => {
    for (const action of ['disable', 'enable'] as const) await error(await change(action, target.id, input(), credential), status, code);
  };
  await check(null, 401, 'TOKEN_INVALID'); const customer = await prisma.customer.create({ data: {
    phone: `139${randomInt(100_000_000).toString().padStart(8, '0')}`, nickname: '启停域夹具', passwordHash, createdAt: new Date('2026-01-01T00:00:00Z') } });
  const issued = await prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx, {
    subjectType: 'CUSTOMER', subjectId: customer.id, expectedPasswordHash: passwordHash, expectedTokenVersion: 0 }));
  await check(issued.accessToken, 401, 'TOKEN_SUBJECT_MISMATCH');
  await prisma.employee.update({ where: { id: actorId }, data: { mustChangePassword: true } }); await check(token, 403, 'PASSWORD_CHANGE_REQUIRED');
  await prisma.employee.update({ where: { id: actorId }, data: { mustChangePassword: false, status: 'DISABLED' } }); await check(token, 401, 'ACCOUNT_UNAVAILABLE');
  await prisma.employee.update({ where: { id: actorId }, data: { status: 'ACTIVE' } }); const claims = await tokens.verify(token, 'EMPLOYEE');
  await prisma.$transaction(tx => sessions.revokeCurrent(tx, { subjectType: 'EMPLOYEE', subjectId: actorId }, claims.sid));
  await check(token, 401, 'SESSION_REVOKED'); millis += 7_200_000; await check(token, 401, 'TOKEN_EXPIRED'); expect(changeSpy).not.toHaveBeenCalled();
});

it.each(['disable', 'enable'] as const)('%s的审计与资格入口分别失败，状态/版本/会话/审计完整回滚', async action => {
  const target = await employee(); const originalToken = await access(target.id);
  if (action === 'enable') await prisma.employee.update({ where: { id: target.id }, data: { status: 'DISABLED' } });
  const before = await facts(target.id);
  audit.fail = true; await error(await change(action, target.id), 500, 'INTERNAL_ERROR'); expect(audit.observedWrites).toBe(true);
  expect(await facts(target.id)).toEqual(before); expect(eligibility.calls).toHaveLength(0);
  audit.fail = false; eligibility.fail = true; await error(await change(action, target.id), 500, 'INTERNAL_ERROR');
  expect(eligibility.calls[0]?.sameTransaction).toBe(true); expect(await facts(target.id)).toEqual(before);
  if (action === 'disable') expect((await me(originalToken)).status).toBe(200);
  eligibility.fail = false; await success(await change(action, target.id), action === 'disable' ? 'DISABLED' : 'ACTIVE', 1);
  expect((await facts(target.id)).audits).toHaveLength(1);
});

it.each(['降岗', '强制改密', '停用', '注销', '版本变化', '到期', '降岗且目标不存在'] as const)('入口快照后%s，锁内身份复核先于目标/版本检查', async operation => {
  const target = await employee({ status: 'DISABLED' }); const before = await facts(target.id); const claims = await tokens.verify(token, 'EMPLOYEE');
  identities.afterGuard = async () => {
    await peer.$transaction(async tx => {
      await tx.$queryRaw`SELECT key FROM system_guard WHERE key='ADMIN_AVAILABILITY' FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM employee WHERE id=${actorId}::uuid FOR UPDATE`;
      if (operation.startsWith('降岗')) await tx.employee.update({ where: { id: actorId }, data: { role: 'CUSTOMER_SERVICE', permissionVersion: { increment: 1 }, version: { increment: 1 } } });
      if (operation === '强制改密') await tx.employee.update({ where: { id: actorId }, data: { mustChangePassword: true } });
      if (operation === '停用') await tx.employee.update({ where: { id: actorId }, data: { status: 'DISABLED' } });
      if (operation === '注销') await sessions.revokeCurrent(tx, { subjectType: 'EMPLOYEE', subjectId: actorId }, claims.sid);
      if (operation === '版本变化') await tx.employee.update({ where: { id: actorId }, data: { tokenVersion: { increment: 1 } } });
    }); if (operation === '到期') millis += 7_200_000;
  };
  const code = { 降岗: 'FORBIDDEN', 强制改密: 'PASSWORD_CHANGE_REQUIRED', 停用: 'ACCOUNT_UNAVAILABLE',
    注销: 'SESSION_REVOKED', 版本变化: 'TOKEN_INVALID', 到期: 'TOKEN_EXPIRED', 降岗且目标不存在: 'FORBIDDEN' }[operation];
  await error(await change('enable', operation === '降岗且目标不存在' ? randomUUID() : target.id, input(99)),
    operation.startsWith('降岗') || operation === '强制改密' ? 403 : 401, code);
  expect(changeSpy).toHaveBeenCalledTimes(1); expect(await facts(target.id)).toEqual(before);
});

it.each(['本人', '对方'] as const)('两名管理员并发停用%s，稳定锁后保留一名管理员', async mode => {
  const other = await employee({ role: 'SUPER_ADMIN' }); const credential = await access(other.id); const gate = barrier(); let pid = 0;
  audit.afterWrite = async tx => { pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold; };
  const first = change('disable', mode === '本人' ? actorId : other.id); let second: Promise<Response> | undefined;
  try {
    await Promise.race([gate.ready, first.then(() => { throw new Error('启停未进入审计屏障'); })]);
    second = change('disable', mode === '本人' ? other.id : actorId, input(), credential);
    await waitForBlocker(pid); gate.release(); await success(await first, 'DISABLED', 1);
    await error(await second, mode === '本人' ? 409 : 401, mode === '本人' ? 'LAST_ADMIN_REQUIRED' : 'SESSION_REVOKED');
    expect(await prisma.employee.count({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'employee.disable' } })).toBe(1); expect(eligibility.calls).toHaveLength(1);
  } finally { gate.release(); await Promise.allSettled([first, ...(second ? [second] : [])]); }
});

it.each(['disable', 'enable'] as const)('%s先等待管理员稳定锁，等待期间未占操作者/目标行锁', async action => {
  const target = await employee({ status: action === 'enable' ? 'DISABLED' : 'ACTIVE' }); const gate = barrier(); let pid = 0;
  const blocker = peer.$transaction(async tx => {
    await tx.$queryRaw`SELECT key FROM system_guard WHERE key='ADMIN_AVAILABILITY' FOR UPDATE`;
    pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold;
    await tx.$queryRaw`SELECT id FROM employee WHERE id=${actorId}::uuid FOR UPDATE NOWAIT`;
    await tx.$queryRaw`SELECT id FROM employee WHERE id=${target.id}::uuid FOR UPDATE NOWAIT`;
  }); let pending: Promise<Response> | undefined;
  try {
    await Promise.race([gate.ready, blocker.then(() => { throw new Error('未取得稳定锁'); })]);
    pending = change(action, target.id); await waitForBlocker(pid); gate.release(); await blocker;
    await success(await pending, action === 'enable' ? 'ACTIVE' : 'DISABLED', 1);
  } finally { gate.release(); await Promise.allSettled([blocker, ...(pending ? [pending] : [])]); }
});

it.each([true, false])('操作者ID在前=%s，稳定锁后员工ID升序且未提前锁较大ID', async actorFirst => {
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
    pending = change('disable', target.id, input(), credential); await waitForBlocker(pid); gate.release(); await blocker;
    await success(await pending, 'DISABLED', 1);
  } finally { gate.release(); await Promise.allSettled([blocker, ...(pending ? [pending] : [])]); }
});

it('同一目标同一版本并发停用，后提交409而非重复成功', async () => {
  const target = await employee(); const gate = barrier(); let pid = 0;
  audit.afterWrite = async tx => { pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold; };
  const first = change('disable', target.id); let second: Promise<Response> | undefined;
  try {
    await Promise.race([gate.ready, first.then(() => { throw new Error('未进入状态屏障'); })]);
    second = change('disable', target.id); await waitForBlocker(pid); gate.release(); await success(await first, 'DISABLED', 1);
    await error(await second, 409, 'VERSION_CONFLICT'); const after = await facts(target.id);
    expect(after.employee).toMatchObject({ status: 'DISABLED', version: 1, tokenVersion: 1 }); expect(after.audits).toHaveLength(1); expect(eligibility.calls).toHaveLength(1);
  } finally { gate.release(); await Promise.allSettled([first, ...(second ? [second] : [])]); }
});

it('先启用另一管理员，再并发停用原唯一管理员，两次变更都成功且仍有一名', async () => {
  const other = await employee({ role: 'SUPER_ADMIN', status: 'DISABLED' }); const gate = barrier(); let pid = 0; let count = 0;
  audit.afterWrite = async tx => { if (++count === 1) { pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold; } };
  const first = change('enable', other.id); let second: Promise<Response> | undefined;
  try {
    await Promise.race([gate.ready, first.then(() => { throw new Error('启用未进入屏障'); })]);
    second = change('disable', actorId); await waitForBlocker(pid); gate.release();
    await success(await first, 'ACTIVE', 1); await success(await second, 'DISABLED', 1);
    expect(await prisma.employee.count({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE' } })).toBe(1);
  } finally { gate.release(); await Promise.allSettled([first, ...(second ? [second] : [])]); }
});

it('停用管理员与真实初始化seed共用稳定锁，seed不新增或覆盖账号', async () => {
  const other = await employee({ role: 'SUPER_ADMIN' }); const original = await facts(actorId); const gate = barrier(); let pid = 0;
  audit.afterWrite = async tx => { pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold; };
  const first = change('disable', other.id); let second: ReturnType<typeof seedInitialAdmin> | undefined;
  try {
    await Promise.race([gate.ready, first.then(() => { throw new Error('停用未进入屏障'); })]);
    second = seedInitialAdmin(peer, { username: 'seed_again', password }, { passwords: { hash: async () => passwordHash }, audit: new AuditService() });
    await waitForBlocker(pid); gate.release(); await success(await first, 'DISABLED', 1); expect((await second).created).toBe(false);
    expect(await prisma.employee.count()).toBe(2); expect(await facts(actorId)).toEqual(original);
  } finally { gate.release(); await Promise.allSettled([first, ...(second ? [second] : [])]); }
});

it('停用与真实创建管理员API共用稳定锁，创建等待后仍成功', async () => {
  const other = await employee({ role: 'SUPER_ADMIN' }); const gate = barrier(); let pid = 0;
  audit.afterWrite = async tx => { pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold; };
  const first = change('disable', other.id); let second: Promise<Response> | undefined;
  try {
    await Promise.race([gate.ready, first.then(() => { throw new Error('停用未进入屏障'); })]);
    second = fetch(`${baseUrl}/api/v1/admin/employees`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ username: 'created_admin', displayName: '并发管理员', role: 'SUPER_ADMIN', initialPassword: password, reason: '并发创建' }) });
    await waitForBlocker(pid); gate.release(); await success(await first, 'DISABLED', 1); expect((await second).status).toBe(201);
    expect(await prisma.employee.count({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE' } })).toBe(2);
  } finally { gate.release(); await Promise.allSettled([first, ...(second ? [second] : [])]); }
});

it('锁等待后读取最新目标版本，保留先提交修改并返回409', async () => {
  const target = await employee(); const gate = barrier(); let pid = 0;
  const blocker = peer.$transaction(async tx => {
    await tx.$queryRaw`SELECT key FROM system_guard WHERE key='ADMIN_AVAILABILITY' FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM employee WHERE id=${target.id}::uuid FOR UPDATE`;
    await tx.employee.update({ where: { id: target.id }, data: { displayName: '先提交的修改', version: { increment: 1 } } });
    pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold;
  }); let pending: Promise<Response> | undefined;
  try {
    await Promise.race([gate.ready, blocker.then(() => { throw new Error('版本未进入屏障'); })]);
    pending = change('disable', target.id); await waitForBlocker(pid); gate.release(); await blocker; await error(await pending, 409, 'VERSION_CONFLICT');
    const after = await facts(target.id); expect(after.employee).toMatchObject({ status: 'ACTIVE', version: 1, displayName: '先提交的修改', tokenVersion: 0 }); expect(after.audits).toHaveLength(0);
  } finally { gate.release(); await Promise.allSettled([blocker, ...(pending ? [pending] : [])]); }
});

it('缺少稳定行安全失败且不自动创建，目标和审计不变', async () => {
  const target = await employee(); const before = await facts(target.id);
  await prisma.systemGuard.delete({ where: { key: 'ADMIN_AVAILABILITY' } });
  try {
    await error(await change('disable', target.id), 500, 'INTERNAL_ERROR'); expect(await facts(target.id)).toEqual(before);
    expect(await prisma.systemGuard.count({ where: { key: 'ADMIN_AVAILABILITY' } })).toBe(0);
  } finally { await prisma.systemGuard.create({ data: { key: 'ADMIN_AVAILABILITY' } }); }
});

it('编译API真实登录、停用及重新启用，旧令牌持续401而新登录成功', async () => {
  const target = await employee(); const actor = await prisma.employee.findUniqueOrThrow({ where: { id: actorId } });
  const source = String.raw`
    require('reflect-metadata');
    const { NestFactory } = require('@nestjs/core'); const { AppModule } = require('./dist/app.module.js');
    const { configureApp } = require('./dist/common/configure-app.js');
    (async () => { const app = await NestFactory.create(AppModule, { logger: false });
      try { configureApp(app); await app.listen(0, '127.0.0.1'); const url = await app.getUrl();
        const login = async username => { const r = await fetch(url + '/api/v1/admin/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password: process.env.SHOP_TEST_PASSWORD }) }); return { status: r.status, body: await r.json() }; };
        const actor = await login(process.env.SHOP_TEST_ACTOR); const old = await login(process.env.SHOP_TEST_USERNAME);
        const change = (action, body) => fetch(url + '/api/v1/admin/employees/' + process.env.SHOP_TEST_TARGET + '/' + action, { method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + actor.body.data.accessToken }, body: JSON.stringify(body) });
        const me = () => fetch(url + '/api/v1/admin/me', { headers: { Authorization: 'Bearer ' + old.body.data.accessToken } });
        const input = { expectedVersion: 0, reason: '编译后启停' }; const invalid = await change('disable', { ...input, status: 'DISABLED' });
        const disabled = await change('disable', input); const disabledBody = await disabled.json(); const oldDisabled = await me();
        const stale = await change('enable', input); const conflict = await stale.json();
        const enabled = await change('enable', { ...input, expectedVersion: 1 }); const enabledBody = await enabled.json();
        const oldEnabled = await me(); const fresh = await login(process.env.SHOP_TEST_USERNAME);
        const same = await change('enable', { ...input, expectedVersion: 2 }); const sameBody = await same.json();
        console.log(JSON.stringify({ actor: actor.status, login: old.status, invalid: invalid.status, disabled: disabled.status,
          fields: Object.keys(disabledBody.data ?? {}).sort(), disabledVersion: disabledBody.data?.version, oldDisabled: oldDisabled.status,
          stale: stale.status, code: conflict.code, enabled: enabled.status, enabledVersion: enabledBody.data?.version,
          oldEnabled: oldEnabled.status, fresh: fresh.status, same: same.status, changed: sameBody.data?.changed }));
      } finally { await app.close(); }
    })().catch(() => { console.error('编译后员工启停验证失败'); process.exitCode=1; });`;
  const child = spawnSync(process.execPath, ['-e', source], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true, timeout: 15_000,
    env: { ...process.env, DATABASE_URL: safe.testUrl, LOG_LEVEL: 'silent', SHOP_TEST_ACTOR: actor.username, SHOP_TEST_USERNAME: target.username,
      SHOP_TEST_PASSWORD: password, SHOP_TEST_TARGET: target.id } });
  expect(child.status).toBe(0); expect(JSON.parse(child.stdout.trim())).toEqual({ actor: 200, login: 200, invalid: 400, disabled: 200,
    fields: ['changed', 'id', 'status', 'version'], disabledVersion: 1, oldDisabled: 401, stale: 409, code: 'VERSION_CONFLICT',
    enabled: 200, enabledVersion: 2, oldEnabled: 401, fresh: 200, same: 200, changed: false });
  expect((await facts(target.id)).audits).toHaveLength(2);
  for (const secret of [password, passwordHash]) expect(child.stdout + child.stderr).not.toContain(secret);
});
