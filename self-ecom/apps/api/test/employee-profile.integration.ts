// 作用：验证员工显示名修改的输入、版本、锁内授权和审计原子性。
import 'reflect-metadata';
import { randomInt, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import type { INestApplication } from '@nestjs/common';
import type { Prisma, SubjectType } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuditService, type AuditPayload } from '../src/audit/audit.service.js';
import { AuthSessionService } from '../src/auth/auth-session.service.js';
import { CurrentIdentityService, type CurrentIdentity } from '../src/auth/current-identity.service.js';
import { JwtTokenService } from '../src/auth/jwt-token.service.js';
import { PasswordService } from '../src/auth/password.service.js';
import { configureApp } from '../src/common/configure-app.js';
import { APP_CONFIG, loadConfiguration } from '../src/config/environment.js';
import { EmployeeProfileController } from '../src/employees/employee-profile.controller.js';
import { EmployeeProfileDto } from '../src/employees/employee-profile.dto.js';
import { EmployeeProfileService } from '../src/employees/employee-profile.service.js';
import { EmployeeIdParamsDto } from '../src/employees/employee-query.dto.js';
import { seedPermissionCatalog } from '../src/permissions/permission-seed.js';
import { PermissionService } from '../src/permissions/permission.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { assertSafeTestDatabase } from '../scripts/database-env.js';

assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('集成测试仅可在test环境执行');
// Vitest不生成参数元数据；编译API子进程另验真实tsc路径。
Reflect.defineMetadata('design:paramtypes', [EmployeeIdParamsDto, EmployeeProfileDto, Object, Object], EmployeeProfileController.prototype, 'update');
const password = 'EmployeeProfile#2026'; let passwordHash = '';
let millis = Date.parse('2026-11-12T01:00:00.500Z'); const clock = () => new Date(millis);
const tokens = new JwtTokenService({ secret: 'employee-profile-integration-only-'.repeat(3), ttlSeconds: 7200 }, clock);
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
  fail = false; observedWrites = false;
  afterWrite: ((tx: Prisma.TransactionClient, payload: AuditPayload) => Promise<void>) | undefined;
  override async appendAudit(tx: Prisma.TransactionClient, payload: AuditPayload) {
    await super.appendAudit(tx, payload); if (payload.action !== 'employee.profile.update') return;
    await this.afterWrite?.(tx, payload);
    if (!this.fail) return;
    const target = await tx.employee.findUniqueOrThrow({ where: { id: payload.targetId } });
    this.observedWrites = target.displayName === payload.after?.displayName
      && await tx.auditLog.count({ where: { requestId: payload.requestId } }) === 1;
    throw new Error('测试专用显示名审计故障');
  }
}
const identities = new ControlledIdentities(tokens, new PermissionService(), clock); const audit = new ControlledAudit();
let app: INestApplication; let prisma: PrismaService; let peer: PrismaService; let baseUrl = '';
let actorId = ''; let token = ''; let updateSpy: MockInstance<EmployeeProfileService['update']>;
const ids = new Set<string>(); const customerIds = new Set<string>();
beforeAll(async () => {
  passwordHash = await new PasswordService().hash(password);
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG).useValue(loadConfiguration({ ...process.env, LOG_LEVEL: 'silent' }))
    .overrideProvider(JwtTokenService).useValue(tokens).overrideProvider(AuthSessionService).useValue(sessions)
    .overrideProvider(CurrentIdentityService).useValue(identities).overrideProvider(AuditService).useValue(audit).compile();
  app = module.createNestApplication(); configureApp(app); await app.listen(0, '127.0.0.1');
  prisma = app.get(PrismaService); baseUrl = await app.getUrl(); peer = new PrismaService(loadConfiguration()); await peer.onModuleInit();
  await seedPermissionCatalog(prisma); updateSpy = vi.spyOn(app.get(EmployeeProfileService), 'update');
});
beforeEach(async () => {
  millis += 360_000; identities.afterGuard = undefined; audit.fail = false; audit.observedWrites = false; audit.afterWrite = undefined; updateSpy.mockClear();
  const actor = await employee({ role: 'SUPER_ADMIN' }); actorId = actor.id; token = await access(actor.id);
});
afterEach(async () => {
  identities.afterGuard = undefined; audit.fail = false; audit.afterWrite = undefined;
  await prisma.employeeExtraPermission.deleteMany({ where: { employeeId: { in: [...ids] } } });
  await prisma.auditLog.deleteMany({ where: { actorEmployeeId: { in: [...ids] } } });
  await prisma.authSession.deleteMany({ where: { OR: [{ employeeId: { in: [...ids] } }, { customerId: { in: [...customerIds] } }] } });
  await prisma.employee.deleteMany({ where: { id: { in: [...ids] } } });
  await prisma.customer.deleteMany({ where: { id: { in: [...customerIds] } } }); ids.clear(); customerIds.clear();
});
afterAll(async () => { updateSpy?.mockRestore(); await peer?.$disconnect(); await app?.close(); });
async function employee(input: Partial<Prisma.EmployeeUncheckedCreateInput> = {}) {
  const id = input.id ?? randomUUID(); ids.add(id);
  return prisma.employee.create({ data: { id, username: `ep_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
    displayName: '原显示名', role: 'CUSTOMER_SERVICE', passwordHash, mustChangePassword: false,
    createdAt: new Date('2026-01-01T00:00:00Z'), ...input } });
}
async function access(id: string) {
  return (await prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx, {
    subjectType: 'EMPLOYEE', subjectId: id, expectedPasswordHash: passwordHash, expectedTokenVersion: 0,
  }))).accessToken;
}
function input(patch: Partial<EmployeeProfileDto> = {}): EmployeeProfileDto {
  return { displayName: '修改后的显示名', expectedVersion: 0, reason: '修正显示名', ...patch };
}
async function update(id: string, body: unknown = input(), credential: string | null = token) {
  return fetch(`${baseUrl}/api/v1/admin/employees/${id}/profile`, { method: 'PATCH', headers: {
    'Content-Type': 'application/json', ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
    'X-Request-Id': 'private-input' }, body: JSON.stringify(body) });
}
async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  const body = await response.json() as { code: string; requestId: string; details?: { field: string }[] };
  expect(body.code).toBe(code); expect(body.requestId).toBe(response.headers.get('x-request-id'));
  for (const secret of [password, passwordHash, token, 'private-input']) expect(JSON.stringify(body)).not.toContain(secret);
  return body;
}
async function success(response: Response) {
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json() as { data: { id: string; displayName: string; version: number }; requestId: string };
  expect(Object.keys(body).sort()).toEqual(['data', 'requestId']); expect(body.requestId).toBe(response.headers.get('x-request-id'));
  expect(Object.keys(body.data).sort()).toEqual(['createdAt', 'displayName', 'id', 'lastLoginAt', 'mustChangePassword', 'role', 'status', 'username', 'version']);
  for (const secret of [password, passwordHash, token]) expect(JSON.stringify(body)).not.toContain(secret);
  return body;
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
  const deadline = performance.now() + 400;
  while (performance.now() < deadline) {
    const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(pid))) AS waiting`;
    if (row?.waiting) return; await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('未观察到员工显示名事务的实际锁等待');
}

it.each(['SUPER_ADMIN', 'MERCH_WAREHOUSE', 'CUSTOMER_SERVICE'] as const)('修改%s显示名仅改变显示名/version/更新时间，资料、会话和授权保留', async role => {
  const target = await employee({ role, version: 4, permissionVersion: 2 }); const targetToken = await access(target.id);
  if (role === 'CUSTOMER_SERVICE') await prisma.employeeExtraPermission.create({ data: {
    employeeId: target.id, permissionCode: 'order.fulfillment.read', grantedById: actorId } });
  const before = await facts(target.id); const actorBefore = await facts(actorId);
  const result = await success(await update(target.id.toUpperCase(), input({ displayName: '  晚班员工 😀  ', expectedVersion: 4, reason: '  更正显示名  ' })));
  expect(result.data).toMatchObject({ id: target.id, displayName: '晚班员工 😀', version: 5 });
  const after = await facts(target.id);
  expect(after.employee).toEqual({ ...before.employee, displayName: '晚班员工 😀', version: 5, updatedAt: after.employee.updatedAt });
  expect(after.sessions).toEqual(before.sessions); expect(after.extras).toEqual(before.extras); expect(await facts(actorId)).toEqual(actorBefore);
  expect(after.audits).toHaveLength(1); expect(after.audits[0]).toMatchObject({ actorType: 'EMPLOYEE', actorEmployeeId: actorId,
    actorCustomerId: null, action: 'employee.profile.update', reason: '更正显示名', requestId: result.requestId,
    beforeData: { displayName: '原显示名' }, afterData: { displayName: '晚班员工 😀' } });
  for (const secret of [password, passwordHash, token, targetToken]) expect(JSON.stringify(after.audits)).not.toContain(secret);
  expect((await fetch(`${baseUrl}/api/v1/admin/me`, { headers: { Authorization: `Bearer ${targetToken}` } })).status).toBe(200);
});

it('可修改停用员工及本人，旧本人token立即读到新显示名', async () => {
  const disabled = await employee({ status: 'DISABLED', mustChangePassword: true }); const before = await facts(disabled.id);
  await success(await update(disabled.id)); const after = await facts(disabled.id);
  expect(after.employee).toMatchObject({ status: 'DISABLED', mustChangePassword: true, tokenVersion: 0, permissionVersion: 0 });
  expect(after.sessions).toEqual(before.sessions);
  await success(await update(actorId));
  const me = await fetch(`${baseUrl}/api/v1/admin/me`, { headers: { Authorization: `Bearer ${token}` } }); expect(me.status).toBe(200);
  expect((await me.json() as { data: { displayName: string } }).data.displayName).toBe('修改后的显示名');
  expect(await prisma.authSession.count({ where: { employeeId: actorId, revokedAt: null } })).toBe(1);
});

it('同名且版本匹配不写入或审计，旧版本即使同名仍409', async () => {
  const target = await employee({ version: 3 }); const before = await facts(target.id);
  expect((await success(await update(target.id, input({ displayName: ' 原显示名 ', expectedVersion: 3 })))).data.version).toBe(3);
  expect(await facts(target.id)).toEqual(before);
  await error(await update(target.id, input({ displayName: '原显示名', expectedVersion: 2 })), 409, 'VERSION_CONFLICT');
  await error(await update(target.id, input({ expectedVersion: Number.MAX_SAFE_INTEGER })), 409, 'VERSION_CONFLICT');
  expect(await facts(target.id)).toEqual(before);
});

const invalidCases: [string, Record<string, unknown>][] = [
  ['空显示名', { displayName: ' ' }], ['超长显示名', { displayName: '😀'.repeat(41) }], ['错误显示名类型', { displayName: [] }],
  ['版本字符串', { expectedVersion: '0' }], ['版本布尔值', { expectedVersion: false }], ['版本为空', { expectedVersion: null }],
  ['负版本', { expectedVersion: -1 }], ['小数版本', { expectedVersion: 0.5 }], ['超安全整数版本', { expectedVersion: Number.MAX_SAFE_INTEGER + 1 }],
  ['空原因', { reason: '  ' }], ['超长原因', { reason: '原'.repeat(501) }], ['错误原因类型', { reason: 12 }],
  ['注入岗位', { role: 'SUPER_ADMIN' }], ['注入状态', { status: 'ACTIVE' }], ['注入账号', { username: 'private_input' }],
  ['注入密码', { password: 'private-input' }], ['注入临时密码', { temporaryPassword: 'private-input' }],
  ['注入哈希', { passwordHash: 'private-input' }], ['注入授权', { extraPermissions: ['employee.create'] }],
  ['注入版本', { version: 1 }], ['注入改密标志', { mustChangePassword: false }], ['注入目标', { id: randomUUID() }],
];
it.each(invalidCases)('%s返回400，服务与数据库事实保持不变', async (_name, patch) => {
  const target = await employee(); const before = await facts(target.id);
  const result = await error(await update(target.id, { ...input(), ...patch }), 400, 'VALIDATION_FAILED');
  expect(result.details?.length).toBeGreaterThan(0); expect(updateSpy).not.toHaveBeenCalled(); expect(await facts(target.id)).toEqual(before);
});
it.each(['displayName', 'expectedVersion', 'reason'] as const)('缺少%s返回400', async field => {
  const target = await employee(); const request: Partial<EmployeeProfileDto> = input(); delete request[field];
  await error(await update(target.id, request), 400, 'VALIDATION_FAILED'); expect(updateSpy).not.toHaveBeenCalled();
});
it('接受40个Unicode码点显示名及500字符原因，拒绝无效UUID，有权未知目标404', async () => {
  const target = await employee(); await success(await update(target.id, input({ displayName: '😀'.repeat(40), reason: '原'.repeat(500) })));
  updateSpy.mockClear(); await error(await update('not-a-uuid'), 400, 'VALIDATION_FAILED'); expect(updateSpy).not.toHaveBeenCalled();
  await error(await update(randomUUID()), 404, 'EMPLOYEE_NOT_FOUND'); expect(updateSpy).toHaveBeenCalledTimes(1);
});

it.each(['MERCH_WAREHOUSE', 'CUSTOMER_SERVICE'] as const)('%s存在/不存在/非法目标和注入请求均403，不探查目标', async role => {
  const actor = await employee({ role }); const credential = await access(actor.id); const target = await employee();
  for (const id of [target.id, randomUUID(), 'not-a-uuid']) {
    expect((await error(await update(id, { ...input(), role: 'SUPER_ADMIN' }, credential), 403, 'FORBIDDEN')).details).toBeUndefined();
  }
  expect(updateSpy).not.toHaveBeenCalled();
});
it('缺凭证、顾客域、强制改密、停用、撤销、到期均在入口拒绝', async () => {
  const target = await employee(); await error(await update(target.id, input(), null), 401, 'TOKEN_INVALID');
  const id = randomUUID(); customerIds.add(id);
  await prisma.customer.create({ data: { id, phone: `139${randomInt(100_000_000).toString().padStart(8, '0')}`,
    nickname: '员工显示名域夹具', passwordHash, createdAt: new Date('2026-01-01T00:00:00Z') } });
  const customer = await prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx, {
    subjectType: 'CUSTOMER', subjectId: id, expectedPasswordHash: passwordHash, expectedTokenVersion: 0,
  })); await error(await update(target.id, input(), customer.accessToken), 401, 'TOKEN_SUBJECT_MISMATCH');
  await prisma.employee.update({ where: { id: actorId }, data: { mustChangePassword: true } });
  await error(await update(target.id), 403, 'PASSWORD_CHANGE_REQUIRED');
  await prisma.employee.update({ where: { id: actorId }, data: { mustChangePassword: false, status: 'DISABLED' } });
  await error(await update(target.id), 401, 'ACCOUNT_UNAVAILABLE'); await prisma.employee.update({ where: { id: actorId }, data: { status: 'ACTIVE' } });
  const claims = await tokens.verify(token, 'EMPLOYEE');
  await prisma.$transaction(tx => sessions.revokeCurrent(tx, { subjectType: 'EMPLOYEE', subjectId: actorId }, claims.sid));
  await error(await update(target.id), 401, 'SESSION_REVOKED'); millis += 7_200_000; await error(await update(target.id), 401, 'TOKEN_EXPIRED');
  expect(updateSpy).not.toHaveBeenCalled();
});

it.each(['降岗', '强制改密', '停用', '注销', '版本变化', '到期', '降岗且目标不存在'] as const)('Guard快照后%s，锁内重验先于目标及版本错误', async operation => {
  const target = await employee(); const before = await facts(target.id); const claims = await tokens.verify(token, 'EMPLOYEE');
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
  await error(await update(operation === '降岗且目标不存在' ? randomUUID() : target.id, input({ expectedVersion: 99 })),
    operation.startsWith('降岗') || operation === '强制改密' ? 403 : 401, code);
  expect(updateSpy).toHaveBeenCalledTimes(1); expect(await facts(target.id)).toEqual(before);
});

it('审计写入后故障回滚显示名、version和审计，会话授权保持不变，解除故障可重试', async () => {
  const target = await employee(); await access(target.id); const before = await facts(target.id); audit.fail = true;
  await error(await update(target.id), 500, 'INTERNAL_ERROR'); expect(audit.observedWrites).toBe(true); expect(await facts(target.id)).toEqual(before);
  audit.fail = false; await success(await update(target.id)); expect((await facts(target.id)).audits).toHaveLength(1);
});

it('两个管理员同版本修改同一目标，实际等待后仅一次成功及一条审计', async () => {
  const target = await employee(); const other = await employee({ role: 'SUPER_ADMIN' }); const credential = await access(other.id);
  const gate = barrier(); let pid = 0;
  audit.afterWrite = async tx => { pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold; };
  const first = update(target.id); let second: Promise<Response> | undefined;
  try {
    await Promise.race([gate.ready, first.then(() => { throw new Error('显示名未进入审计屏障'); })]);
    second = update(target.id, input({ displayName: '第二个修改' }), credential); await waitForBlocker(pid); gate.release();
    await success(await first); await error(await second, 409, 'VERSION_CONFLICT');
    const after = await facts(target.id); expect(after.employee).toMatchObject({ displayName: '修改后的显示名', version: 1 }); expect(after.audits).toHaveLength(1);
  } finally { gate.release(); await Promise.allSettled([first, ...(second ? [second] : [])]); }
});

it.each([true, false])('操作者ID在前=%s，先等待较小ID且未提前占据较大ID', async actorFirst => {
  const low = `1${randomUUID().slice(1)}`; const high = `f${randomUUID().slice(1)}`;
  const actor = await employee({ id: actorFirst ? low : high, role: 'SUPER_ADMIN' }); const credential = await access(actor.id);
  const target = await employee({ id: actorFirst ? high : low }); const gate = barrier(); let pid = 0;
  const blocker = peer.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM employee WHERE id=${low}::uuid FOR UPDATE`;
    pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold;
    // 若实现按角色顺序锁较大ID后等待较小ID，这里NOWAIT会失败。
    await tx.$queryRaw`SELECT id FROM employee WHERE id=${high}::uuid FOR UPDATE NOWAIT`;
  });
  let pending: Promise<Response> | undefined;
  try {
    await Promise.race([gate.ready, blocker.then(() => { throw new Error('未取得较小员工行锁'); })]);
    pending = update(target.id, input(), credential); await waitForBlocker(pid); gate.release(); await blocker; await success(await pending);
  } finally { gate.release(); await Promise.allSettled([blocker, ...(pending ? [pending] : [])]); }
});

it('两个管理员互改显示名，遵循同一锁序等待后均成功，不形成相反锁序死锁', async () => {
  const other = await employee({ role: 'SUPER_ADMIN' }); const credential = await access(other.id); const gate = barrier(); let pid = 0; let count = 0;
  audit.afterWrite = async tx => { if (++count === 1) { pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold; } };
  const first = update(other.id); let second: Promise<Response> | undefined;
  try {
    await Promise.race([gate.ready, first.then(() => { throw new Error('互改未进入审计屏障'); })]);
    second = update(actorId, input({ displayName: '另一位管理员' }), credential); await waitForBlocker(pid); gate.release();
    await success(await first); await success(await second); expect((await facts(actorId)).employee.version).toBe(1); expect((await facts(other.id)).employee.version).toBe(1);
  } finally { gate.release(); await Promise.allSettled([first, ...(second ? [second] : [])]); }
});

it('锁后读取当前版本，先提交的目标修改使旧版本409', async () => {
  const target = await employee(); const gate = barrier(); let pid = 0;
  const blocker = peer.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM employee WHERE id=${target.id}::uuid FOR UPDATE`;
    await tx.employee.update({ where: { id: target.id }, data: { displayName: '先提交的显示名', version: { increment: 1 } } });
    pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold;
  });
  let pending: Promise<Response> | undefined;
  try {
    await Promise.race([gate.ready, blocker.then(() => { throw new Error('目标未进入锁屏障'); })]);
    pending = update(target.id); await waitForBlocker(pid); gate.release(); await blocker; await error(await pending, 409, 'VERSION_CONFLICT');
    const after = await facts(target.id); expect(after.employee).toMatchObject({ displayName: '先提交的显示名', version: 1 }); expect(after.audits).toHaveLength(0);
  } finally { gate.release(); await Promise.allSettled([blocker, ...(pending ? [pending] : [])]); }
});

it('编译API真实登录修改200、同名无变更200、过期版本409，非法字段/UUID400及未知目标404', async () => {
  const target = await employee(); const actor = await prisma.employee.findUniqueOrThrow({ where: { id: actorId } });
  const source = String.raw`
    require('reflect-metadata');
    const { NestFactory } = require('@nestjs/core'); const { AppModule } = require('./dist/app.module.js');
    const { configureApp } = require('./dist/common/configure-app.js');
    (async () => { const app = await NestFactory.create(AppModule, { logger: false });
      try { configureApp(app); await app.listen(0, '127.0.0.1'); const url = await app.getUrl();
        const login = await fetch(url + '/api/v1/admin/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: process.env.SHOP_TEST_ACTOR, password: process.env.SHOP_TEST_PASSWORD }) });
        const token = (await login.json()).data.accessToken; const input = { displayName: '编译后更新', expectedVersion: 0, reason: '验证修改' };
        const patch = (id, body) => fetch(url + '/api/v1/admin/employees/' + id + '/profile', { method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
        const id = process.env.SHOP_TEST_TARGET; const extra = await patch(id, { ...input, role: 'SUPER_ADMIN' });
        const invalid = await patch('not-a-uuid', input); const response = await patch(id, input); const body = await response.json();
        const stale = await patch(id, input); const conflict = await stale.json();
        const same = await patch(id, { ...input, expectedVersion: 1 }); const sameBody = await same.json();
        const missing = await patch(process.env.SHOP_TEST_ABSENT, input); const absent = await missing.json();
        console.log(JSON.stringify({ login: login.status, extra: extra.status, invalid: invalid.status, updated: response.status,
          fields: Object.keys(body.data ?? {}).sort(), version: body.data?.version, stale: stale.status, code: conflict.code,
          same: same.status, sameVersion: sameBody.data?.version, missing: missing.status, missingCode: absent.code }));
      } finally { await app.close(); }
    })().catch(() => { console.error('编译后显示名修改验证失败'); process.exitCode=1; });`;
  const child = spawnSync(process.execPath, ['-e', source], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true, timeout: 15_000,
    env: { ...process.env, LOG_LEVEL: 'silent', SHOP_TEST_ACTOR: actor.username, SHOP_TEST_PASSWORD: password,
      SHOP_TEST_TARGET: target.id, SHOP_TEST_ABSENT: randomUUID() } });
  expect(child.status).toBe(0); expect(JSON.parse(child.stdout.trim())).toEqual({ login: 200, extra: 400, invalid: 400, updated: 200,
    fields: ['createdAt', 'displayName', 'id', 'lastLoginAt', 'mustChangePassword', 'role', 'status', 'username', 'version'],
    version: 1, stale: 409, code: 'VERSION_CONFLICT', same: 200, sameVersion: 1, missing: 404, missingCode: 'EMPLOYEE_NOT_FOUND' });
  expect((await facts(target.id)).audits).toHaveLength(1); for (const secret of [password, passwordHash]) expect(child.stdout + child.stderr).not.toContain(secret);
});
