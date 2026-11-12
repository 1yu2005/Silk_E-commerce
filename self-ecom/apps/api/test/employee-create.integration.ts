// 作用：验证员工创建的唯一约束、管理员并发保护、锁内授权及审计回滚。
import 'reflect-metadata';
import { randomInt, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import type { INestApplication } from '@nestjs/common';
import type { EmployeeRole, Prisma } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuditService, type AuditPayload } from '../src/audit/audit.service.js';
import { AuthSessionService } from '../src/auth/auth-session.service.js';
import { CurrentIdentityService } from '../src/auth/current-identity.service.js';
import { EmployeeAuthController } from '../src/auth/employee-auth.controller.js';
import { EmployeeLoginDto } from '../src/auth/employee-login.dto.js';
import { ChangePasswordDto } from '../src/auth/change-password.dto.js';
import { JwtTokenService } from '../src/auth/jwt-token.service.js';
import { PasswordService } from '../src/auth/password.service.js';
import { configureApp } from '../src/common/configure-app.js';
import { APP_CONFIG, loadConfiguration } from '../src/config/environment.js';
import { EmployeeCreateController } from '../src/employees/employee-create.controller.js';
import { EmployeeCreateDto } from '../src/employees/employee-create.dto.js';
import { EmployeeCreateService } from '../src/employees/employee-create.service.js';
import { PermissionService } from '../src/permissions/permission.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { assertSafeTestDatabase } from '../scripts/database-env.js';

assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('集成测试仅可在test环境执行');
// Vitest不生成参数元数据；独立编译API子进程另行验证真实tsc参数路径。
Reflect.defineMetadata('design:paramtypes', [EmployeeCreateDto, Object, Object], EmployeeCreateController.prototype, 'create');
Reflect.defineMetadata('design:paramtypes', [EmployeeLoginDto, Object], EmployeeAuthController.prototype, 'login');
Reflect.defineMetadata('design:paramtypes', [ChangePasswordDto, Object, Object], EmployeeAuthController.prototype, 'changePassword');
const adminPassword = 'CreateAdmin#2026'; const initialPassword = ' InitialEmployee#2026 ';
const newPassword = 'NewCreatedEmployee#2026'; let adminHash = '';
let millis = Date.parse('2026-11-12T01:00:00.500Z'); const clock = () => new Date(millis);
const tokens = new JwtTokenService({ secret: 'employee-create-integration-only-'.repeat(3), ttlSeconds: 7200 }, clock);
const sessions = new AuthSessionService(tokens, clock);
class ControlledPasswords extends PasswordService {
  hashes = 0; afterHash: (() => Promise<void>) | undefined;
  override async hash(value: string) { this.hashes++; const result = await super.hash(value); await this.afterHash?.(); return result; }
}
class ControlledAudit extends AuditService {
  fail = false; observedWrites = false;
  afterWrite: ((tx: Prisma.TransactionClient, payload: AuditPayload) => Promise<void>) | undefined;
  override async appendAudit(tx: Prisma.TransactionClient, payload: AuditPayload) {
    await super.appendAudit(tx, payload);
    if (payload.action !== 'employee.create') return;
    ids.add(payload.targetId); await this.afterWrite?.(tx, payload);
    if (!this.fail) return;
    this.observedWrites = await tx.employee.count({ where: { id: payload.targetId } }) === 1
      && await tx.auditLog.count({ where: { requestId: payload.requestId } }) === 1;
    throw new Error('测试专用员工创建审计故障');
  }
}
const passwords = new ControlledPasswords(); const audit = new ControlledAudit();
let app: INestApplication; let prisma: PrismaService; let peer: PrismaService; let baseUrl = '';
let actorId = ''; let token = ''; let createSpy: MockInstance<EmployeeCreateService['create']>;
const ids = new Set<string>(); const customerIds = new Set<string>(); const usernames = new Set<string>();
beforeAll(async () => {
  adminHash = await new PasswordService().hash(adminPassword);
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG).useValue(loadConfiguration({ ...process.env, LOG_LEVEL: 'silent' }))
    .overrideProvider(JwtTokenService).useValue(tokens).overrideProvider(AuthSessionService).useValue(sessions)
    .overrideProvider(CurrentIdentityService).useValue(new CurrentIdentityService(tokens, new PermissionService(), clock))
    .overrideProvider(PasswordService).useValue(passwords).overrideProvider(AuditService).useValue(audit).compile();
  app = module.createNestApplication(); configureApp(app); await app.listen(0, '127.0.0.1');
  prisma = app.get(PrismaService); baseUrl = await app.getUrl(); peer = new PrismaService(loadConfiguration()); await peer.onModuleInit();
  createSpy = vi.spyOn(app.get(EmployeeCreateService), 'create');
});
beforeEach(async () => {
  millis += 360_000; passwords.hashes = 0; passwords.afterHash = undefined;
  audit.fail = false; audit.observedWrites = false; audit.afterWrite = undefined; createSpy.mockClear();
  const actor = await employee(); actorId = actor.id; token = await access(actor.id);
});
afterEach(async () => {
  passwords.afterHash = undefined; audit.fail = false; audit.afterWrite = undefined;
  // 子进程创建的ID可能尚未返回；仅按本测试生成的随机账号补充自有清理集合。
  for (const row of await prisma.employee.findMany({ where: { username: { in: [...usernames] } }, select: { id: true } })) ids.add(row.id);
  await prisma.employeeExtraPermission.deleteMany({ where: { employeeId: { in: [...ids] } } });
  await prisma.auditLog.deleteMany({ where: { actorEmployeeId: { in: [...ids] } } });
  await prisma.authSession.deleteMany({ where: { OR: [{ employeeId: { in: [...ids] } }, { customerId: { in: [...customerIds] } }] } });
  await prisma.employee.deleteMany({ where: { id: { in: [...ids] } } });
  await prisma.customer.deleteMany({ where: { id: { in: [...customerIds] } } }); ids.clear(); customerIds.clear(); usernames.clear();
});
afterAll(async () => { createSpy?.mockRestore(); await peer?.$disconnect(); await app?.close(); });
async function employee(role: EmployeeRole = 'SUPER_ADMIN') {
  const id = randomUUID(); ids.add(id);
  return prisma.employee.create({ data: { id, username: `c_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
    displayName: '创建员工测试操作者', role, mustChangePassword: false, passwordHash: adminHash, createdAt: new Date('2026-01-01T00:00:00Z') } });
}
async function access(id: string) {
  return (await prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx, {
    subjectType: 'EMPLOYEE', subjectId: id, expectedPasswordHash: adminHash, expectedTokenVersion: 0,
  }))).accessToken;
}
function input(patch: Partial<EmployeeCreateDto> = {}): EmployeeCreateDto {
  const username = `new_${randomUUID().replaceAll('-', '').slice(0, 20)}`; usernames.add(username);
  return { username, displayName: '新客服员工', role: 'CUSTOMER_SERVICE', initialPassword, reason: '新增员工测试', ...patch };
}
async function create(body: unknown, credential: string | null = token) {
  return fetch(`${baseUrl}/api/v1/admin/employees`, { method: 'POST', headers: { 'Content-Type': 'application/json',
    ...(credential ? { Authorization: `Bearer ${credential}` } : {}), 'X-Request-Id': 'private-input' }, body: JSON.stringify(body) });
}
async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  const body = await response.json() as { code: string; requestId: string; details?: { field: string }[] };
  expect(body.code).toBe(code); expect(body.requestId).toBe(response.headers.get('x-request-id'));
  for (const secret of [adminPassword, initialPassword, newPassword, adminHash, token, 'private-input']) expect(JSON.stringify(body)).not.toContain(secret);
  return body;
}
async function created(response: Response) {
  expect(response.status).toBe(201); expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json() as { data: { id: string; username: string; displayName: string; role: EmployeeRole;
    status: string; mustChangePassword: boolean; version: number; createdAt: string; lastLoginAt: string | null }; requestId: string };
  expect(Object.keys(body).sort()).toEqual(['data', 'requestId']); expect(body.requestId).toBe(response.headers.get('x-request-id'));
  expect(Object.keys(body.data).sort()).toEqual(['createdAt', 'displayName', 'id', 'lastLoginAt', 'mustChangePassword', 'role', 'status', 'username', 'version']);
  expect(body.data).toMatchObject({ status: 'ACTIVE', mustChangePassword: true, version: 0, lastLoginAt: null }); ids.add(body.data.id);
  for (const secret of [adminPassword, initialPassword, adminHash, token]) expect(JSON.stringify(body)).not.toContain(secret);
  return body;
}
async function waitForBlocker(pid: number) {
  const deadline = performance.now() + 550;
  while (performance.now() < deadline) {
    const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(pid))) AS waiting`;
    if (row?.waiting) return; await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('未观察到员工创建并发事务的实际锁等待');
}
function barrier() {
  let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
  let signal!: () => void; const ready = new Promise<void>(resolve => { signal = resolve; }); return { hold, release, ready, signal };
}

it.each(['SUPER_ADMIN', 'MERCH_WAREHOUSE', 'CUSTOMER_SERVICE'] as const)('管理员创建%s，规范化资料、真实bcrypt及原子审计，不创建额外授权或会话', async role => {
  const request = input({ role, displayName: '  新员工 😀  ', reason: '  新增员工  ' });
  const actorBefore = await prisma.employee.findUniqueOrThrow({ where: { id: actorId } });
  const result = await created(await create({ ...request, username: `  ${request.username.toUpperCase()}  ` }));
  expect(result.data).toMatchObject({ username: request.username, displayName: '新员工 😀', role });
  const stored = await prisma.employee.findUniqueOrThrow({ where: { id: result.data.id } });
  expect(stored).toMatchObject({ tokenVersion: 0, permissionVersion: 0, version: 0 });
  expect(stored.passwordHash).toMatch(/^\$2[ab]\$12\$/); expect(await new PasswordService().verify(initialPassword, stored.passwordHash)).toBe(true);
  expect(await new PasswordService().verify(initialPassword.trim(), stored.passwordHash)).toBe(false);
  expect(await prisma.authSession.count({ where: { employeeId: stored.id } })).toBe(0);
  expect(await prisma.employeeExtraPermission.count({ where: { employeeId: stored.id } })).toBe(0);
  const logs = await prisma.auditLog.findMany({ where: { targetType: 'Employee', targetId: stored.id } });
  expect(logs).toHaveLength(1); expect(logs[0]).toMatchObject({ actorType: 'EMPLOYEE', actorEmployeeId: actorId, actorCustomerId: null,
    action: 'employee.create', reason: '新增员工', requestId: result.requestId, beforeData: null,
    afterData: { username: stored.username, displayName: '新员工 😀', role, status: 'ACTIVE', mustChangePassword: true } });
  for (const secret of [initialPassword, stored.passwordHash, adminHash, token]) expect(JSON.stringify(logs)).not.toContain(secret);
  expect(await prisma.employee.findUniqueOrThrow({ where: { id: actorId } })).toEqual(actorBefore);
});

const invalidCases: [string, Record<string, unknown>][] = [
  ['账号过短', { username: 'abc' }], ['账号过长', { username: 'a'.repeat(33) }], ['账号错误字符', { username: 'bad-name' }],
  ['账号非字母开头', { username: '1234' }], ['账号非字符串', { username: 1234 }],
  ['显示名空白', { displayName: '  ' }], ['显示名超长', { displayName: '😀'.repeat(41) }], ['显示名非字符串', { displayName: [] }],
  ['岗位未知', { role: 'UNKNOWN' }], ['岗位为空', { role: null }],
  ['密码过短', { initialPassword: 'a'.repeat(7) }], ['密码超码点', { initialPassword: 'a'.repeat(65) }],
  ['密码超字节', { initialPassword: '中'.repeat(25) }], ['密码非字符串', { initialPassword: 12345678 }],
  ['原因空白', { reason: '   ' }], ['原因超长', { reason: '原'.repeat(501) }], ['原因非字符串', { reason: [] }],
  ['注入状态', { status: 'DISABLED' }], ['注入授权', { extraPermissions: ['employee.create'] }], ['注入版本', { version: 99 }],
  ['注入ID', { id: randomUUID() }], ['注入哈希', { passwordHash: 'private-input' }], ['关闭强制改密', { mustChangePassword: false }],
];
it.each(invalidCases)('%s返回400且不进入创建服务或bcrypt', async (_name, patch) => {
  const request = { ...input(), ...patch }; const result = await error(await create(request), 400, 'VALIDATION_FAILED');
  expect(result.details?.length).toBeGreaterThan(0); expect(createSpy).not.toHaveBeenCalled(); expect(passwords.hashes).toBe(0);
  expect(await prisma.auditLog.count({ where: { actorEmployeeId: actorId } })).toBe(0);
});
it.each(['username', 'displayName', 'role', 'initialPassword', 'reason'] as const)('缺少%s返回400', async field => {
  const request: Partial<EmployeeCreateDto> = input(); delete request[field];
  await error(await create(request), 400, 'VALIDATION_FAILED'); expect(createSpy).not.toHaveBeenCalled(); expect(passwords.hashes).toBe(0);
});

it('字符边界按Unicode码点，接受40字显示名、500字原因及64字/72字节密码', async () => {
  const request = input({ displayName: '😀'.repeat(40), reason: '原'.repeat(500), initialPassword: 'a'.repeat(64) });
  const first = await created(await create(request));
  expect(first.data.displayName).toBe(request.displayName);
  expect(await new PasswordService().verify(request.initialPassword, (await prisma.employee.findUniqueOrThrow({ where: { id: first.data.id } })).passwordHash)).toBe(true);
  const second = await created(await create(input({ initialPassword: '中'.repeat(24) })));
  expect(await new PasswordService().verify('中'.repeat(24), (await prisma.employee.findUniqueOrThrow({ where: { id: second.data.id } })).passwordHash)).toBe(true);
});

it('规范化后的重复账号409，不覆盖原员工且不重复审计', async () => {
  const request = input(); const first = await created(await create(request));
  const before = await prisma.employee.findUniqueOrThrow({ where: { id: first.data.id } });
  const result = await error(await create({ ...request, username: ` ${request.username.toUpperCase()} `, role: 'SUPER_ADMIN', displayName: '不可覆盖' }), 409, 'USERNAME_EXISTS');
  expect(result.details).toBeUndefined(); expect(await prisma.employee.findUniqueOrThrow({ where: { id: first.data.id } })).toEqual(before);
  expect(await prisma.auditLog.count({ where: { targetId: first.data.id } })).toBe(1);
});

it.each(['MERCH_WAREHOUSE', 'CUSTOMER_SERVICE'] as const)('%s即使自报管理员或非法字段也403，未进入服务或bcrypt', async role => {
  const actor = await employee(role); const credential = await access(actor.id);
  await error(await create({ ...input({ role: 'SUPER_ADMIN' }), status: 'ACTIVE', permissions: ['employee.create'] }, credential), 403, 'FORBIDDEN');
  expect(createSpy).not.toHaveBeenCalled(); expect(passwords.hashes).toBe(0);
});

it('缺凭证、顾客域、强制改密、停用、撤销和过期在入口拒绝，不执行创建', async () => {
  const request = input(); await error(await create(request, null), 401, 'TOKEN_INVALID');
  const id = randomUUID(); customerIds.add(id);
  await prisma.customer.create({ data: { id, phone: `139${randomInt(100_000_000).toString().padStart(8, '0')}`,
    nickname: '创建员工域隔离夹具', passwordHash: adminHash, createdAt: new Date('2026-01-01T00:00:00Z') } });
  const customer = await prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx, {
    subjectType: 'CUSTOMER', subjectId: id, expectedPasswordHash: adminHash, expectedTokenVersion: 0,
  })); await error(await create(request, customer.accessToken), 401, 'TOKEN_SUBJECT_MISMATCH');
  await prisma.employee.update({ where: { id: actorId }, data: { mustChangePassword: true } });
  await error(await create(request), 403, 'PASSWORD_CHANGE_REQUIRED');
  await prisma.employee.update({ where: { id: actorId }, data: { mustChangePassword: false, status: 'DISABLED' } });
  await error(await create(request), 401, 'ACCOUNT_UNAVAILABLE');
  await prisma.employee.update({ where: { id: actorId }, data: { status: 'ACTIVE' } });
  const claims = await tokens.verify(token, 'EMPLOYEE');
  await prisma.$transaction(tx => sessions.revokeCurrent(tx, { subjectType: 'EMPLOYEE', subjectId: actorId }, claims.sid));
  await error(await create(request), 401, 'SESSION_REVOKED'); millis += 7_200_000;
  await error(await create(request), 401, 'TOKEN_EXPIRED'); expect(createSpy).not.toHaveBeenCalled(); expect(passwords.hashes).toBe(0);
});

it('审计写入后故障将新员工与审计一起回滚，解除故障可创建', async () => {
  const request = input(); audit.fail = true;
  await error(await create(request), 500, 'INTERNAL_ERROR'); expect(audit.observedWrites).toBe(true);
  expect(await prisma.employee.count({ where: { username: request.username } })).toBe(0);
  expect(await prisma.auditLog.count({ where: { actorEmployeeId: actorId } })).toBe(0);
  audit.fail = false; await created(await create(request)); expect(await prisma.auditLog.count({ where: { actorEmployeeId: actorId } })).toBe(1);
});

it.each(['降岗', '强制改密', '停用', '注销', '版本变化', '到期'] as const)('bcrypt后操作者%s，锁内重验拒绝且无新员工或审计', async operation => {
  const request = input(); const claims = await tokens.verify(token, 'EMPLOYEE');
  passwords.afterHash = async () => {
    await peer.$transaction(async tx => {
      await tx.$queryRaw`SELECT key FROM system_guard WHERE key='ADMIN_AVAILABILITY' FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM employee WHERE id=${actorId}::uuid FOR UPDATE`;
      if (operation === '降岗') await tx.employee.update({ where: { id: actorId }, data: { role: 'CUSTOMER_SERVICE', permissionVersion: { increment: 1 }, version: { increment: 1 } } });
      if (operation === '强制改密') await tx.employee.update({ where: { id: actorId }, data: { mustChangePassword: true } });
      if (operation === '停用') await tx.employee.update({ where: { id: actorId }, data: { status: 'DISABLED' } });
      if (operation === '注销') await sessions.revokeCurrent(tx, { subjectType: 'EMPLOYEE', subjectId: actorId }, claims.sid);
      if (operation === '版本变化') await tx.employee.update({ where: { id: actorId }, data: { tokenVersion: { increment: 1 } } });
    });
    if (operation === '到期') millis += 7_200_000;
  };
  const code = { 降岗: 'FORBIDDEN', 强制改密: 'PASSWORD_CHANGE_REQUIRED', 停用: 'ACCOUNT_UNAVAILABLE',
    注销: 'SESSION_REVOKED', 版本变化: 'TOKEN_INVALID', 到期: 'TOKEN_EXPIRED' }[operation];
  await error(await create(request), operation === '降岗' || operation === '强制改密' ? 403 : 401, code);
  expect(createSpy).toHaveBeenCalledTimes(1); expect(passwords.hashes).toBe(1);
  expect(await prisma.employee.count({ where: { username: request.username } })).toBe(0);
  expect(await prisma.auditLog.count({ where: { actorEmployeeId: actorId } })).toBe(0);
});

it('两个管理员并发创建同一账号，实际等待唯一约束，仅201/409和一条员工/审计', async () => {
  const secondActor = await employee(); const secondToken = await access(secondActor.id); const request = input();
  const gate = barrier(); let pid = 0; let writes = 0;
  audit.afterWrite = async tx => { if (++writes === 1) { pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold; } };
  const first = create(request); let second: Promise<Response> | undefined;
  try {
    await Promise.race([gate.ready, first.then(() => { throw new Error('创建未进入审计屏障'); })]);
    second = create(request, secondToken); await waitForBlocker(pid); gate.release();
    const successful = await created(await first); await error(await second, 409, 'USERNAME_EXISTS');
    expect(await prisma.employee.count({ where: { username: request.username } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { targetId: successful.data.id } })).toBe(1);
  } finally { gate.release(); await Promise.allSettled([first, ...(second ? [second] : [])]); }
});

it('创建先持操作者锁，降岗实际等待，创建提交后降岗不撤销历史事实', async () => {
  const request = input(); const gate = barrier(); let pid = 0;
  audit.afterWrite = async tx => { pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold; };
  const first = create(request); let downgrade: Promise<unknown> | undefined;
  try {
    await Promise.race([gate.ready, first.then(() => { throw new Error('创建未进入审计屏障'); })]);
    downgrade = peer.$transaction(async tx => {
      await tx.$queryRaw`SELECT key FROM system_guard WHERE key='ADMIN_AVAILABILITY' FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM employee WHERE id=${actorId}::uuid FOR UPDATE`;
      await tx.employee.update({ where: { id: actorId }, data: { role: 'CUSTOMER_SERVICE', permissionVersion: { increment: 1 }, version: { increment: 1 } } });
    });
    await waitForBlocker(pid); gate.release(); const result = await created(await first); await downgrade;
    expect(await prisma.employee.count({ where: { id: result.data.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { targetId: result.data.id, action: 'employee.create' } })).toBe(1);
    await error(await create(input()), 403, 'FORBIDDEN');
  } finally { gate.release(); await Promise.allSettled([first, ...(downgrade ? [downgrade] : [])]); }
});

it('降岗事务先持锁，创建实际等待提交后按最新权限403', async () => {
  const request = input(); const gate = barrier(); let pid = 0;
  const downgrade = peer.$transaction(async tx => {
    await tx.$queryRaw`SELECT key FROM system_guard WHERE key='ADMIN_AVAILABILITY' FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM employee WHERE id=${actorId}::uuid FOR UPDATE`;
    pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
    await tx.employee.update({ where: { id: actorId }, data: { role: 'CUSTOMER_SERVICE', permissionVersion: { increment: 1 }, version: { increment: 1 } } });
    gate.signal(); await gate.hold;
  });
  let pending: Promise<Response> | undefined;
  try {
    await Promise.race([gate.ready, downgrade.then(() => { throw new Error('降岗未进入锁屏障'); })]);
    pending = create(request); await waitForBlocker(pid); gate.release(); await downgrade; await error(await pending, 403, 'FORBIDDEN');
    expect(createSpy).toHaveBeenCalledTimes(1); expect(await prisma.employee.count({ where: { username: request.username } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { actorEmployeeId: actorId } })).toBe(0);
  } finally { gate.release(); await Promise.allSettled([downgrade, ...(pending ? [pending] : [])]); }
});

it('创建管理员先等待稳定锁，此时操作者员工行尚未被创建命令锁住', async () => {
  const request = input({ role: 'SUPER_ADMIN' }); const gate = barrier(); let pid = 0;
  const blocker = peer.$transaction(async tx => {
    await tx.$queryRaw`SELECT key FROM system_guard WHERE key='ADMIN_AVAILABILITY' FOR UPDATE`;
    pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; gate.signal(); await gate.hold;
    // 若创建命令先持有员工锁再等待稳定锁，这里NOWAIT会失败或形成死锁。
    await tx.$queryRaw`SELECT id FROM employee WHERE id=${actorId}::uuid FOR UPDATE NOWAIT`;
  });
  let pending: Promise<Response> | undefined;
  try {
    await Promise.race([gate.ready, blocker.then(() => { throw new Error('未进入稳定锁屏障'); })]);
    pending = create(request); await waitForBlocker(pid); gate.release(); await blocker; await created(await pending);
  } finally { gate.release(); await Promise.allSettled([blocker, ...(pending ? [pending] : [])]); }
});

it('新员工首次真实登录受强制改密限制，改密重登后可查本人权限', async () => {
  const request = input(); const result = await created(await create(request));
  const login = async (password: string) => fetch(`${baseUrl}/api/v1/admin/auth/login`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: request.username, password }) });
  const first = await login(initialPassword); expect(first.status).toBe(200);
  const issued = (await first.json() as { data: { accessToken: string; mustChangePassword: boolean } }).data;
  expect(issued.mustChangePassword).toBe(true);
  await error(await create(input(), issued.accessToken), 403, 'PASSWORD_CHANGE_REQUIRED');
  const change = await fetch(`${baseUrl}/api/v1/admin/auth/change-password`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${issued.accessToken}` }, body: JSON.stringify({ oldPassword: initialPassword, newPassword }) });
  expect(change.status).toBe(200); await error(await login(initialPassword), 401, 'INVALID_CREDENTIALS');
  const fresh = await login(newPassword); expect(fresh.status).toBe(200);
  const credential = (await fresh.json() as { data: { accessToken: string; mustChangePassword: boolean } }).data;
  expect(credential.mustChangePassword).toBe(false);
  const permissions = await fetch(`${baseUrl}/api/v1/admin/me/permissions`, { headers: { Authorization: `Bearer ${credential.accessToken}` } });
  expect(permissions.status).toBe(200);
  expect((await permissions.json() as { data: { defaultPermissions: string[] } }).data.defaultPermissions).toHaveLength(12);
  expect((await prisma.employee.findUniqueOrThrow({ where: { id: result.data.id } })).version).toBe(1);
});

it('编译API真实登录后创建员工201，额外字段400，重复账号409且字段安全', async () => {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { id: actorId } }); const request = input();
  const source = String.raw`
    require('reflect-metadata');
    const { NestFactory } = require('@nestjs/core'); const { AppModule } = require('./dist/app.module.js');
    const { configureApp } = require('./dist/common/configure-app.js');
    (async () => { const app = await NestFactory.create(AppModule, { logger: false });
      try { configureApp(app); await app.listen(0, '127.0.0.1'); const url = await app.getUrl();
        const login = await fetch(url + '/api/v1/admin/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: process.env.SHOP_TEST_ACTOR, password: process.env.SHOP_TEST_PASSWORD }) });
        const token = (await login.json()).data.accessToken; const input = JSON.parse(process.env.SHOP_TEST_CREATE);
        const create = body => fetch(url + '/api/v1/admin/employees', { method: 'POST', headers: {
          'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
        const invalid = await create({ ...input, status: 'DISABLED' });
        const response = await create(input); const body = await response.json(); const duplicate = await create(input); const conflict = await duplicate.json();
        console.log(JSON.stringify({ login: login.status, invalid: invalid.status, created: response.status,
          fields: Object.keys(body.data ?? {}).sort(), mustChange: body.data?.mustChangePassword, version: body.data?.version,
          duplicate: duplicate.status, code: conflict.code }));
      } finally { await app.close(); }
    })().catch(() => { console.error('编译后员工创建验证失败'); process.exitCode=1; });`;
  const child = spawnSync(process.execPath, ['-e', source], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true, timeout: 15_000,
    env: { ...process.env, LOG_LEVEL: 'silent', SHOP_TEST_ACTOR: actor.username, SHOP_TEST_PASSWORD: adminPassword, SHOP_TEST_CREATE: JSON.stringify(request) } });
  expect(child.status).toBe(0); expect(JSON.parse(child.stdout.trim())).toEqual({ login: 200, invalid: 400, created: 201,
    fields: ['createdAt', 'displayName', 'id', 'lastLoginAt', 'mustChangePassword', 'role', 'status', 'username', 'version'],
    mustChange: true, version: 0, duplicate: 409, code: 'USERNAME_EXISTS' });
  for (const secret of [adminPassword, initialPassword, adminHash]) expect(child.stdout + child.stderr).not.toContain(secret);
});
