// 作用：验证岗位调整、清空额外权限、最后管理员保护及并发事务仲裁。
import 'reflect-metadata';
import { randomInt, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
import type { INestApplication } from '@nestjs/common';
import type { EmployeeRole, Prisma, SubjectType } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuditService, type AuditPayload } from '../src/audit/audit.service.js';
import { AuthSessionService } from '../src/auth/auth-session.service.js';
import { CurrentIdentityService, type CurrentIdentity } from '../src/auth/current-identity.service.js';
import { EmployeeAuthController } from '../src/auth/employee-auth.controller.js';
import { EmployeeLoginDto } from '../src/auth/employee-login.dto.js';
import { seedInitialAdmin } from '../src/auth/initial-admin-seed.js';
import { JwtTokenService } from '../src/auth/jwt-token.service.js';
import { PasswordService } from '../src/auth/password.service.js';
import { configureApp } from '../src/common/configure-app.js';
import { APP_CONFIG, loadConfiguration } from '../src/config/environment.js';
import { EmployeeEligibilityService } from '../src/employees/employee-eligibility.service.js';
import { EmployeeRoleController } from '../src/employees/employee-role.controller.js';
import { EmployeeRoleDto } from '../src/employees/employee-role.dto.js';
import { EmployeeRoleService } from '../src/employees/employee-role.service.js';
import { EmployeeIdParamsDto } from '../src/employees/employee-query.dto.js';
import { EmployeeCreateController } from '../src/employees/employee-create.controller.js';
import { EmployeeCreateDto } from '../src/employees/employee-create.dto.js';
import { EmployeeStatusController } from '../src/employees/employee-status.controller.js';
import { EmployeeStatusDto } from '../src/employees/employee-status.dto.js';
import { roleTemplates } from '../src/permissions/permission-catalog.js';
import { seedPermissionCatalog } from '../src/permissions/permission-seed.js';
import { PermissionService } from '../src/permissions/permission.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { assertSafeTestDatabase } from '../scripts/database-env.js';
import { runPrisma } from '../scripts/database.js';

const base = assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('集成测试仅可在test环境执行');
// 精确验证最后管理员数量；只删除本轮CREATE成功的独占随机库，不使用shop_test已有账号。
const databaseName = `employee_role_${randomUUID().replaceAll('-', '')}_test`;
const targetUrl = new URL(base.testUrl); targetUrl.pathname = `/${databaseName}`;
const safe = assertSafeTestDatabase(base.developmentUrl, targetUrl.toString());
const adminUrl = new URL(base.developmentUrl); adminUrl.pathname = '/postgres';
const admin = new Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 2000 }); let databaseCreated = false;
const config = { ...loadConfiguration({ ...process.env, LOG_LEVEL: 'silent' }), databaseUrl: safe.testUrl };
Reflect.defineMetadata('design:paramtypes', [EmployeeIdParamsDto, EmployeeRoleDto, Object, Object], EmployeeRoleController.prototype, 'change');
Reflect.defineMetadata('design:paramtypes', [EmployeeIdParamsDto, EmployeeStatusDto, Object, Object], EmployeeStatusController.prototype, 'disable');
Reflect.defineMetadata('design:paramtypes', [EmployeeIdParamsDto, EmployeeStatusDto, Object, Object], EmployeeStatusController.prototype, 'enable');
Reflect.defineMetadata('design:paramtypes', [EmployeeCreateDto, Object, Object], EmployeeCreateController.prototype, 'create');
Reflect.defineMetadata('design:paramtypes', [EmployeeLoginDto, Object], EmployeeAuthController.prototype, 'login');
const password = 'EmployeeRole#2026'; let passwordHash = '';
let millis = Date.parse('2026-11-12T01:00:00.500Z'); const clock = () => new Date(millis);
const tokens = new JwtTokenService({ secret: 'employee-role-integration-only-'.repeat(3), ttlSeconds: 7200 }, clock);
const sessions = new AuthSessionService(tokens, clock);
class ControlledIdentities extends CurrentIdentityService {
  afterGuard: (() => Promise<void>) | undefined;
  override async authenticate(db: Pick<Prisma.TransactionClient, '$queryRaw'>, credential: string, domain: SubjectType): Promise<CurrentIdentity> {
    const identity = await super.authenticate(db, credential, domain);
    if (typeof (db as { $connect?: unknown }).$connect === 'function') await this.afterGuard?.(); return identity;
  }
}
class ControlledAudit extends AuditService {
  fail = false; observedWrites = false; tx: Prisma.TransactionClient | undefined;
  afterWrite: ((tx: Prisma.TransactionClient, payload: AuditPayload) => Promise<void>) | undefined;
  override async appendAudit(tx: Prisma.TransactionClient, payload: AuditPayload) {
    await super.appendAudit(tx, payload); await this.afterWrite?.(tx, payload);
    if (payload.action !== 'employee.role.change') return; this.tx = tx;
    const target = await tx.employee.findUniqueOrThrow({ where: { id: payload.targetId } });
    this.observedWrites = target.role === payload.after?.role && target.version > 0 && target.permissionVersion > 0
      && await tx.employeeExtraPermission.count({ where: { employeeId: target.id } }) === 0
      && await tx.auditLog.count({ where: { requestId: payload.requestId } }) === 1;
    if (this.fail) throw new Error('测试专用调岗审计故障');
  }
}
interface EligibilityCall { id: string; oldEffective: string[]; newEffective: string[]; reason: string; sameTransaction: boolean;
  insideRole: string; outsideRole: string; insideExtras: number; outsideExtras: number; insideAudits: number }
class ControlledEligibility extends EmployeeEligibilityService {
  fail = false; calls: EligibilityCall[] = [];
  override async onEmployeeEligibilityChanged(tx: Prisma.TransactionClient, id: string,
    oldEffective: readonly string[], newEffective: readonly string[], reason: string) {
    await super.onEmployeeEligibilityChanged(tx, id, oldEffective, newEffective, reason);
    if (audit.tx === tx) {
      this.calls.push({ id, oldEffective: [...oldEffective], newEffective: [...newEffective], reason, sameTransaction: true,
        insideRole: (await tx.employee.findUniqueOrThrow({ where: { id } })).role,
        outsideRole: (await peer.employee.findUniqueOrThrow({ where: { id } })).role,
        insideExtras: await tx.employeeExtraPermission.count({ where: { employeeId: id } }),
        outsideExtras: await peer.employeeExtraPermission.count({ where: { employeeId: id } }),
        insideAudits: await tx.auditLog.count({ where: { targetId: id, action: 'employee.role.change' } }) });
      if (this.fail) throw new Error('测试专用调岗资格故障');
    }
  }
}
const identities = new ControlledIdentities(tokens, new PermissionService(), clock);
const audit = new ControlledAudit(); const eligibility = new ControlledEligibility();
let app: INestApplication; let prisma: PrismaService; let peer: PrismaService; let baseUrl = ''; let actorId = ''; let token = '';
let changeSpy: MockInstance<EmployeeRoleService['change']>;
beforeAll(async () => {
  await admin.connect(); await admin.query(`CREATE DATABASE "${databaseName}" ENCODING 'UTF8' TEMPLATE template0`); databaseCreated = true;
  runPrisma(['migrate', 'deploy'], { ...process.env, DATABASE_URL: safe.testUrl }); passwordHash = await new PasswordService().hash(password);
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(APP_CONFIG).useValue(config)
    .overrideProvider(JwtTokenService).useValue(tokens).overrideProvider(AuthSessionService).useValue(sessions)
    .overrideProvider(CurrentIdentityService).useValue(identities).overrideProvider(AuditService).useValue(audit)
    .overrideProvider(EmployeeEligibilityService).useValue(eligibility).compile();
  app = module.createNestApplication(); configureApp(app); await app.listen(0, '127.0.0.1');
  prisma = app.get(PrismaService); baseUrl = await app.getUrl(); peer = new PrismaService(config); await peer.onModuleInit();
  await seedPermissionCatalog(prisma); changeSpy = vi.spyOn(app.get(EmployeeRoleService), 'change');
}, 30_000);
beforeEach(async () => {
  millis += 360_000; identities.afterGuard = undefined; audit.fail = false; audit.observedWrites = false; audit.tx = undefined; audit.afterWrite = undefined;
  eligibility.fail = false; eligibility.calls = []; changeSpy.mockClear(); const actor = await employee({ role: 'SUPER_ADMIN' }); actorId = actor.id; token = await access(actor.id);
});
afterEach(async () => {
  if (!prisma) return; identities.afterGuard = undefined; audit.fail = false; audit.afterWrite = undefined; eligibility.fail = false;
  // 全表清理仅针对本文件CREATE成功的独占随机库。
  await prisma.auditLog.deleteMany(); await prisma.employeeExtraPermission.deleteMany(); await prisma.authSession.deleteMany();
  await prisma.employee.deleteMany(); await prisma.customer.deleteMany();
});
afterAll(async () => {
  changeSpy?.mockRestore(); await app?.close(); await peer?.$disconnect();
  try {
    if (databaseCreated) {
      const checked = assertSafeTestDatabase(base.developmentUrl, safe.testUrl);
      if (!/^employee_role_[a-f0-9]{32}_test$/.test(databaseName) || checked.testName !== databaseName) throw new Error('临时调岗库清理目标不合法');
      await admin.query(`DROP DATABASE "${databaseName}"`);
    }
  } finally { await admin.end(); }
});
async function employee(input: Partial<Prisma.EmployeeUncheckedCreateInput> = {}) {
  return prisma.employee.create({ data: { username: `erole_${randomUUID().replaceAll('-', '').slice(0, 20)}`, displayName: '员工调岗夹具',
    role: 'CUSTOMER_SERVICE', mustChangePassword: false, passwordHash, createdAt: new Date('2026-01-01T00:00:00Z'), ...input } });
}
async function access(id: string) {
  return (await prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx, { subjectType: 'EMPLOYEE', subjectId: id,
    expectedPasswordHash: passwordHash, expectedTokenVersion: 0 }))).accessToken;
}
function input(patch: Partial<EmployeeRoleDto> = {}): EmployeeRoleDto { return { role: 'MERCH_WAREHOUSE', expectedVersion: 0, reason: ' 调整岗位 ', ...patch }; }
async function change(id: string, body: unknown = input(), credential: string | null = token) {
  return fetch(`${baseUrl}/api/v1/admin/employees/${id}/change-role`, { method: 'POST', headers: {
    'Content-Type': 'application/json', ...(credential ? { Authorization: `Bearer ${credential}` } : {}), 'X-Request-Id': 'private-input' }, body: JSON.stringify(body) });
}
async function disable(id: string, credential = token) {
  return fetch(`${baseUrl}/api/v1/admin/employees/${id}/disable`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` },
    body: JSON.stringify({ expectedVersion: 0, reason: '并发停用' }) });
}
async function create(username: string, credential = token) {
  return fetch(`${baseUrl}/api/v1/admin/employees`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` },
    body: JSON.stringify({ username, displayName: '并发创建', role: 'CUSTOMER_SERVICE', initialPassword: password, reason: '调岗仲裁验证' }) });
}
async function get(path: string, credential = token) { return fetch(`${baseUrl}/api/v1/${path}`, { headers: { Authorization: `Bearer ${credential}` } }); }
async function login(username: string) {
  return fetch(`${baseUrl}/api/v1/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
}
async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status); const body = await response.json() as { code: string; requestId: string; details?: unknown };
  expect(body.code).toBe(code); expect(body.requestId).toBe(response.headers.get('x-request-id'));
  for (const secret of [password, passwordHash, token, 'private-input']) expect(JSON.stringify(body)).not.toContain(secret); return body;
}
async function success(response: Response, id: string, role: EmployeeRole, version = 1, permissionVersion = 1, changed = true, extras: string[] = []) {
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json() as { data: unknown; requestId: string };
  expect(Object.keys(body).sort()).toEqual(['data', 'requestId']); expect(body.requestId).toBe(response.headers.get('x-request-id'));
  expect(body.data).toEqual({ id, role, version, permissionVersion, changed, extraPermissions: extras });
  for (const secret of [password, passwordHash, token]) expect(JSON.stringify(body)).not.toContain(secret); return body;
}
async function facts(id: string) {
  return { employee: await prisma.employee.findUniqueOrThrow({ where: { id } }),
    sessions: await prisma.authSession.findMany({ where: { employeeId: id }, orderBy: { id: 'asc' } }),
    extras: await prisma.employeeExtraPermission.findMany({ where: { employeeId: id }, orderBy: { permissionCode: 'asc' } }),
    audits: await prisma.auditLog.findMany({ where: { targetId: id }, orderBy: { id: 'asc' } }) };
}
async function grant(id: string) {
  await prisma.employeeExtraPermission.createMany({ data: ['order.fulfillment.read', 'shipment.tracking.correct'].map(permissionCode => ({
    employeeId: id, permissionCode, grantedById: actorId })) });
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
  throw new Error('未观察到调岗并发事务的实际锁等待');
}

const transitions: [EmployeeRole, EmployeeRole][] = [
  ['SUPER_ADMIN', 'MERCH_WAREHOUSE'], ['SUPER_ADMIN', 'CUSTOMER_SERVICE'], ['MERCH_WAREHOUSE', 'SUPER_ADMIN'],
  ['MERCH_WAREHOUSE', 'CUSTOMER_SERVICE'], ['CUSTOMER_SERVICE', 'SUPER_ADMIN'], ['CUSTOMER_SERVICE', 'MERCH_WAREHOUSE'],
];
it.each(transitions)('%s→%s只更新岗位/双版本并清额外，密码/会话/状态保留且审计资格同事务', async (from, to) => {
  const target = await employee({ role: from, version: 3, permissionVersion: 7 }); const first = await access(target.id); await access(target.id);
  if (from === 'CUSTOMER_SERVICE') await grant(target.id); const before = await facts(target.id); const actorBefore = await facts(actorId);
  const result = await success(await change(target.id.toUpperCase(), input({ role: to, expectedVersion: 3 })), target.id, to, 4, 8);
  const after = await facts(target.id);
  expect(after.employee).toEqual({ ...before.employee, role: to, version: 4, permissionVersion: 8, updatedAt: after.employee.updatedAt });
  expect(after.sessions).toEqual(before.sessions); expect(after.extras).toEqual([]); expect(await facts(actorId)).toEqual(actorBefore);
  expect(after.audits).toHaveLength(1); expect(after.audits[0]).toMatchObject({ actorType: 'EMPLOYEE', actorEmployeeId: actorId,
    action: 'employee.role.change', reason: '调整岗位', requestId: result.requestId,
    beforeData: { role: from, extraPermissions: before.extras.map(p => p.permissionCode) }, afterData: { role: to, extraPermissions: [] } });
  for (const secret of [password, passwordHash, first]) expect(JSON.stringify(after.audits)).not.toContain(secret);
  expect(eligibility.calls).toHaveLength(1); expect(eligibility.calls[0]).toEqual({ id: target.id, reason: '调整岗位', sameTransaction: true,
    insideRole: to, outsideRole: from, insideExtras: 0, outsideExtras: before.extras.length, insideAudits: 1,
    oldEffective: new PermissionService().effectivePermissions(from, before.extras.map(p => p.permissionCode)), newEffective: [...roleTemplates[to]].sort() });
  expect((await get('admin/me', first)).status).toBe(200); const response = await get('admin/me/permissions', first); expect(response.status).toBe(200);
  const body = await response.json() as { data: { role: string; permissionVersion: number; extraPermissions: string[]; effectivePermissions: string[] } };
  expect(body.data).toMatchObject({ role: to, permissionVersion: 8, extraPermissions: [], effectivePermissions: [...roleTemplates[to]].sort() });
  const managed = await get('admin/employees', first);
  if (to === 'SUPER_ADMIN') expect(managed.status).toBe(200); else await error(managed, 403, 'FORBIDDEN');
});

it.each(['SUPER_ADMIN', 'MERCH_WAREHOUSE', 'CUSTOMER_SERVICE'] as const)('同岗位%s且版本匹配changed=false，保留额外/双版本/更新时间且不审计或调用资格', async role => {
  const target = await employee({ role, version: 2, permissionVersion: 6 });
  if (role === 'CUSTOMER_SERVICE') await grant(target.id); const before = await facts(target.id); audit.fail = true; eligibility.fail = true;
  await success(await change(target.id, input({ role, expectedVersion: 2 })), target.id, role, 2, 6, false, before.extras.map(p => p.permissionCode));
  await error(await change(target.id, input({ role, expectedVersion: 1 })), 409, 'VERSION_CONFLICT');
  expect(await facts(target.id)).toEqual(before); expect(eligibility.calls).toHaveLength(0);
});

it('唯一ACTIVE管理员不能降级；停用管理员不计数，强制改密的ACTIVE管理员计数', async () => {
  await employee({ role: 'SUPER_ADMIN', status: 'DISABLED' }); const before = await facts(actorId);
  await error(await change(actorId, input({ role: 'CUSTOMER_SERVICE' })), 409, 'LAST_ADMIN_REQUIRED');
  expect(await facts(actorId)).toEqual(before); expect(eligibility.calls).toHaveLength(0);
  await employee({ role: 'SUPER_ADMIN', mustChangePassword: true }); await success(await change(actorId, input({ role: 'CUSTOMER_SERVICE' })), actorId, 'CUSTOMER_SERVICE');
  expect(await prisma.employee.count({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE' } })).toBe(1);
  expect((await get('admin/me')).status).toBe(200); await error(await get('admin/employees'), 403, 'FORBIDDEN');
  expect((await get('admin/me/permissions')).status).toBe(200); expect((await facts(actorId)).sessions).toEqual(before.sessions);
});

it('停用管理员可降级且不自动启用，原强制改密标志保持，资格两端均为空', async () => {
  const target = await employee({ role: 'SUPER_ADMIN', status: 'DISABLED', mustChangePassword: true });
  await success(await change(target.id), target.id, 'MERCH_WAREHOUSE'); const after = await facts(target.id);
  expect(after.employee).toMatchObject({ status: 'DISABLED', mustChangePassword: true, tokenVersion: 0 });
  expect(eligibility.calls[0]).toMatchObject({ oldEffective: [], newEffective: [] }); await error(await login(target.username), 401, 'ACCOUNT_UNAVAILABLE');
});
it('停用普通岗升为管理员不成为ACTIVE管理员，仍不能降级唯一ACTIVE管理员', async () => {
  const target = await employee({ status: 'DISABLED' }); await grant(target.id);
  await success(await change(target.id, input({ role: 'SUPER_ADMIN' })), target.id, 'SUPER_ADMIN');
  expect((await facts(target.id)).extras).toEqual([]); expect(eligibility.calls[0]).toMatchObject({ oldEffective: [], newEffective: [] });
  await error(await change(actorId), 409, 'LAST_ADMIN_REQUIRED');
});
it('ACTIVE且强制改密目标升岗仍须改密，资格按永久岗位计算而非改密访问白名单', async () => {
  const target = await employee({ mustChangePassword: true }); const credential = await access(target.id);
  await success(await change(target.id, input({ role: 'SUPER_ADMIN' })), target.id, 'SUPER_ADMIN');
  expect((await facts(target.id)).employee.mustChangePassword).toBe(true); expect((await get('admin/me', credential)).status).toBe(200);
  await error(await get('admin/employees', credential), 403, 'PASSWORD_CHANGE_REQUIRED'); expect(eligibility.calls[0]?.newEffective).toEqual([...roleTemplates.SUPER_ADMIN].sort());
});

const invalidCases: [string, Record<string, unknown>][] = [
  ['未知岗位', { role: 'OTHER' }], ['小写岗位', { role: 'super_admin' }], ['空岗位', { role: null }], ['岗位数组', { role: ['SUPER_ADMIN'] }],
  ['版本字符串', { expectedVersion: '0' }], ['版本布尔', { expectedVersion: true }], ['版本null', { expectedVersion: null }],
  ['版本负数', { expectedVersion: -1 }], ['版本小数', { expectedVersion: 0.1 }], ['版本超安全整数', { expectedVersion: Number.MAX_SAFE_INTEGER + 1 }],
  ['原因空白', { reason: ' ' }], ['原因超长', { reason: '原'.repeat(501) }], ['原因类型', { reason: {} }],
  ['注入状态', { status: 'ACTIVE' }], ['注入密码', { password: 'private-input' }], ['注入个人授权', { extraPermissions: ['employee.create'] }],
  ['注入权限版本', { permissionVersion: 8 }], ['注入令牌版本', { tokenVersion: 8 }], ['注入强制改密', { mustChangePassword: false }],
];
it.each(invalidCases)('%s400且服务未执行，员工/授权/会话/审计保留', async (_name, patch) => {
  const target = await employee(); await grant(target.id); const before = await facts(target.id);
  await error(await change(target.id, { ...input(), ...patch }), 400, 'VALIDATION_FAILED'); expect(changeSpy).not.toHaveBeenCalled(); expect(await facts(target.id)).toEqual(before);
});
it.each(['role', 'expectedVersion', 'reason'] as const)('缺少%s400且不进入服务', async field => {
  const target = await employee(); const body: Partial<EmployeeRoleDto> = input(); delete body[field];
  await error(await change(target.id, body), 400, 'VALIDATION_FAILED'); expect(changeSpy).not.toHaveBeenCalled();
});
it('500字原因可用，无效UUID400不进服务、有权未知目标404、最大安全整数旧版本409', async () => {
  await error(await change('not-a-uuid'), 400, 'VALIDATION_FAILED'); expect(changeSpy).not.toHaveBeenCalled();
  await error(await change(randomUUID()), 404, 'EMPLOYEE_NOT_FOUND'); const target = await employee();
  await error(await change(target.id, input({ expectedVersion: Number.MAX_SAFE_INTEGER })), 409, 'VERSION_CONFLICT');
  await success(await change(target.id, input({ reason: '原'.repeat(500) })), target.id, 'MERCH_WAREHOUSE');
});

it.each(['MERCH_WAREHOUSE', 'CUSTOMER_SERVICE'] as const)('%s对存在/不存在/非法目标及岗位注入统一403，无参数/目标探查', async role => {
  const actor = await employee({ role }); const credential = await access(actor.id); const target = await employee();
  for (const id of [target.id, randomUUID(), 'not-a-uuid']) expect((await error(await change(id, { ...input(), status: 'ACTIVE' }, credential), 403, 'FORBIDDEN')).details).toBeUndefined();
  expect(changeSpy).not.toHaveBeenCalled();
});
it('缺凭证、顾客域、强制改密、停用、撤销、到期均在入口拒绝', async () => {
  const target = await employee(); await error(await change(target.id, input(), null), 401, 'TOKEN_INVALID');
  const customer = await prisma.customer.create({ data: { phone: `139${randomInt(100_000_000).toString().padStart(8, '0')}`, nickname: '调岗域夹具', passwordHash,
    createdAt: new Date('2026-01-01T00:00:00Z') } });
  const issued = await prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx, { subjectType: 'CUSTOMER', subjectId: customer.id, expectedPasswordHash: passwordHash, expectedTokenVersion: 0 }));
  await error(await change(target.id, input(), issued.accessToken), 401, 'TOKEN_SUBJECT_MISMATCH');
  await prisma.employee.update({ where: { id: actorId }, data: { mustChangePassword: true } }); await error(await change(target.id), 403, 'PASSWORD_CHANGE_REQUIRED');
  await prisma.employee.update({ where: { id: actorId }, data: { mustChangePassword: false, status: 'DISABLED' } }); await error(await change(target.id), 401, 'ACCOUNT_UNAVAILABLE');
  await prisma.employee.update({ where: { id: actorId }, data: { status: 'ACTIVE' } }); const claims = await tokens.verify(token, 'EMPLOYEE');
  await prisma.$transaction(tx => sessions.revokeCurrent(tx, { subjectType: 'EMPLOYEE', subjectId: actorId }, claims.sid)); await error(await change(target.id), 401, 'SESSION_REVOKED');
  millis += 7_200_000; await error(await change(target.id), 401, 'TOKEN_EXPIRED'); expect(changeSpy).not.toHaveBeenCalled();
});

it.each(['审计', '资格入口'] as const)('%s真实写后故障使岗位/清空授权/双版本/审计回滚，会话保留，解除可重试', async failure => {
  const target = await employee(); const credential = await access(target.id); await grant(target.id); const before = await facts(target.id);
  audit.fail = failure === '审计'; eligibility.fail = failure === '资格入口'; await error(await change(target.id), 500, 'INTERNAL_ERROR');
  expect(audit.observedWrites).toBe(true); expect(await facts(target.id)).toEqual(before); expect((await get('admin/me', credential)).status).toBe(200);
  if (failure === '资格入口') expect(eligibility.calls[0]).toMatchObject({ sameTransaction: true, insideExtras: 0, outsideExtras: 2, insideAudits: 1 });
  else expect(eligibility.calls).toHaveLength(0);
  audit.fail = false; eligibility.fail = false; await success(await change(target.id), target.id, 'MERCH_WAREHOUSE'); expect((await facts(target.id)).audits).toHaveLength(1);
});

it.each(['降岗', '强制改密', '停用', '注销', '令牌版本', '到期', '降岗且目标不存在'] as const)('Guard旧快照后%s，锁内重验优先于目标和版本错误', async operation => {
  const target = await employee(); const before = await facts(target.id); const claims = await tokens.verify(token, 'EMPLOYEE');
  identities.afterGuard = async () => {
    await peer.$transaction(async tx => {
      await tx.$queryRaw`SELECT key FROM system_guard WHERE key='ADMIN_AVAILABILITY' FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM employee WHERE id=${actorId}::uuid FOR UPDATE`;
      if (operation.startsWith('降岗')) await tx.employee.update({ where: { id: actorId }, data: { role: 'CUSTOMER_SERVICE', version: { increment: 1 }, permissionVersion: { increment: 1 } } });
      if (operation === '强制改密') await tx.employee.update({ where: { id: actorId }, data: { mustChangePassword: true } });
      if (operation === '停用') await tx.employee.update({ where: { id: actorId }, data: { status: 'DISABLED' } });
      if (operation === '注销') await sessions.revokeCurrent(tx, { subjectType: 'EMPLOYEE', subjectId: actorId }, claims.sid);
      if (operation === '令牌版本') await tx.employee.update({ where: { id: actorId }, data: { tokenVersion: { increment: 1 } } });
    }); if (operation === '到期') millis += 7_200_000;
  };
  const code = { 降岗: 'FORBIDDEN', 强制改密: 'PASSWORD_CHANGE_REQUIRED', 停用: 'ACCOUNT_UNAVAILABLE', 注销: 'SESSION_REVOKED', 令牌版本: 'TOKEN_INVALID', 到期: 'TOKEN_EXPIRED', 降岗且目标不存在: 'FORBIDDEN' }[operation];
  await error(await change(operation === '降岗且目标不存在' ? randomUUID() : target.id, input({ expectedVersion: 99 })), operation.startsWith('降岗') || operation === '强制改密' ? 403 : 401, code);
  expect(changeSpy).toHaveBeenCalledTimes(1); expect(await facts(target.id)).toEqual(before);
});

it.each(['本人', '对方'] as const)('两名管理员并发降级%s，稳定锁后仍保留一名，原会话不撤销', async mode => {
  const other = await employee({ role: 'SUPER_ADMIN' }); const credential = await access(other.id); const gate = barrier(); let pid = 0;
  const firstTarget = mode === '本人' ? actorId : other.id; const secondTarget = mode === '本人' ? other.id : actorId;
  const beforeSessions = await prisma.authSession.findMany({ orderBy: { id: 'asc' } });
  audit.afterWrite = async (tx, payload) => { if (payload.action === 'employee.role.change') { pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold; } };
  const first = change(firstTarget); let second: Promise<Response> | undefined;
  try {
    await Promise.race([gate.ready, first.then(() => { throw new Error('调岗未进入审计屏障'); })]);
    second = change(secondTarget, input(), credential); await waitForBlocker(pid); gate.release(); await success(await first, firstTarget, 'MERCH_WAREHOUSE');
    await error(await second, mode === '本人' ? 409 : 403, mode === '本人' ? 'LAST_ADMIN_REQUIRED' : 'FORBIDDEN');
    expect(await prisma.employee.count({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'employee.role.change' } })).toBe(1); expect(eligibility.calls).toHaveLength(1);
    expect(await prisma.authSession.findMany({ orderBy: { id: 'asc' } })).toEqual(beforeSessions);
  } finally { gate.release(); await Promise.allSettled([first, ...(second ? [second] : [])]); }
});

it.each([true, false])('停用＋降岗保护最后管理员（调岗先提交=%s）', async roleFirst => {
  const other = await employee({ role: 'SUPER_ADMIN' }); const credential = await access(other.id); const gate = barrier(); let pid = 0;
  audit.afterWrite = async tx => { pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold; };
  const first = roleFirst ? change(actorId) : disable(actorId); let second: Promise<Response> | undefined;
  try {
    await Promise.race([gate.ready, first.then(() => { throw new Error('混合命令未进入屏障'); })]);
    second = roleFirst ? disable(other.id, credential) : change(other.id, input(), credential); await waitForBlocker(pid); gate.release();
    if (roleFirst) await success(await first, actorId, 'MERCH_WAREHOUSE'); else expect((await first).status).toBe(200);
    await error(await second, 409, 'LAST_ADMIN_REQUIRED'); expect(await prisma.employee.count({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: { in: ['employee.role.change', 'employee.disable'] } } })).toBe(1);
  } finally { gate.release(); await Promise.allSettled([first, ...(second ? [second] : [])]); }
});

it('管理员稳定锁优先，等待时未提前占操作者或目标员工锁', async () => {
  const target = await employee(); const gate = barrier(); let pid = 0;
  const blocker = peer.$transaction(async tx => {
    await tx.$queryRaw`SELECT key FROM system_guard WHERE key='ADMIN_AVAILABILITY' FOR UPDATE`;
    pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold;
    await tx.$queryRaw`SELECT id FROM employee WHERE id=${actorId}::uuid FOR UPDATE NOWAIT`;
    await tx.$queryRaw`SELECT id FROM employee WHERE id=${target.id}::uuid FOR UPDATE NOWAIT`;
  }); let pending: Promise<Response> | undefined;
  try {
    await Promise.race([gate.ready, blocker.then(() => { throw new Error('未取得稳定锁'); })]);
    pending = change(target.id); await waitForBlocker(pid); gate.release(); await blocker; await success(await pending, target.id, 'MERCH_WAREHOUSE');
  } finally { gate.release(); await Promise.allSettled([blocker, ...(pending ? [pending] : [])]); }
});

it.each([true, false])('操作者ID在前=%s，先等较小员工ID且未提前锁较大ID', async actorFirst => {
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
    pending = change(target.id, input(), credential); await waitForBlocker(pid); gate.release(); await blocker; await success(await pending, target.id, 'MERCH_WAREHOUSE');
  } finally { gate.release(); await Promise.allSettled([blocker, ...(pending ? [pending] : [])]); }
});

it('同一目标同版本并发换岗，仅首次200、后请求409，清空授权和双版本只改变一次', async () => {
  const target = await employee(); await grant(target.id); const gate = barrier(); let pid = 0;
  audit.afterWrite = async tx => { pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold; };
  const first = change(target.id); let second: Promise<Response> | undefined;
  try {
    await Promise.race([gate.ready, first.then(() => { throw new Error('未进入调岗屏障'); })]);
    second = change(target.id, input({ role: 'SUPER_ADMIN' })); await waitForBlocker(pid); gate.release();
    await success(await first, target.id, 'MERCH_WAREHOUSE'); await error(await second, 409, 'VERSION_CONFLICT');
    const after = await facts(target.id); expect(after.employee).toMatchObject({ role: 'MERCH_WAREHOUSE', version: 1, permissionVersion: 1 });
    expect(after.extras).toEqual([]); expect(after.audits).toHaveLength(1); expect(eligibility.calls).toHaveLength(1);
  } finally { gate.release(); await Promise.allSettled([first, ...(second ? [second] : [])]); }
});

it('先升另一人为管理员，再降原唯一管理员，实际等待后两请求成功', async () => {
  const target = await employee(); const gate = barrier(); let pid = 0; let count = 0;
  audit.afterWrite = async tx => { if (++count === 1) { pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold; } };
  const first = change(target.id, input({ role: 'SUPER_ADMIN' })); let second: Promise<Response> | undefined;
  try {
    await Promise.race([gate.ready, first.then(() => { throw new Error('升岗未进入屏障'); })]);
    second = change(actorId); await waitForBlocker(pid); gate.release();
    await success(await first, target.id, 'SUPER_ADMIN'); await success(await second, actorId, 'MERCH_WAREHOUSE');
    expect(await prisma.employee.count({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE' } })).toBe(1);
  } finally { gate.release(); await Promise.allSettled([first, ...(second ? [second] : [])]); }
});

it('降岗与真实管理员seed共用稳定锁，seed等待后不新增或覆盖账号', async () => {
  const target = await employee({ role: 'SUPER_ADMIN' }); const before = await facts(actorId); const gate = barrier(); let pid = 0;
  audit.afterWrite = async tx => { pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold; };
  const first = change(target.id); let seed: ReturnType<typeof seedInitialAdmin> | undefined;
  try {
    await Promise.race([gate.ready, first.then(() => { throw new Error('降岗未进入屏障'); })]);
    seed = seedInitialAdmin(peer, { username: 'seed_after_role', password }, { passwords: { hash: async () => passwordHash }, audit: new AuditService() });
    await waitForBlocker(pid); gate.release(); await success(await first, target.id, 'MERCH_WAREHOUSE'); expect((await seed).created).toBe(false);
    expect(await prisma.employee.count()).toBe(2); expect(await facts(actorId)).toEqual(before);
  } finally { gate.release(); await Promise.allSettled([first, ...(seed ? [seed] : [])]); }
});

it('先启用停用管理员，再并发降级原唯一ACTIVE管理员，两请求等待后均成功', async () => {
  const target = await employee({ role: 'SUPER_ADMIN', status: 'DISABLED' }); const gate = barrier(); let pid = 0;
  audit.afterWrite = async (tx, payload) => { if (payload.action === 'employee.enable') { pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold; } };
  const first = fetch(`${baseUrl}/api/v1/admin/employees/${target.id}/enable`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ expectedVersion: 0, reason: '先启用管理员' }) }); let pending: Promise<Response> | undefined;
  try {
    await Promise.race([gate.ready, first.then(() => { throw new Error('启用未进入屏障'); })]);
    pending = change(actorId); await waitForBlocker(pid); gate.release(); expect((await first).status).toBe(200); await success(await pending, actorId, 'MERCH_WAREHOUSE');
    expect(await prisma.employee.count({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE' } })).toBe(1);
  } finally { gate.release(); await Promise.allSettled([first, ...(pending ? [pending] : [])]); }
});

it('真实创建员工先占操作者锁，调岗实际等待；创建先成功，降岗后不能再次创建', async () => {
  const other = await employee({ role: 'SUPER_ADMIN' }); const credential = await access(other.id); const gate = barrier(); let pid = 0;
  audit.afterWrite = async (tx, payload) => { if (payload.action === 'employee.create') { pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold; } };
  const first = create('before_role_change'); let pending: Promise<Response> | undefined;
  try {
    await Promise.race([gate.ready, first.then(() => { throw new Error('创建未进入屏障'); })]);
    pending = change(actorId, input(), credential); await waitForBlocker(pid); gate.release(); expect((await first).status).toBe(201);
    await success(await pending, actorId, 'MERCH_WAREHOUSE'); await error(await create('after_role_change'), 403, 'FORBIDDEN');
    expect(await prisma.employee.count({ where: { username: 'before_role_change' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'employee.create' } })).toBe(1);
  } finally { gate.release(); await Promise.allSettled([first, ...(pending ? [pending] : [])]); }
});

it('真实降岗先占操作者锁，创建实际等待；锁内新权限拒绝创建，无新员工/审计', async () => {
  const other = await employee({ role: 'SUPER_ADMIN' }); const credential = await access(other.id); const gate = barrier(); let pid = 0;
  audit.afterWrite = async (tx, payload) => { if (payload.action === 'employee.role.change') { pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold; } };
  const first = change(actorId, input(), credential); let pending: Promise<Response> | undefined;
  try {
    await Promise.race([gate.ready, first.then(() => { throw new Error('降岗未进入屏障'); })]);
    pending = create('during_role_change'); await waitForBlocker(pid); gate.release(); await success(await first, actorId, 'MERCH_WAREHOUSE'); await error(await pending, 403, 'FORBIDDEN');
    expect(await prisma.employee.count({ where: { username: 'during_role_change' } })).toBe(0); expect(await prisma.auditLog.count({ where: { action: 'employee.create' } })).toBe(0);
  } finally { gate.release(); await Promise.allSettled([first, ...(pending ? [pending] : [])]); }
});

it('锁等待后按最新目标版本409，保留先提交资料且不清授权', async () => {
  const target = await employee(); await grant(target.id); const gate = barrier(); let pid = 0;
  const blocker = peer.$transaction(async tx => {
    await tx.$queryRaw`SELECT key FROM system_guard WHERE key='ADMIN_AVAILABILITY' FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM employee WHERE id=${target.id}::uuid FOR UPDATE`;
    await tx.employee.update({ where: { id: target.id }, data: { displayName: '先提交资料', version: { increment: 1 } } });
    pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold;
  }); let pending: Promise<Response> | undefined;
  try {
    await Promise.race([gate.ready, blocker.then(() => { throw new Error('未进入版本屏障'); })]);
    pending = change(target.id); await waitForBlocker(pid); gate.release(); await blocker; await error(await pending, 409, 'VERSION_CONFLICT');
    const after = await facts(target.id); expect(after.employee).toMatchObject({ role: 'CUSTOMER_SERVICE', displayName: '先提交资料', version: 1, permissionVersion: 0 });
    expect(after.extras).toHaveLength(2); expect(after.audits).toHaveLength(0);
  } finally { gate.release(); await Promise.allSettled([blocker, ...(pending ? [pending] : [])]); }
});

it('缺少稳定行安全500，不自动补行或修改目标', async () => {
  const target = await employee(); await grant(target.id); const before = await facts(target.id); await prisma.systemGuard.delete({ where: { key: 'ADMIN_AVAILABILITY' } });
  try {
    await error(await change(target.id), 500, 'INTERNAL_ERROR'); expect(await facts(target.id)).toEqual(before);
    expect(await prisma.systemGuard.count({ where: { key: 'ADMIN_AVAILABILITY' } })).toBe(0);
  } finally { await prisma.systemGuard.create({ data: { key: 'ADMIN_AVAILABILITY' } }); }
});

it('编译API真实登录调岗，旧token读取新权限/升降管理权限，不撤销会话', async () => {
  const target = await employee(); await grant(target.id); const actor = await prisma.employee.findUniqueOrThrow({ where: { id: actorId } });
  const source = String.raw`
    require('reflect-metadata');
    const { NestFactory } = require('@nestjs/core'); const { AppModule } = require('./dist/app.module.js');
    const { configureApp } = require('./dist/common/configure-app.js');
    (async()=>{const app=await NestFactory.create(AppModule,{logger:false});
      try{configureApp(app);await app.listen(0,'127.0.0.1');const url=await app.getUrl();
        const login=async username=>{const r=await fetch(url+'/api/v1/admin/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({username,password:process.env.SHOP_TEST_PASSWORD})});return {status:r.status,body:await r.json()};};
        const actor=await login(process.env.SHOP_TEST_ACTOR);const target=await login(process.env.SHOP_TEST_USERNAME);
        const change=body=>fetch(url+'/api/v1/admin/employees/'+process.env.SHOP_TEST_TARGET+'/change-role',{method:'POST',headers:{'Content-Type':'application/json',
          Authorization:'Bearer '+actor.body.data.accessToken},body:JSON.stringify(body)});
        const get=path=>fetch(url+'/api/v1/'+path,{headers:{Authorization:'Bearer '+target.body.data.accessToken}});
        const input={role:'SUPER_ADMIN',expectedVersion:0,reason:'编译后调岗'};const invalid=await change({...input,extraPermissions:[]});
        const promoted=await change(input);const body=await promoted.json();const management=await get('admin/employees');
        const stale=await change({...input,role:'MERCH_WAREHOUSE'});const conflict=await stale.json();
        const demoted=await change({...input,role:'MERCH_WAREHOUSE',expectedVersion:1});const denied=await get('admin/employees');const me=await get('admin/me');
        const permissions=await get('admin/me/permissions');const perms=(await permissions.json()).data;
        const same=await change({...input,role:'MERCH_WAREHOUSE',expectedVersion:2});const sameBody=await same.json();
        console.log(JSON.stringify({actor:actor.status,login:target.status,invalid:invalid.status,promoted:promoted.status,fields:Object.keys(body.data??{}).sort(),
          extras:body.data?.extraPermissions,version:body.data?.version,permissionVersion:body.data?.permissionVersion,management:management.status,
          stale:stale.status,code:conflict.code,demoted:demoted.status,denied:denied.status,me:me.status,permissions:permissions.status,role:perms.role,
          effectiveCount:perms.effectivePermissions.length,same:same.status,changed:sameBody.data?.changed}));
      }finally{await app.close();}
    })().catch(()=>{console.error('编译后员工调岗验证失败');process.exitCode=1;});`;
  const child = spawnSync(process.execPath, ['-e', source], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true, timeout: 15_000,
    env: { ...process.env, DATABASE_URL: safe.testUrl, LOG_LEVEL: 'silent', SHOP_TEST_ACTOR: actor.username, SHOP_TEST_USERNAME: target.username,
      SHOP_TEST_PASSWORD: password, SHOP_TEST_TARGET: target.id } });
  expect(child.status).toBe(0); expect(JSON.parse(child.stdout.trim())).toEqual({ actor: 200, login: 200, invalid: 400, promoted: 200,
    fields: ['changed', 'extraPermissions', 'id', 'permissionVersion', 'role', 'version'], extras: [], version: 1, permissionVersion: 1, management: 200,
    stale: 409, code: 'VERSION_CONFLICT', demoted: 200, denied: 403, me: 200, permissions: 200, role: 'MERCH_WAREHOUSE', effectiveCount: 25, same: 200, changed: false });
  const after = await facts(target.id); expect(after.sessions).toHaveLength(1); expect(after.sessions[0]?.revokedAt).toBeNull(); expect(after.audits).toHaveLength(2);
  for (const secret of [password, passwordHash]) expect(child.stdout + child.stderr).not.toContain(secret);
});
