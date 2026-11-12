// 作用：验证额外权限依赖、差集持久化、实时撤权、锁仲裁及回滚。
import 'reflect-metadata';
import { randomInt, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
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
import { JwtTokenService } from '../src/auth/jwt-token.service.js';
import { PasswordService } from '../src/auth/password.service.js';
import { configureApp } from '../src/common/configure-app.js';
import { APP_CONFIG, loadConfiguration } from '../src/config/environment.js';
import { EmployeeEligibilityService } from '../src/employees/employee-eligibility.service.js';
import { EmployeeExtraPermissionController } from '../src/employees/employee-extra-permission.controller.js';
import { EmployeeExtraPermissionDto } from '../src/employees/employee-extra-permission.dto.js';
import { EmployeeExtraPermissionService } from '../src/employees/employee-extra-permission.service.js';
import { EmployeeIdParamsDto } from '../src/employees/employee-query.dto.js';
import { EmployeeRoleController } from '../src/employees/employee-role.controller.js';
import { EmployeeRoleDto } from '../src/employees/employee-role.dto.js';
import { permissionDefinitions, roleTemplates } from '../src/permissions/permission-catalog.js';
import { seedPermissionCatalog } from '../src/permissions/permission-seed.js';
import { PermissionService } from '../src/permissions/permission.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { assertSafeTestDatabase } from '../scripts/database-env.js';

const safe = assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('集成测试仅可在test环境执行');
// Vitest不生成参数元数据；独立编译API子进程另验生产tsc路径。
Reflect.defineMetadata('design:paramtypes', [EmployeeIdParamsDto, EmployeeExtraPermissionDto, Object, Object], EmployeeExtraPermissionController.prototype, 'replace');
Reflect.defineMetadata('design:paramtypes', [EmployeeIdParamsDto, EmployeeRoleDto, Object, Object], EmployeeRoleController.prototype, 'change');
Reflect.defineMetadata('design:paramtypes', [EmployeeLoginDto, Object], EmployeeAuthController.prototype, 'login');
const password = 'EmployeeExtra#2026'; let passwordHash = '';
let millis = Date.parse('2026-11-12T01:00:00.500Z'); const clock = () => new Date(millis);
const tokens = new JwtTokenService({ secret: 'employee-extra-integration-only-'.repeat(3), ttlSeconds: 7200 }, clock);
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
    if (payload.action !== 'employee.permission.replace') return; this.tx = tx;
    const target = await tx.employee.findUniqueOrThrow({ where: { id: payload.targetId } });
    const stored = await tx.employeeExtraPermission.findMany({ where: { employeeId: target.id }, orderBy: { permissionCode: 'asc' }, select: { permissionCode: true } });
    this.observedWrites = target.version > 0 && target.permissionVersion > 0
      && JSON.stringify(stored.map(p => p.permissionCode)) === JSON.stringify(payload.after?.extraPermissions)
      && await tx.auditLog.count({ where: { requestId: payload.requestId } }) === 1;
    if (this.fail) throw new Error('测试专用额外授权审计故障');
  }
}
interface EligibilityCall { id: string; oldEffective: string[]; newEffective: string[]; reason: string; sameTransaction: boolean;
  insideExtras: string[]; outsideExtras: string[]; insideAudits: number }
class ControlledEligibility extends EmployeeEligibilityService {
  fail = false; calls: EligibilityCall[] = [];
  override async onEmployeeEligibilityChanged(tx: Prisma.TransactionClient, id: string,
    oldEffective: readonly string[], newEffective: readonly string[], reason: string) {
    await super.onEmployeeEligibilityChanged(tx, id, oldEffective, newEffective, reason);
    if (audit.tx === tx) {
      const where = { employeeId: id }; const orderBy = { permissionCode: 'asc' as const }; const select = { permissionCode: true };
      this.calls.push({ id, oldEffective: [...oldEffective], newEffective: [...newEffective], reason, sameTransaction: true,
        insideExtras: (await tx.employeeExtraPermission.findMany({ where, orderBy, select })).map(p => p.permissionCode),
        outsideExtras: (await peer.employeeExtraPermission.findMany({ where, orderBy, select })).map(p => p.permissionCode),
        insideAudits: await tx.auditLog.count({ where: { targetId: id, action: 'employee.permission.replace' } }) });
      if (this.fail) throw new Error('测试专用额外授权资格故障');
    }
  }
}
const identities = new ControlledIdentities(tokens, new PermissionService(), clock);
const audit = new ControlledAudit(); const eligibility = new ControlledEligibility();
let app: INestApplication; let prisma: PrismaService; let peer: PrismaService; let baseUrl = ''; let actorId = ''; let token = '';
let replaceSpy: MockInstance<EmployeeExtraPermissionService['replace']>;
const ids = new Set<string>(); const customerIds = new Set<string>();
beforeAll(async () => {
  passwordHash = await new PasswordService().hash(password);
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG).useValue(loadConfiguration({ ...process.env, LOG_LEVEL: 'silent' }))
    .overrideProvider(JwtTokenService).useValue(tokens).overrideProvider(AuthSessionService).useValue(sessions)
    .overrideProvider(CurrentIdentityService).useValue(identities).overrideProvider(AuditService).useValue(audit)
    .overrideProvider(EmployeeEligibilityService).useValue(eligibility).compile();
  app = module.createNestApplication(); configureApp(app); await app.listen(0, '127.0.0.1');
  prisma = app.get(PrismaService); baseUrl = await app.getUrl(); peer = new PrismaService(loadConfiguration()); await peer.onModuleInit();
  await seedPermissionCatalog(prisma); replaceSpy = vi.spyOn(app.get(EmployeeExtraPermissionService), 'replace');
});
beforeEach(async () => {
  millis += 360_000; identities.afterGuard = undefined; audit.fail = false; audit.observedWrites = false; audit.tx = undefined; audit.afterWrite = undefined;
  eligibility.fail = false; eligibility.calls = []; replaceSpy.mockClear(); const actor = await employee({ role: 'SUPER_ADMIN' }); actorId = actor.id; token = await access(actor.id);
});
afterEach(async () => {
  if (!prisma) return; identities.afterGuard = undefined; audit.fail = false; audit.afterWrite = undefined; eligibility.fail = false;
  // 仅清理本文件自建UUID，不重置测试库、不清空未知员工或授权。
  await prisma.employeeExtraPermission.deleteMany({ where: { employeeId: { in: [...ids] } } });
  await prisma.auditLog.deleteMany({ where: { actorEmployeeId: { in: [...ids] } } });
  await prisma.authSession.deleteMany({ where: { OR: [{ employeeId: { in: [...ids] } }, { customerId: { in: [...customerIds] } }] } });
  await prisma.employee.deleteMany({ where: { id: { in: [...ids] } } });
  await prisma.customer.deleteMany({ where: { id: { in: [...customerIds] } } }); ids.clear(); customerIds.clear();
});
afterAll(async () => { replaceSpy?.mockRestore(); await peer?.$disconnect(); await app?.close(); });
async function employee(input: Partial<Prisma.EmployeeUncheckedCreateInput> = {}) {
  const id = input.id ?? randomUUID(); ids.add(id);
  return prisma.employee.create({ data: { id, username: `extra_${randomUUID().replaceAll('-', '').slice(0, 20)}`, displayName: '额外权限夹具', role: 'CUSTOMER_SERVICE',
    mustChangePassword: false, passwordHash, createdAt: new Date('2026-01-01T00:00:00Z'), ...input } });
}
async function access(id: string) {
  return (await prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx, { subjectType: 'EMPLOYEE', subjectId: id,
    expectedPasswordHash: passwordHash, expectedTokenVersion: 0 }))).accessToken;
}
function input(patch: Partial<EmployeeExtraPermissionDto> = {}): EmployeeExtraPermissionDto {
  return { permissions: ['shipment.handover'], expectedVersion: 0, reason: ' 调整兼岗授权 ', ...patch };
}
async function replace(id: string, body: unknown = input(), credential: string | null = token) {
  return fetch(`${baseUrl}/api/v1/admin/employees/${id}/extra-permissions`, { method: 'PUT', headers: { 'Content-Type': 'application/json',
    ...(credential ? { Authorization: `Bearer ${credential}` } : {}), 'X-Request-Id': 'private-input' }, body: JSON.stringify(body) });
}
async function role(id: string, nextRole: EmployeeRole, expectedVersion = 0, credential = token) {
  return fetch(`${baseUrl}/api/v1/admin/employees/${id}/change-role`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` },
    body: JSON.stringify({ role: nextRole, expectedVersion, reason: '授权并发调岗' }) });
}
async function get(path: string, credential = token) { return fetch(`${baseUrl}/api/v1/${path}`, { headers: { Authorization: `Bearer ${credential}` } }); }
async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status); const body = await response.json() as { code: string; requestId: string; details?: unknown };
  expect(body.code).toBe(code); expect(body.requestId).toBe(response.headers.get('x-request-id'));
  for (const secret of [password, passwordHash, token, 'private-input']) expect(JSON.stringify(body)).not.toContain(secret); return body;
}
interface Result { id: string; defaultPermissions: string[]; resolvedExtraPermissions: string[]; effectivePermissions: string[];
  addedByDependency: string[]; removedByDependency: string[]; normalizedDefaultPermissions: string[]; version: number; permissionVersion: number; changed: boolean }
async function success(response: Response, id: string, extras: string[], version = 1, permissionVersion = 1, changed = true) {
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json() as { data: Result; requestId: string };
  expect(Object.keys(body).sort()).toEqual(['data', 'requestId']); expect(body.requestId).toBe(response.headers.get('x-request-id'));
  expect(Object.keys(body.data).sort()).toEqual(['addedByDependency', 'changed', 'defaultPermissions', 'effectivePermissions', 'id', 'normalizedDefaultPermissions', 'permissionVersion', 'removedByDependency', 'resolvedExtraPermissions', 'version']);
  expect(body.data).toMatchObject({ id, resolvedExtraPermissions: extras, version, permissionVersion, changed });
  for (const field of ['defaultPermissions', 'resolvedExtraPermissions', 'effectivePermissions', 'addedByDependency', 'removedByDependency', 'normalizedDefaultPermissions'] as const) {
    expect(body.data[field]).toEqual([...new Set(body.data[field])].sort());
  }
  for (const secret of [password, passwordHash, token]) expect(JSON.stringify(body)).not.toContain(secret); return body;
}
async function facts(id: string) {
  return { employee: await prisma.employee.findUniqueOrThrow({ where: { id } }),
    sessions: await prisma.authSession.findMany({ where: { employeeId: id }, orderBy: { id: 'asc' } }),
    extras: await prisma.employeeExtraPermission.findMany({ where: { employeeId: id }, orderBy: { permissionCode: 'asc' } }),
    audits: await prisma.auditLog.findMany({ where: { targetId: id }, orderBy: { id: 'asc' } }) };
}
async function seedExtras(id: string, permissions: string[]) {
  await prisma.employeeExtraPermission.createMany({ data: permissions.map(permissionCode => ({ employeeId: id, permissionCode, grantedById: actorId })) });
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
  throw new Error('未观察到额外授权事务的实际锁等待');
}

const full = ['order.fulfillment.read', 'shipment.claim', 'shipment.handover', 'shipment.pack', 'shipment.tracking.correct'];
const handover = ['order.fulfillment.read', 'shipment.claim', 'shipment.handover'];
const tracking = ['order.fulfillment.read', 'shipment.tracking.correct'];

const grantCases: [EmployeeRole, string[], string[], string[]][] = [
  ['CUSTOMER_SERVICE', ['shipment.pack', 'shipment.handover', 'shipment.tracking.correct'], full, ['order.fulfillment.read', 'shipment.claim']],
  ['CUSTOMER_SERVICE', ['shipment.handover'], handover, ['order.fulfillment.read', 'shipment.claim']],
  ['CUSTOMER_SERVICE', ['shipment.tracking.correct'], tracking, ['order.fulfillment.read']],
  ['CUSTOMER_SERVICE', ['after-sale.inspection.confirm'], ['after-sale.inspection.confirm', 'after-sale.inspection.read', 'category.read', 'inventory.read', 'order.fulfillment.read', 'product.read'],
    ['after-sale.inspection.read', 'category.read', 'inventory.read', 'order.fulfillment.read', 'product.read']],
  ['MERCH_WAREHOUSE', ['after-sale.refund.retry'], ['after-sale.refund.execute', 'after-sale.refund.retry', 'after-sale.service.read', 'order.service.read'],
    ['after-sale.refund.execute', 'after-sale.service.read', 'order.service.read']],
];
it.each(grantCases)('%s授权组合 %# 真实补齐依赖，双版本/审计/资格同事务且不串给同岗他人', async (targetRole, requested, resolved, added) => {
  const target = await employee({ role: targetRole, version: 3, permissionVersion: 7 }); const credential = await access(target.id); await access(target.id);
  const revoked = await access(target.id); const claims = await tokens.verify(revoked, 'EMPLOYEE');
  await prisma.$transaction(tx => sessions.revokeCurrent(tx, { subjectType: 'EMPLOYEE', subjectId: target.id }, claims.sid));
  const other = await employee({ role: targetRole }); const otherToken = await access(other.id);
  const before = await facts(target.id); const actorBefore = await facts(actorId); const otherBefore = await facts(other.id);
  const result = await success(await replace(target.id.toUpperCase(), input({ permissions: requested, expectedVersion: 3 })), target.id, resolved, 4, 8);
  expect(result.data.addedByDependency).toEqual(added); expect(result.data.removedByDependency).toEqual([]); expect(result.data.normalizedDefaultPermissions).toEqual([]);
  expect(result.data.defaultPermissions).toEqual([...roleTemplates[targetRole]].sort());
  expect(result.data.effectivePermissions).toEqual([...new Set([...roleTemplates[targetRole], ...resolved])].sort());
  expect(result.data.effectivePermissions).not.toContain('employee.permission.manage'); expect(result.data.effectivePermissions).not.toContain('after-sale.dispute.decide');
  if (targetRole === 'CUSTOMER_SERVICE' && requested[0] !== 'after-sale.inspection.confirm') {
    expect(result.data.effectivePermissions).not.toContain('product.read'); expect(result.data.effectivePermissions).not.toContain('inventory.read');
  }
  if (requested[0] === 'shipment.handover') expect(result.data.effectivePermissions).not.toContain('shipment.pack');
  if (requested[0] === 'shipment.tracking.correct') expect(result.data.effectivePermissions).not.toContain('shipment.claim');
  const after = await facts(target.id);
  expect(after.employee).toEqual({ ...before.employee, version: 4, permissionVersion: 8, updatedAt: after.employee.updatedAt });
  expect(after.sessions).toEqual(before.sessions); expect(after.extras.map(p => p.permissionCode)).toEqual(resolved);
  expect(after.extras.every(p => p.grantedById === actorId)).toBe(true); expect(await facts(actorId)).toEqual(actorBefore); expect(await facts(other.id)).toEqual(otherBefore);
  expect(after.audits).toHaveLength(1); expect(after.audits[0]).toMatchObject({ actorType: 'EMPLOYEE', actorEmployeeId: actorId, action: 'employee.permission.replace',
    requestId: result.requestId, reason: '调整兼岗授权', beforeData: { extraPermissions: [] }, afterData: { extraPermissions: resolved } });
  for (const secret of [password, passwordHash, credential]) expect(JSON.stringify(after.audits)).not.toContain(secret);
  expect(eligibility.calls).toEqual([{ id: target.id, reason: '调整兼岗授权', sameTransaction: true, insideExtras: resolved, outsideExtras: [], insideAudits: 1,
    oldEffective: [...roleTemplates[targetRole]].sort(), newEffective: result.data.effectivePermissions }]);
  const response = await get('admin/me/permissions', credential); expect(response.status).toBe(200);
  expect((await response.json() as { data: unknown }).data).toMatchObject({ role: targetRole, permissionVersion: 8, extraPermissions: resolved, effectivePermissions: result.data.effectivePermissions });
  expect((await get('admin/me', credential)).status).toBe(200); await error(await get('admin/employees', credential), 403, 'FORBIDDEN');
  const untouched = await get('admin/me/permissions', otherToken); expect(untouched.status).toBe(200);
  expect((await untouched.json() as { data: { extraPermissions: string[] } }).data.extraPermissions).toEqual([]);
});

it('删除旧履约查询优先级联撤销，不被闭包补回；旧token仍能用默认权限查询', async () => {
  const target = await employee(); const credential = await access(target.id);
  await success(await replace(target.id, input({ permissions: ['shipment.pack', 'shipment.handover', 'shipment.tracking.correct'] })), target.id, full);
  const before = await facts(target.id);
  const result = await success(await replace(target.id, input({ permissions: full.filter(p => p !== 'order.fulfillment.read'), expectedVersion: 1 })), target.id, [], 2, 2);
  expect(result.data.removedByDependency).toEqual(full.filter(p => p !== 'order.fulfillment.read')); expect(result.data.addedByDependency).toEqual([]);
  expect(result.data.effectivePermissions).toEqual([...roleTemplates.CUSTOMER_SERVICE].sort()); const after = await facts(target.id);
  expect(after.sessions).toEqual(before.sessions); expect(after.extras).toEqual([]); expect(after.audits).toHaveLength(2);
  const response = await get('admin/me/permissions', credential); expect(response.status).toBe(200);
  expect((await response.json() as { data: { extraPermissions: string[]; effectivePermissions: string[] } }).data).toMatchObject({ extraPermissions: [], effectivePermissions: result.data.effectivePermissions });
  expect((await get('admin/me', credential)).status).toBe(200);
  await success(await replace(target.id, input({ permissions: [], expectedVersion: 2 })), target.id, [], 2, 2, false);
});

it('删除领取级联撤销交运/打包，保留独立运单修正及原授权人/时间；新增项才记新授权人', async () => {
  const target = await employee(); const grantor = await employee({ role: 'SUPER_ADMIN' }); const credential = await access(grantor.id);
  await success(await replace(target.id, input({ permissions: ['shipment.pack', 'shipment.handover', 'shipment.tracking.correct'] }), credential), target.id, full);
  const before = await facts(target.id);
  const result = await success(await replace(target.id, input({ permissions: [...full.filter(p => p !== 'shipment.claim'), 'dashboard.read'], expectedVersion: 1 })),
    target.id, ['dashboard.read', ...tracking], 2, 2);
  expect(result.data.removedByDependency).toEqual(['shipment.handover', 'shipment.pack']);
  const after = await facts(target.id);
  expect(after.extras.filter(p => tracking.includes(p.permissionCode))).toEqual(before.extras.filter(p => tracking.includes(p.permissionCode)));
  expect(after.extras.find(p => p.permissionCode === 'dashboard.read')?.grantedById).toBe(actorId);
});
it('旧依赖明确撤销时新增操作同样被撤销；此前未存在的依赖才自动补齐', async () => {
  const target = await employee(); await seedExtras(target.id, ['order.fulfillment.read']);
  const blocked = await success(await replace(target.id), target.id, []); expect(blocked.data.removedByDependency).toEqual(['shipment.handover']);
  const fresh = await success(await replace(target.id, input({ expectedVersion: 1 })), target.id, handover, 2, 2);
  expect(fresh.data.addedByDependency).toEqual(['order.fulfillment.read', 'shipment.claim']);
});
it('空数组清空真实额外权限，默认模板及会话原样保留', async () => {
  const target = await employee(); const credential = await access(target.id); await seedExtras(target.id, full); const before = await facts(target.id);
  const result = await success(await replace(target.id, input({ permissions: [] })), target.id, []);
  const after = await facts(target.id); expect(after.sessions).toEqual(before.sessions); expect(result.data.defaultPermissions).toEqual([...roleTemplates.CUSTOMER_SERVICE].sort());
  expect((await get('admin/me/permissions', credential)).status).toBe(200);
});
it.each(['MERCH_WAREHOUSE', 'CUSTOMER_SERVICE'] as const)('%s默认项重复提交只说明规范化，不改权限或版本', async targetRole => {
  const target = await employee({ role: targetRole }); const before = await facts(target.id); const code = roleTemplates[targetRole][0]!;
  const result = await success(await replace(target.id, input({ permissions: [code, code] })), target.id, [], 0, 0, false);
  expect(result.data.normalizedDefaultPermissions).toEqual([code]); expect(await facts(target.id)).toEqual(before); expect(eligibility.calls).toHaveLength(0);
});
it('解析后同集合无变化：顺序/重复/默认项不重写授权人时间，不审计或调用资格，旧版本仍409', async () => {
  const target = await employee(); const grantor = await employee({ role: 'SUPER_ADMIN' }); const credential = await access(grantor.id);
  await success(await replace(target.id, input(), credential), target.id, handover); const before = await facts(target.id);
  audit.fail = true; eligibility.fail = true; eligibility.calls = [];
  const result = await success(await replace(target.id, input({ permissions: [...handover].reverse().concat('shipment.handover', 'customer.read'), expectedVersion: 1 })), target.id, handover, 1, 1, false);
  expect(result.data.normalizedDefaultPermissions).toEqual(['customer.read']); expect(await facts(target.id)).toEqual(before); expect(eligibility.calls).toHaveLength(0);
  await error(await replace(target.id, input({ permissions: handover })), 409, 'VERSION_CONFLICT'); expect(await facts(target.id)).toEqual(before);
});
it('最多200项输入允许去重，持久化不重复授权', async () => {
  const target = await employee(); await success(await replace(target.id, input({ permissions: Array<string>(200).fill('shipment.handover') })), target.id, handover);
  expect((await facts(target.id)).extras).toHaveLength(3);
});

it.each([{ permissions: [] }, { permissions: ['shipment.handover'] }])('SUPER_ADMIN目标个人授权不适用（请求%j），旧版本优先409', async ({ permissions }) => {
  const target = await employee({ role: 'SUPER_ADMIN' }); const before = await facts(target.id);
  await error(await replace(target.id, input({ permissions })), 400, 'EXTRA_PERMISSION_NOT_APPLICABLE'); expect(await facts(target.id)).toEqual(before);
  await error(await replace(target.id, input({ permissions, expectedVersion: 1 })), 409, 'VERSION_CONFLICT');
});
it('管理员本人使用额外授权入口也返回不适用，不允许给自己构造额外权限', async () => {
  const before = await facts(actorId); await error(await replace(actorId, input({ permissions: [] })), 400, 'EXTRA_PERMISSION_NOT_APPLICABLE'); expect(await facts(actorId)).toEqual(before);
});
it.each(permissionDefinitions.filter(p => p.adminOnly).map(p => p.code))('API禁止下放管理员码%s，与合法业务混合也整次失败', async code => {
  const target = await employee(); await seedExtras(target.id, tracking); const before = await facts(target.id);
  await error(await replace(target.id, input({ permissions: ['shipment.handover', code] })), 400, 'PERMISSION_NOT_GRANTABLE'); expect(await facts(target.id)).toEqual(before); expect(eligibility.calls).toHaveLength(0);
});
it.each(['unknown.permission', '', ' shipment.handover ', 'SHIPMENT.HANDOVER'])('未知/未规范码%j拒绝，不静默忽略或trim', async code => {
  const target = await employee(); const before = await facts(target.id);
  await error(await replace(target.id, input({ permissions: ['shipment.handover', code] })), 400, 'PERMISSION_NOT_GRANTABLE'); expect(await facts(target.id)).toEqual(before);
});

const invalidCases: [string, Record<string, unknown>][] = [
  ['非数组', { permissions: 'shipment.handover' }], ['空值', { permissions: null }], ['对象', { permissions: {} }], ['嵌套数组', { permissions: [['shipment.handover']] }],
  ['元素数字', { permissions: [123] }], ['元素空值', { permissions: [null] }], ['数组超限', { permissions: Array<string>(201).fill('shipment.handover') }],
  ['码超100字符', { permissions: ['a'.repeat(101)] }], ['版本字符串', { expectedVersion: '0' }], ['版本布尔', { expectedVersion: true }], ['版本null', { expectedVersion: null }],
  ['版本负数', { expectedVersion: -1 }], ['版本小数', { expectedVersion: 0.1 }], ['版本超安全整数', { expectedVersion: Number.MAX_SAFE_INTEGER + 1 }],
  ['原因空白', { reason: ' ' }], ['原因超长', { reason: '原'.repeat(501) }], ['原因类型', { reason: [] }],
  ['注入岗位', { role: 'SUPER_ADMIN' }], ['注入状态', { status: 'ACTIVE' }], ['注入密码', { password: 'private-input' }], ['注入权限版本', { permissionVersion: 1 }],
  ['注入令牌版本', { tokenVersion: 1 }], ['注入有效权限', { effectivePermissions: ['employee.create'] }], ['注入依赖结果', { addedByDependency: ['shipment.claim'] }],
];
it.each(invalidCases)('%s400且服务未执行，员工/授权/会话/审计保留', async (_name, patch) => {
  const target = await employee(); await seedExtras(target.id, tracking); const before = await facts(target.id);
  await error(await replace(target.id, { ...input(), ...patch }), 400, 'VALIDATION_FAILED'); expect(replaceSpy).not.toHaveBeenCalled(); expect(await facts(target.id)).toEqual(before);
});
it.each(['permissions', 'expectedVersion', 'reason'] as const)('缺少%s400且服务未执行', async field => {
  const target = await employee(); const body: Partial<EmployeeExtraPermissionDto> = input(); delete body[field];
  await error(await replace(target.id, body), 400, 'VALIDATION_FAILED'); expect(replaceSpy).not.toHaveBeenCalled();
});
it('500字原因接受，无效UUID400不进服务，有权未知404，最大安全旧版本409', async () => {
  await error(await replace('not-a-uuid'), 400, 'VALIDATION_FAILED'); expect(replaceSpy).not.toHaveBeenCalled();
  await error(await replace(randomUUID()), 404, 'EMPLOYEE_NOT_FOUND'); const target = await employee();
  await error(await replace(target.id, input({ expectedVersion: Number.MAX_SAFE_INTEGER })), 409, 'VERSION_CONFLICT');
  await success(await replace(target.id, input({ reason: '原'.repeat(500) })), target.id, handover);
});

it.each(['MERCH_WAREHOUSE', 'CUSTOMER_SERVICE'] as const)('%s不能探查目标或利用字段注入授权，入口统一403', async targetRole => {
  const actor = await employee({ role: targetRole }); const credential = await access(actor.id); const target = await employee(); const before = await facts(target.id);
  for (const id of [target.id, randomUUID(), 'not-a-uuid']) {
    expect((await error(await replace(id, { ...input(), role: 'SUPER_ADMIN' }, credential), 403, 'FORBIDDEN')).details).toBeUndefined();
  }
  expect(replaceSpy).not.toHaveBeenCalled(); expect(await facts(target.id)).toEqual(before);
});
it('缺凭证、顾客域、强制改密、停用、注销及到期均在入口拒绝', async () => {
  const target = await employee(); await error(await replace(target.id, input(), null), 401, 'TOKEN_INVALID');
  const customer = await prisma.customer.create({ data: { phone: `139${randomInt(100_000_000).toString().padStart(8, '0')}`, nickname: '授权域夹具', passwordHash } });
  customerIds.add(customer.id);
  const issued = await prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx, { subjectType: 'CUSTOMER', subjectId: customer.id, expectedPasswordHash: passwordHash, expectedTokenVersion: 0 }));
  await error(await replace(target.id, input(), issued.accessToken), 401, 'TOKEN_SUBJECT_MISMATCH');
  await prisma.employee.update({ where: { id: actorId }, data: { mustChangePassword: true } }); await error(await replace(target.id), 403, 'PASSWORD_CHANGE_REQUIRED');
  await prisma.employee.update({ where: { id: actorId }, data: { mustChangePassword: false, status: 'DISABLED' } }); await error(await replace(target.id), 401, 'ACCOUNT_UNAVAILABLE');
  await prisma.employee.update({ where: { id: actorId }, data: { status: 'ACTIVE' } }); const claims = await tokens.verify(token, 'EMPLOYEE');
  await prisma.$transaction(tx => sessions.revokeCurrent(tx, { subjectType: 'EMPLOYEE', subjectId: actorId }, claims.sid)); await error(await replace(target.id), 401, 'SESSION_REVOKED');
  millis += 7_200_000; await error(await replace(target.id), 401, 'TOKEN_EXPIRED'); expect(replaceSpy).not.toHaveBeenCalled();
});
it.each(['降岗', '强制改密', '停用', '注销', '令牌版本', '到期', '降岗且目标不存在'] as const)('Guard快照后%s，锁内重验先于目标404或版本409', async operation => {
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
  await error(await replace(operation === '降岗且目标不存在' ? randomUUID() : target.id, input({ expectedVersion: 99 })), operation.startsWith('降岗') || operation === '强制改密' ? 403 : 401, code);
  expect(replaceSpy).toHaveBeenCalledTimes(1); expect(await facts(target.id)).toEqual(before);
});

it('停用目标可授权和清空但仍停用，资格始终空；强制改密目标保留标志和永久权限', async () => {
  const disabled = await employee({ status: 'DISABLED' });
  await success(await replace(disabled.id), disabled.id, handover);
  await success(await replace(disabled.id, input({ permissions: [], expectedVersion: 1 })), disabled.id, [], 2, 2);
  expect((await facts(disabled.id)).employee.status).toBe('DISABLED');
  expect(eligibility.calls.map(call => [call.oldEffective, call.newEffective])).toEqual([[[], []], [[], []]]);
  const forced = await employee({ mustChangePassword: true }); const credential = await access(forced.id);
  const result = await success(await replace(forced.id), forced.id, handover);
  expect((await facts(forced.id)).employee.mustChangePassword).toBe(true);
  expect(eligibility.calls.at(-1)?.newEffective).toEqual(result.data.effectivePermissions);
  expect((await get('admin/me', credential)).status).toBe(200); await error(await get('admin/me/permissions', credential), 403, 'PASSWORD_CHANGE_REQUIRED');
});
it('已有授权缺依赖时安全500，既不自动修复也不先清空脏授权', async () => {
  const target = await employee(); await seedExtras(target.id, ['shipment.handover']); const before = await facts(target.id);
  await error(await replace(target.id, input({ permissions: [] })), 500, 'INTERNAL_ERROR'); expect(await facts(target.id)).toEqual(before);
});
it.each([['授予', '审计'], ['授予', '资格'], ['清空', '审计'], ['清空', '资格']] as const)('%s时%s写后故障完整回滚，旧会话保留，同版本可重试', async (operation, failure) => {
  const target = await employee(); const credential = await access(target.id); const clearing = operation === '清空';
  if (clearing) await seedExtras(target.id, full); const before = await facts(target.id); const resolved = clearing ? [] : handover;
  const body = input({ permissions: clearing ? [] : ['shipment.handover'] }); audit.fail = failure === '审计'; eligibility.fail = failure === '资格';
  await error(await replace(target.id, body), 500, 'INTERNAL_ERROR'); expect(audit.observedWrites).toBe(true); expect(await facts(target.id)).toEqual(before);
  if (failure === '资格') expect(eligibility.calls[0]).toMatchObject({ sameTransaction: true, insideExtras: resolved, outsideExtras: clearing ? full : [], insideAudits: 1 });
  else expect(eligibility.calls).toHaveLength(0);
  expect((await get('admin/me', credential)).status).toBe(200);
  audit.fail = false; eligibility.fail = false; await success(await replace(target.id, body), target.id, resolved); expect((await facts(target.id)).audits).toHaveLength(1);
});

it('两个管理员并发改同一目标同版本，实际等待后仅首请求成功且双版本只加一次', async () => {
  const other = await employee({ role: 'SUPER_ADMIN' }); const credential = await access(other.id); const target = await employee(); const gate = barrier(); let pid = 0;
  audit.afterWrite = async tx => { pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold; };
  const first = replace(target.id); let pending: Promise<Response> | undefined;
  try {
    await Promise.race([gate.ready, first.then(() => { throw new Error('未进入授权屏障'); })]);
    pending = replace(target.id, input({ permissions: ['dashboard.read'] }), credential); await waitForBlocker(pid); gate.release();
    await success(await first, target.id, handover); await error(await pending, 409, 'VERSION_CONFLICT');
    const after = await facts(target.id); expect(after.employee).toMatchObject({ version: 1, permissionVersion: 1 }); expect(after.audits).toHaveLength(1); expect(eligibility.calls).toHaveLength(1);
  } finally { gate.release(); await Promise.allSettled([first, ...(pending ? [pending] : [])]); }
});
it.each([true, false])('操作者ID在前=%s，先等待较小员工锁，未提前锁较大员工', async actorFirst => {
  const low = `1${randomUUID().slice(1)}`; const high = `f${randomUUID().slice(1)}`;
  const actor = await employee({ id: actorFirst ? low : high, role: 'SUPER_ADMIN' }); const credential = await access(actor.id);
  const target = await employee({ id: actorFirst ? high : low }); const gate = barrier(); let pid = 0;
  const blocker = peer.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM employee WHERE id=${low}::uuid FOR UPDATE`;
    pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold;
    await tx.$queryRaw`SELECT id FROM employee WHERE id=${high}::uuid FOR UPDATE NOWAIT`;
  }); let pending: Promise<Response> | undefined;
  try {
    await Promise.race([gate.ready, blocker.then(() => { throw new Error('未取得较小锁'); })]);
    pending = replace(target.id, input(), credential); await waitForBlocker(pid); gate.release(); await blocker; await success(await pending, target.id, handover);
  } finally { gate.release(); await Promise.allSettled([blocker, ...(pending ? [pending] : [])]); }
});
it('个人授权不改变管理员集合，稳定锁被占用时仍可提交', async () => {
  const target = await employee(); const gate = barrier();
  const blocker = peer.$transaction(async tx => { await tx.$queryRaw`SELECT key FROM system_guard WHERE key='ADMIN_AVAILABILITY' FOR UPDATE`; gate.signal(); await gate.hold; });
  try { await gate.ready; await success(await replace(target.id), target.id, handover); }
  finally { gate.release(); await blocker; }
});
it('等待目标锁后复核最新版本409，保留先提交资料及授权，无额外审计', async () => {
  const target = await employee(); await seedExtras(target.id, tracking); const gate = barrier(); let pid = 0;
  const blocker = peer.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM employee WHERE id=${target.id}::uuid FOR UPDATE`;
    await tx.employee.update({ where: { id: target.id }, data: { displayName: '先提交资料', version: { increment: 1 } } });
    pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold;
  }); let pending: Promise<Response> | undefined;
  try {
    await gate.ready; pending = replace(target.id); await waitForBlocker(pid); gate.release(); await blocker; await error(await pending, 409, 'VERSION_CONFLICT');
    const after = await facts(target.id); expect(after.employee).toMatchObject({ displayName: '先提交资料', version: 1, permissionVersion: 0 });
    expect(after.extras.map(p => p.permissionCode)).toEqual(tracking); expect(after.audits).toHaveLength(0);
  } finally { gate.release(); await Promise.allSettled([blocker, ...(pending ? [pending] : [])]); }
});
it.each([true, false])('正式调岗和授权争用同一目标（授权先=%s），按锁后岗位和版本裁决', async grantFirst => {
  const other = await employee({ role: 'SUPER_ADMIN' }); const credential = await access(other.id); const target = await employee(); const gate = barrier(); let pid = 0;
  audit.afterWrite = async (tx, payload) => {
    if (payload.action === (grantFirst ? 'employee.permission.replace' : 'employee.role.change')) {
      pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold;
    }
  };
  const first = grantFirst ? replace(target.id) : role(target.id, 'SUPER_ADMIN', 0, credential); let pending: Promise<Response> | undefined;
  try {
    await Promise.race([gate.ready, first.then(() => { throw new Error('未进入调岗授权屏障'); })]);
    pending = grantFirst ? role(target.id, 'MERCH_WAREHOUSE', 0, credential) : replace(target.id, input({ expectedVersion: 1 }));
    await waitForBlocker(pid); gate.release(); expect((await first).status).toBe(200);
    await error(await pending, grantFirst ? 409 : 400, grantFirst ? 'VERSION_CONFLICT' : 'EXTRA_PERMISSION_NOT_APPLICABLE');
    let after = await facts(target.id); expect(after.employee).toMatchObject({ role: grantFirst ? 'CUSTOMER_SERVICE' : 'SUPER_ADMIN', version: 1, permissionVersion: 1 });
    expect(after.extras.map(p => p.permissionCode)).toEqual(grantFirst ? handover : []); expect(after.audits).toHaveLength(1);
    if (grantFirst) { audit.afterWrite = undefined; expect((await role(target.id, 'MERCH_WAREHOUSE', 1, credential)).status).toBe(200); after = await facts(target.id); expect(after.extras).toEqual([]); }
  } finally { gate.release(); await Promise.allSettled([first, ...(pending ? [pending] : [])]); }
});
it.each([true, false])('真实降岗与操作者授权仲裁（授权先=%s），降岗后旧token即时403', async grantFirst => {
  const other = await employee({ role: 'SUPER_ADMIN' }); const credential = await access(other.id); const target = await employee(); const before = await facts(target.id);
  const gate = barrier(); let pid = 0;
  audit.afterWrite = async (tx, payload) => {
    if (payload.action === (grantFirst ? 'employee.permission.replace' : 'employee.role.change')) {
      pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold;
    }
  };
  const first = grantFirst ? replace(target.id) : role(actorId, 'MERCH_WAREHOUSE', 0, credential); let pending: Promise<Response> | undefined;
  try {
    await Promise.race([gate.ready, first.then(() => { throw new Error('未进入操作者仲裁屏障'); })]);
    pending = grantFirst ? role(actorId, 'MERCH_WAREHOUSE', 0, credential) : replace(target.id); await waitForBlocker(pid); gate.release(); expect((await first).status).toBe(200);
    if (grantFirst) { expect((await pending).status).toBe(200); expect((await facts(target.id)).extras.map(p => p.permissionCode)).toEqual(handover); }
    else { await error(await pending, 403, 'FORBIDDEN'); expect(await facts(target.id)).toEqual(before); }
    await error(await replace(target.id, input({ expectedVersion: grantFirst ? 1 : 0 })), 403, 'FORBIDDEN');
    expect((await get('admin/me')).status).toBe(200); expect((await get('admin/me/permissions')).status).toBe(200);
  } finally { gate.release(); await Promise.allSettled([first, ...(pending ? [pending] : [])]); }
});

it('编译API真实登录授权/无变化/撤权，旧token读取实时权限且会话不撤销', async () => {
  const target = await employee(); const actor = await prisma.employee.findUniqueOrThrow({ where: { id: actorId } });
  const source = String.raw`
    require('reflect-metadata');
    const {NestFactory}=require('@nestjs/core');const {AppModule}=require('./dist/app.module.js');const {configureApp}=require('./dist/common/configure-app.js');
    (async()=>{const app=await NestFactory.create(AppModule,{logger:false});try{configureApp(app);await app.listen(0,'127.0.0.1');const url=await app.getUrl();
      const login=async username=>{const r=await fetch(url+'/api/v1/admin/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:process.env.SHOP_TEST_PASSWORD})});return{status:r.status,body:await r.json()};};
      const actor=await login(process.env.SHOP_TEST_ACTOR);const target=await login(process.env.SHOP_TEST_USERNAME);
      const put=body=>fetch(url+'/api/v1/admin/employees/'+process.env.SHOP_TEST_TARGET+'/extra-permissions',{method:'PUT',headers:{'Content-Type':'application/json',Authorization:'Bearer '+actor.body.data.accessToken},body:JSON.stringify(body)});
      const get=path=>fetch(url+'/api/v1/'+path,{headers:{Authorization:'Bearer '+target.body.data.accessToken}});
      const input={permissions:['shipment.handover'],expectedVersion:0,reason:'编译后额外授权'};
      const invalid=await put({...input,status:'ACTIVE'});const forbidden=await put({...input,permissions:['employee.create']});const forbiddenBody=await forbidden.json();
      const grant=await put(input);const body=await grant.json();const granted=await get('admin/me/permissions');const grantedBody=await granted.json();
      const same=await put({...input,permissions:body.data.resolvedExtraPermissions,expectedVersion:1});const sameBody=await same.json();
      const clear=await put({...input,permissions:[],expectedVersion:1});const clearBody=await clear.json();const stale=await put({...input,permissions:[],expectedVersion:1});const conflict=await stale.json();
      const me=await get('admin/me');const permissions=await get('admin/me/permissions');const perms=(await permissions.json()).data;const denied=await get('admin/employees');
      console.log(JSON.stringify({actor:actor.status,login:target.status,invalid:invalid.status,forbidden:forbidden.status,forbiddenCode:forbiddenBody.code,
        grant:grant.status,fields:Object.keys(body.data??{}).sort(),extras:body.data?.resolvedExtraPermissions,granted:granted.status,hasHandover:grantedBody.data.effectivePermissions.includes('shipment.handover'),
        same:same.status,sameChanged:sameBody.data?.changed,clear:clear.status,version:clearBody.data?.version,permissionVersion:clearBody.data?.permissionVersion,
        stale:stale.status,code:conflict.code,me:me.status,permissions:permissions.status,effectiveCount:perms.effectivePermissions.length,hasCleared:!perms.effectivePermissions.includes('shipment.handover'),denied:denied.status}));
    }finally{await app.close();}})().catch(()=>{console.error('编译后个人额外权限验证失败');process.exitCode=1;});`;
  const child = spawnSync(process.execPath, ['-e', source], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true, timeout: 15_000,
    env: { ...process.env, DATABASE_URL: safe.testUrl, LOG_LEVEL: 'silent', SHOP_TEST_ACTOR: actor.username, SHOP_TEST_USERNAME: target.username, SHOP_TEST_PASSWORD: password, SHOP_TEST_TARGET: target.id } });
  expect(child.status).toBe(0); expect(JSON.parse(child.stdout.trim())).toEqual({ actor: 200, login: 200, invalid: 400, forbidden: 400, forbiddenCode: 'PERMISSION_NOT_GRANTABLE',
    grant: 200, fields: ['addedByDependency', 'changed', 'defaultPermissions', 'effectivePermissions', 'id', 'normalizedDefaultPermissions', 'permissionVersion', 'removedByDependency', 'resolvedExtraPermissions', 'version'],
    extras: handover, granted: 200, hasHandover: true, same: 200, sameChanged: false, clear: 200, version: 2, permissionVersion: 2, stale: 409, code: 'VERSION_CONFLICT', me: 200, permissions: 200, effectiveCount: 12, hasCleared: true, denied: 403 });
  const after = await facts(target.id); expect(after.sessions).toHaveLength(1); expect(after.sessions[0]?.revokedAt).toBeNull(); expect(after.audits).toHaveLength(2);
  for (const secret of [password, passwordHash]) expect(child.stdout + child.stderr).not.toContain(secret);
});
