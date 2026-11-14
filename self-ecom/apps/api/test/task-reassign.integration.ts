// 作用：以真实HTTP/事务/行锁验证管理员转交、资格同步回池、整笔回滚与竞争，只操作本文件专属库。
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { EmployeeRole, Prisma, Task } from '@prisma/client';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { assertSafeTestDatabase } from '../scripts/database-env.js';
import { runPrisma } from '../scripts/database.js';
import { AppModule } from '../src/app.module.js';
import { InventoryAdapters } from '../src/inventory/inventory.adapters.js';
import { AuditService, type AuditPayload } from '../src/audit/audit.service.js';
import { AuthSessionService } from '../src/auth/auth-session.service.js';
import { CurrentIdentityService } from '../src/auth/current-identity.service.js';
import { JwtTokenService } from '../src/auth/jwt-token.service.js';
import { PasswordService } from '../src/auth/password.service.js';
import { Clock } from '../src/common/time/clock.js';
import { configureApp } from '../src/common/configure-app.js';
import { APP_CONFIG, loadConfiguration } from '../src/config/environment.js';
import { EmployeeStatusService } from '../src/employees/employee-status.service.js';
import { EmployeeRoleService } from '../src/employees/employee-role.service.js';
import { EmployeeExtraPermissionService } from '../src/employees/employee-extra-permission.service.js';
import { PermissionService } from '../src/permissions/permission.service.js';
import { seedPermissionCatalog } from '../src/permissions/permission-seed.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { TaskBusinessAdapters, type TaskEmployee } from '../src/tasks/task-business-adapters.js';
import { TaskCommandService } from '../src/tasks/task-command.service.js';
import { TaskEntryService } from '../src/tasks/task-entry.service.js';
import { TaskEligibilityService } from '../src/tasks/task-eligibility.service.js';
import { createFixture, observeLocks, type FixtureBusiness, type LockObservation } from './fixtures/task-entry-business.js';
import { FixtureReassignAdapters, installReassignFixture } from './fixtures/task-reassign-business.js';

const safe = assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('转交/回池测试仅限test环境');
const targetUrl = new URL(safe.testUrl); targetUrl.pathname = `/task_reassign_${randomUUID().replaceAll('-', '')}_test`;
const target = assertSafeTestDatabase(safe.developmentUrl, targetUrl.toString());
if (!/^task_reassign_[a-f0-9]{32}_test$/.test(target.testName)) throw new Error('专属库名不合法');
const server = new URL(safe.testUrl); server.pathname = '/postgres';
const admin = new Client({ connectionString: server.toString() }); const holder = new Client({ connectionString: target.testUrl });
const start = Date.parse('2026-11-13T02:00:00Z'); let millis = start; const clock = () => new Date(millis);
const tokens = new JwtTokenService({ secret: 'isolated-task-reassign-key-2026-'.repeat(3), ttlSeconds: 7200 }, clock);
const sessions = new AuthSessionService(tokens, clock); const permissions = new PermissionService();
const identities = new CurrentIdentityService(tokens, permissions, clock); const adapters = new FixtureReassignAdapters();
class ControlledAudit extends AuditService {
  failAction = ''; failAt = 1; seen = 0;
  override async appendAudit(tx: Prisma.TransactionClient, payload: AuditPayload) {
    await super.appendAudit(tx, payload);
    if (payload.action === this.failAction && ++this.seen === this.failAt) throw new Error('隔离故障：审计写后失败');
  }
}
const audit = new ControlledAudit(); let app: INestApplication; let prisma: PrismaService; let entry: TaskEntryService; let commands: TaskCommandService;
let created = false; let base = ''; let passwordHash = ''; let customerId = '';
interface Person { identity: TaskEmployee; token: string }
let manager: Person; let warehouse: Person; let support: Person;
beforeAll(async () => {
  await admin.connect(); await admin.query(`CREATE DATABASE "${target.testName}" ENCODING 'UTF8' TEMPLATE template0`); created = true;
  runPrisma(['migrate', 'deploy'], { ...process.env, DATABASE_URL: target.testUrl });
  const config = loadConfiguration({ ...process.env, DATABASE_URL: target.testUrl, LOG_LEVEL: 'silent' });
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(APP_CONFIG).useValue(config)
    .overrideProvider(JwtTokenService).useValue(tokens).overrideProvider(AuthSessionService).useValue(sessions).overrideProvider(CurrentIdentityService).useValue(identities)
    .overrideProvider(Clock).useValue({ now: clock }).overrideProvider(TaskBusinessAdapters).useValue(adapters).overrideProvider(AuditService).useValue(audit).overrideProvider(InventoryAdapters).useValue({onModuleInit(){ /* 本文件用真实SQL父事实夹具统一替代业务适配器，库存正式注册由库存集成测试验证。 */ }}).compile();
  app = module.createNestApplication(); configureApp(app); await app.listen(0, '127.0.0.1'); base = (await app.getUrl()) + '/api/v1';
  prisma = app.get(PrismaService); entry = app.get(TaskEntryService); commands = app.get(TaskCommandService); await holder.connect();
  await prisma.$transaction(installReassignFixture); await seedPermissionCatalog(prisma); passwordHash = await new PasswordService().hash('IsolatedReassign#2026');
}, 45_000);
async function person(role: EmployeeRole) {
  const row = await prisma.employee.create({ data: { username: `tr_${randomUUID().replaceAll('-', '').slice(0, 20)}`, displayName: '隔离任务交接员工', role, passwordHash, mustChangePassword: false } });
  const session = await prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx, { subjectType: 'EMPLOYEE', subjectId: row.id,
    expectedPasswordHash: passwordHash, expectedTokenVersion: 0 }));
  const identity = await identities.authenticate(prisma, session.accessToken, 'EMPLOYEE');
  if (identity.subjectType !== 'EMPLOYEE') throw new Error('员工夹具错误'); return { identity, token: session.accessToken };
}
beforeEach(async () => {
  millis = start; audit.failAction = ''; audit.seen = 0; audit.failAt = 1;
  adapters.onTransfer = undefined; adapters.onRepool = undefined; adapters.onPlan = undefined; adapters.onClaim = undefined; adapters.onScope = undefined;
  await prisma.$executeRawUnsafe('DELETE FROM task_handoff_fixture'); await prisma.deadlineEvent.deleteMany(); await prisma.taskHistory.deleteMany(); await prisma.task.deleteMany(); await prisma.taskStageCursor.deleteMany();
  await prisma.$executeRawUnsafe('DELETE FROM task_entry_fixture'); await prisma.$executeRawUnsafe('DELETE FROM task_entry_fixture_resource');
  await prisma.auditLog.deleteMany(); await prisma.authSession.deleteMany(); await prisma.employeeExtraPermission.deleteMany(); await prisma.employee.deleteMany(); await prisma.customer.deleteMany();
  manager = await person('SUPER_ADMIN'); warehouse = await person('MERCH_WAREHOUSE'); support = await person('CUSTOMER_SERVICE');
  customerId = (await prisma.customer.create({ data: { phone: '19900000071', nickname: '隔离服装顾客', passwordHash } })).id;
});
afterAll(async () => {
  await holder.end(); await app?.close();
  try { if (created) { assertSafeTestDatabase(safe.developmentUrl, target.testUrl); await admin.query(`DROP DATABASE "${target.testName}"`); console.info('步骤7专属测试库已删除'); } }
  finally { await admin.end(); }
}, 20_000);
async function makeTask(patch: Partial<FixtureBusiness> = {}): Promise<Task> {
  const root = await createFixture(prisma, customerId, { businessType: 'ORDER', allowedStage: 'SHIPMENT_PROCESS', ...patch });
  const reference = { businessType: root.businessType, businessId: root.id };
  return prisma.$transaction(tx => entry.withContext(tx, { type: 'SYSTEM' }, [reference], randomUUID(), async context =>
    (await entry.enterStage(context, { ...reference, stage: root.allowedStage as Task['stage'], entryKey: 'isolated:reassign', reason: '隔离阶段进入' })).task));
}
type CommandResult = Awaited<ReturnType<TaskCommandService['transfer']>>;
async function http(path: string, body: unknown, who = manager, status = 200, method = 'POST') {
  const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${who.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json() as { data: CommandResult; code: string; requestId: string };
  expect(response.status, JSON.stringify(result)).toBe(status); expect(result.requestId).toBe(response.headers.get('x-request-id'));
  if (response.ok) expect(response.headers.get('cache-control')).toBe('no-store');
  for (const secret of [passwordHash, manager.token, warehouse.token]) expect(JSON.stringify(result)).not.toContain(secret);
  return result;
}
const transfer = (task: Task, who = warehouse, version = task.version, status = 200, actor = manager, reason = '交接服装任务') =>
  http(`/admin/tasks/${task.id}/transfer`, { targetEmployeeId: who.identity.subjectId, expectedVersion: version, reason }, actor, status);
const claim = (task: Task, who = warehouse) => commands.claim(who.identity, who.token, task.id, { expectedVersion: task.version }, randomUUID());
const disable = (who = warehouse) => app.get(EmployeeStatusService).change(manager.identity, manager.token, who.identity.subjectId, 'DISABLED', { expectedVersion: 0, reason: '停用交接' }, randomUUID());
const role = (who = warehouse) => app.get(EmployeeRoleService).change(manager.identity, manager.token, who.identity.subjectId, { expectedVersion: 0, role: 'CUSTOMER_SERVICE', reason: '调岗交接' }, randomUUID());
const revoke = (who = support) => app.get(EmployeeExtraPermissionService).replace(manager.identity, manager.token, who.identity.subjectId, { expectedVersion: 0, permissions: [], reason: '撤销额外授权' }, randomUUID());
async function grantShipping(who = support) {
  const result = permissions.resolveExtraPermissions('CUSTOMER_SERVICE', [], ['shipment.handover', 'shipment.pack']);
  await prisma.employeeExtraPermission.createMany({ data: result.resolvedExtraPermissions.map(permissionCode => ({ employeeId: who.identity.subjectId, permissionCode, grantedById: manager.identity.subjectId })) });
}
async function state() {
  return { employees: await prisma.employee.findMany({ orderBy: { id: 'asc' } }), extras: await prisma.employeeExtraPermission.findMany({ orderBy: [{ employeeId: 'asc' }, { permissionCode: 'asc' }] }),
    sessions: await prisma.authSession.findMany({ orderBy: { id: 'asc' } }), tasks: await prisma.task.findMany({ orderBy: { id: 'asc' } }),
    history: await prisma.taskHistory.findMany({ orderBy: { id: 'asc' } }), audits: await prisma.auditLog.findMany({ orderBy: { id: 'asc' } }),
    handlers: await prisma.$queryRaw`SELECT * FROM task_handoff_fixture ORDER BY task_id`, roots: await prisma.$queryRaw`SELECT * FROM task_entry_fixture ORDER BY id` };
}
function barrier() { let release!: () => void; let signal!: () => void; const held = new Promise<void>(yes => { release = yes; }); const ready = new Promise<void>(yes => { signal = yes; }); return { release, signal, held, ready }; }
async function waitBlocked(pid: number) {
  const until = performance.now() + 500;
  while (performance.now() < until) {
    const result = await admin.query(`WITH RECURSIVE blocked(pid) AS (SELECT pid FROM pg_stat_activity WHERE datname=$1 AND $2=ANY(pg_blocking_pids(pid))
      UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid=ANY(pg_blocking_pids(a.pid)) WHERE a.datname=$1) SELECT count(*)::int AS count FROM blocked`, [target.testName, pid]);
    if (result.rows[0].count) return; await new Promise(yes => setTimeout(yes, 5));
  }
  throw new Error('未观察到真实锁竞争');
}
async function cursorPid(tx: Prisma.TransactionClient) { return (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid; }

it('OPEN指派、CLAIMED转交、管理员接手均保留期限轮次；幂等不再写领域/历史/审计', async () => {
  let task = await makeTask(); const dueAt = new Date(start + 3600000);
  task = await prisma.task.update({ where: { id: task.id }, data: { originalDueAt: dueAt, dueAt, reassignNeeded: true, everOverdue: true, firstOverdueAt: new Date(start) } });
  const first = await transfer(task); expect(first.data).toMatchObject({ changed: true, task: { version: 1, round: 1, reassignNeeded: false, assignee: { id: warehouse.identity.subjectId } } });
  expect(first.data.task.allowedActions).toContain('transfer'); const after = await state();
  expect((await transfer(task)).data.changed).toBe(false); expect(await state()).toEqual(after);
  await transfer(task, manager, 1); const saved = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
  expect(saved).toMatchObject({ status: 'CLAIMED', assigneeId: manager.identity.subjectId, round: task.round, dueAt, originalDueAt: dueAt,
    settingsVersionId: task.settingsVersionId, ruleSnapshot: task.ruleSnapshot, everOverdue: true, firstOverdueAt: new Date(start), version: 2 });
  await expect(commands.release(warehouse.identity, warehouse.token, task.id, { expectedVersion: 2, reason: '旧经办释放' }, randomUUID())).rejects.toMatchObject({ code: 'TASK_NOT_ASSIGNEE' });
  const history = await prisma.taskHistory.findMany({ where: { action: 'TRANSFERRED' }, orderBy: { createdAt: 'asc' } });
  expect(history).toHaveLength(2); expect(history.every(row => row.actorEmployeeId === manager.identity.subjectId)).toBe(true);
  expect(await prisma.auditLog.count({ where: { action: 'task.transfer' } })).toBe(2);
});
it.each(['CUSTOMER_SERVICE', 'MERCH_WAREHOUSE'] as const)('%s不能调用管理员转交', async position => {
  const task = await makeTask(); const before = await state(); await transfer(task, warehouse, 0, 403, position === 'CUSTOMER_SERVICE' ? support : warehouse); expect(await state()).toEqual(before);
});
it.each(['missing', 'disabled', 'password', 'permissions', 'snapshot', 'business'] as const)('转交拒绝目标%s且没有任何写入', async condition => {
  const task = await makeTask(); let who = warehouse;
  if (condition === 'missing') who = { ...warehouse, identity: { ...warehouse.identity, subjectId: randomUUID() } };
  if (condition === 'disabled') await prisma.employee.update({ where: { id: warehouse.identity.subjectId }, data: { status: 'DISABLED' } });
  if (condition === 'password') await prisma.employee.update({ where: { id: warehouse.identity.subjectId }, data: { mustChangePassword: true } });
  if (condition === 'permissions') who = support;
  if (condition === 'snapshot') await prisma.task.update({ where: { id: task.id }, data: { requiredPermissions: [...task.requiredPermissions as string[], 'after-sale.refund.retry'] } });
  if (condition === 'business') await prisma.$executeRaw`UPDATE task_entry_fixture SET reader_employee_id=${manager.identity.subjectId}::uuid WHERE id=${task.businessId}::uuid`;
  const before = await state(); expect((await transfer(task, who, 0, 409)).code).toBe('TARGET_NOT_ELIGIBLE'); expect(await state()).toEqual(before);
});
it.each(['SUSPENDED', 'COMPLETED', 'CANCELLED'] as const)('%s任务不能借转交恢复', async status => {
  const task = await makeTask(); await prisma.task.update({ where: { id: task.id }, data: { status, ...(status !== 'SUSPENDED' ? { closedAt: clock() } : {}) } });
  const before = await state(); expect((await transfer(task, warehouse, 0, 409)).code).toBe('TASK_TRANSFER_BLOCKED'); expect(await state()).toEqual(before);
});
it('真实业务不安全时转交拒绝，原经办和业务事实不变', async () => {
  const task = await makeTask(); await claim(task); await prisma.$executeRaw`UPDATE task_entry_fixture SET safe_release=false WHERE id=${task.businessId}::uuid`;
  const before = await state(); expect((await transfer(task, manager, 1, 409)).code).toBe('TASK_TRANSFER_BLOCKED'); expect(await state()).toEqual(before);
});
it('旧版本、不同原因重放与转回后的ABA均冲突', async () => {
  const task = await makeTask(); await transfer(task); expect((await transfer(task, warehouse, 0, 409, manager, '别的原因')).code).toBe('VERSION_CONFLICT');
  await transfer(task, manager, 1); expect((await transfer(task, warehouse, 0, 409)).code).toBe('VERSION_CONFLICT');
});
it.each([{ targetEmployeeId: 'bad', expectedVersion: 0, reason: '交接' }, { expectedVersion: 0, reason: '交接' },
  { targetEmployeeId: randomUUID(), expectedVersion: '0', reason: '交接' }, { targetEmployeeId: randomUUID(), expectedVersion: 0, reason: ' ' },
  { targetEmployeeId: randomUUID(), expectedVersion: 0, reason: '交接', dueAt: '2026-12-01' }])('HTTP严格拒绝转交非法输入%s', async body => {
  const task = await makeTask(); const before = await state(); await http(`/admin/tasks/${task.id}/transfer`, body, manager, 400); expect(await state()).toEqual(before);
});
it('转交审计写后失败连同领域经办/任务/历史回滚', async () => {
  const task = await makeTask(); const before = await state(); audit.failAction = 'task.transfer'; await transfer(task, warehouse, 0, 500); expect(await state()).toEqual(before);
});
it('转交等待后凭证到期，领域写入也回滚', async () => {
  const task = await makeTask(); const before = await state(); adapters.onTransfer = async () => { millis += 7200_000; };
  await transfer(task, warehouse, 0, 401); expect(await state()).toEqual(before);
});
it.each(['disable', 'role', 'revoke'] as const)('%s同事务回池保留轮次/期限/交运未决，审计使用真实操作者和requestId', async action => {
  const who = action === 'revoke' ? support : warehouse; if (action === 'revoke') await grantShipping();
  const task = await makeTask(); await claim(task, who); const dueAt = new Date(start + 3600_000);
  await prisma.task.update({ where: { id: task.id }, data: { dueAt, originalDueAt: dueAt } });
  await prisma.$executeRaw`UPDATE task_entry_fixture SET safe_release=false WHERE id=${task.businessId}::uuid`;
  const result = action === 'disable' ? await disable(who) : action === 'role' ? await role(who) : await revoke(who); expect(result.changed).toBe(true);
  const saved = await prisma.task.findUniqueOrThrow({ where: { id: task.id } }); expect(saved).toMatchObject({ status: 'OPEN', assigneeId: null, reassignNeeded: true, round: 1, version: 2, dueAt, originalDueAt: dueAt });
  const history = await prisma.taskHistory.findFirstOrThrow({ where: { taskId: task.id, action: 'QUALIFICATION_LOST' } });
  expect(history).toMatchObject({ actorEmployeeId: manager.identity.subjectId, fromAssigneeId: who.identity.subjectId, toAssigneeId: null });
  const logs = await prisma.auditLog.findMany({ where: { requestId: history.requestId } }); expect(logs).toHaveLength(2);
  expect(logs.find(row => row.action === 'task.qualification.lost')?.afterData).toMatchObject({ reassignNeeded: true, taskVersion: 2 });
  expect(await prisma.$queryRaw`SELECT assignee_id,domain_state FROM task_handoff_fixture WHERE task_id=${task.id}::uuid`).toEqual([{ assignee_id: null, domain_state: 'HANDOVER_UNKNOWN' }]);
  await expect(claim(saved, who)).rejects.toMatchObject({ code: action === 'disable' ? 'SESSION_REVOKED' : 'FORBIDDEN' });
});
it('无关撤权、启用及未完成但仍有资格的任务不回池，已结束任务不复活', async () => {
  await grantShipping(); const shipping = await makeTask(); const contact = await makeTask({ allowedStage: 'CUSTOMER_CONTACT' }); await claim(shipping, support); await claim(contact, support);
  const finished = await makeTask(); await claim(finished, support); await prisma.task.update({ where: { id: finished.id }, data: { status: 'COMPLETED', assigneeId: null, closedAt: clock() } });
  await revoke(); expect((await prisma.task.findUniqueOrThrow({ where: { id: shipping.id } })).status).toBe('OPEN');
  expect((await prisma.task.findUniqueOrThrow({ where: { id: contact.id } })).status).toBe('CLAIMED');
  expect((await prisma.task.findUniqueOrThrow({ where: { id: finished.id } })).status).toBe('COMPLETED');
  expect(await prisma.taskHistory.count({ where: { action: 'QUALIFICATION_LOST' } })).toBe(1);
});
it.each(['disable', 'role', 'revoke'] as const)('%s第二项任务历史失败时，员工/权限/会话/前一任务与领域写入全部回滚', async action => {
  const who = action === 'revoke' ? support : warehouse; if (action === 'revoke') await grantShipping();
  await claim(await makeTask(), who); await claim(await makeTask(), who); const before = await state();
  const original = prisma.$transaction.bind(prisma); let attempted = 0;
  const spy = vi.spyOn(prisma, '$transaction').mockImplementation(((command: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => original(async tx => {
    const proxy = new Proxy(tx, { get(client, key) { if (key !== 'taskHistory') return Reflect.get(client, key);
      return new Proxy(client.taskHistory, { get(model, method) { if (method !== 'create') return Reflect.get(model, method);
        return async (input: Prisma.TaskHistoryCreateArgs) => { const result = await model.create(input); if (input.data.action === 'QUALIFICATION_LOST' && ++attempted === 2) throw new Error('隔离故障：第二项历史写后失败'); return result; }; } }); } });
    return command(proxy);
  }, options)) as typeof prisma.$transaction);
  try { await expect(action === 'disable' ? disable(who) : action === 'role' ? role(who) : revoke(who)).rejects.toThrow('第二项历史'); } finally { spy.mockRestore(); }
  expect(attempted).toBe(2); expect(await state()).toEqual(before);
});
it('第二项回池审计失败也整体回滚，正常重试一次全部成功', async () => {
  await claim(await makeTask()); await claim(await makeTask()); const before = await state(); audit.failAction = 'task.qualification.lost'; audit.failAt = 2;
  await expect(disable()).rejects.toThrow('审计写后'); expect(await state()).toEqual(before); audit.failAction = ''; await disable();
  expect(await prisma.task.count({ where: { status: 'OPEN', reassignNeeded: true } })).toBe(2);
});
it('回池业务锁等待后操作者过期，员工尚未写入且全部不变', async () => {
  await claim(await makeTask()); const before = await state(); adapters.onPlan = async () => { millis += 7200_000; };
  await expect(disable()).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' }); expect(await state()).toEqual(before);
});
it('回池上下文不能伪造或跨事务复用', async () => {
  await expect(prisma.$transaction(tx => app.get(TaskEligibilityService).apply(tx, warehouse.identity.subjectId, [], { employeeId: warehouse.identity.subjectId })))
    .rejects.toMatchObject({ code: 'TASK_CONTEXT_INVALID' });
});
it('多顾客/订单/SKU批量回池合并锁序，全部业务先于全部Cursor/Task，记录小店耗时', async () => {
  const trace: LockObservation[] = []; const tasks: Task[] = [];
  for (let index = 0; index < 8; index++) {
    const customer = await prisma.customer.create({ data: { phone: `1990000010${index}`, nickname: '批量服装顾客', passwordHash } }); const sku = randomUUID();
    await prisma.$executeRaw`INSERT INTO task_entry_fixture_resource(id,kind) VALUES(${sku}::uuid,'SKU_STOCK')`;
    const task = await makeTask({ customerId: customer.id, extraLocks: [{ kind: 'SKU_STOCK', id: sku }] }); await claim(task); tasks.push(task);
  }
  const original = prisma.$transaction.bind(prisma);
  const spy = vi.spyOn(prisma, '$transaction').mockImplementation(((command: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) =>
    original(tx => command(observeLocks(tx, trace)), options)) as typeof prisma.$transaction);
  const started = performance.now(); try { await disable(); } finally { spy.mockRestore(); }
  const durationMs = Math.round((performance.now() - started) * 100) / 100;
  // 会话撤销会重取已经持有的目标员工锁；验证首次取得资源的顺序，并确认没有新增员工资源。
  const seen = new Set<string>(); const uniqueTrace = trace.filter(row => { const key = `${row.table}:${row.ids.join(',')}`; if (seen.has(key)) return false; seen.add(key); return true; });
  const tables = uniqueTrace.map(row => row.table); const first = (table: string) => tables.indexOf(table); const last = (table: string) => tables.lastIndexOf(table);
  expect(first('system_guard')).toBe(0); expect(last('employee')).toBeLessThan(first('customer')); expect(last('customer')).toBeLessThan(first('task_entry_fixture'));
  expect(last('task_entry_fixture')).toBeLessThan(first('task_entry_fixture_resource')); expect(last('task_entry_fixture_resource')).toBeLessThan(first('task_stage_cursor')); expect(last('task_stage_cursor')).toBeLessThan(first('task'));
  for (const table of ['employee', 'customer', 'task_entry_fixture', 'task_entry_fixture_resource', 'task_stage_cursor', 'task']) {
    const ids = uniqueTrace.filter(row => row.table === table).flatMap(row => row.ids); expect(ids).toEqual([...ids].sort());
  }
  expect(await prisma.task.count({ where: { status: 'OPEN', reassignNeeded: true } })).toBe(tasks.length);
  console.info(JSON.stringify({ case: '八顾客八订单八SKU回池', tasks: tasks.length, durationMs, lockTables: tables }));
  if (process.env.TASK_REASSIGN_METRICS_PATH) writeFileSync(process.env.TASK_REASSIGN_METRICS_PATH, JSON.stringify({
    checkedAt: new Date().toISOString(), case: '八顾客八订单八SKU回池', tasks: tasks.length, durationMs,
    firstAcquisitionTables: tables, repeatedEmployeeLocks: trace.filter(row => row.table === 'employee').length - uniqueTrace.filter(row => row.table === 'employee').length,
  }, null, 2) + '\n', { flag: 'wx' });
});
it('领取先锁员工，撤权等待后必须看到刚领的任务并回池', async () => {
  await grantShipping(); const task = await makeTask(); const gate = barrier(); let pid = 0;
  adapters.onClaim = async () => { pid = (await admin.query(`SELECT pid FROM pg_stat_activity WHERE datname=$1 AND state='idle in transaction' LIMIT 1`, [target.testName])).rows[0]?.pid ?? 0; gate.signal(); await gate.held; };
  const claimed = claim(task, support); await gate.ready; const revoked = revoke();
  const completed = Promise.all([claimed, revoked]);
  try { expect(pid).toBeGreaterThan(0); await waitBlocked(pid); } finally { gate.release(); await completed; }
  expect(await prisma.task.findUnique({ where: { id: task.id } })).toMatchObject({ status: 'OPEN', reassignNeeded: true, assigneeId: null, version: 2 });
});
it('撤权先持员工锁，领取等待后按新权限拒绝', async () => {
  await grantShipping(); const task = await makeTask(); const gate = barrier(); let pid = 0;
  const service = app.get(TaskEligibilityService); const original = service.prepare.bind(service);
  const spy = vi.spyOn(service, 'prepare').mockImplementation(async (...args) => { const result = await original(...args); pid = await cursorPid(args[0]); gate.signal(); await gate.held; return result; });
  const revoked = revoke(); await gate.ready; const claimed = claim(task, support); const settled = Promise.allSettled([claimed]);
  try { await waitBlocked(pid); } finally { gate.release(); spy.mockRestore(); }
  // 未经办且撤权后不再合资格，按既有不可见即404契约拒绝，不能暴露任务存在。
  await revoked; const results = await settled; expect(results[0]).toMatchObject({ status: 'rejected', reason: { code: 'TASK_NOT_FOUND' } });
  expect(await prisma.taskHistory.count({ where: { action: 'CLAIMED' } })).toBe(0);
});
it('目标先被停用，转交等待后拒绝不合资格目标', async () => {
  const task = await makeTask(); const gate = barrier(); let pid = 0; const service = app.get(TaskEligibilityService); const original = service.prepare.bind(service);
  const spy = vi.spyOn(service, 'prepare').mockImplementation(async (...args) => { const result = await original(...args); pid = await cursorPid(args[0]); gate.signal(); await gate.held; return result; });
  const disabled = disable(); await gate.ready; const assigned = commands.transfer(manager.identity, manager.token, task.id, { targetEmployeeId: warehouse.identity.subjectId, expectedVersion: 0, reason: '并发转交' }, randomUUID());
  const settled = Promise.allSettled([assigned]); try { await waitBlocked(pid); } finally { gate.release(); spy.mockRestore(); }
  await disabled; expect((await settled)[0]).toMatchObject({ status: 'rejected', reason: { code: 'TARGET_NOT_ELIGIBLE' } }); expect(await prisma.taskHistory.count({ where: { action: 'TRANSFERRED' } })).toBe(0);
});
it('转交先持目标锁，停用随后把新经办同步回池', async () => {
  const task = await makeTask(); const gate = barrier(); let pid = 0;
  adapters.onTransfer = async () => { pid = (await admin.query(`SELECT pid FROM pg_stat_activity WHERE datname=$1 AND state='idle in transaction' AND query LIKE '%task_handoff_fixture%' LIMIT 1`, [target.testName])).rows[0]?.pid ?? 0; gate.signal(); await gate.held; };
  const assigned = commands.transfer(manager.identity, manager.token, task.id, { targetEmployeeId: warehouse.identity.subjectId, expectedVersion: 0, reason: '并发转交' }, randomUUID());
  await gate.ready; const disabled = disable(); try { expect(pid).toBeGreaterThan(0); await waitBlocked(pid); } finally { gate.release(); }
  await assigned; await disabled; expect(await prisma.task.findUnique({ where: { id: task.id } })).toMatchObject({ status: 'OPEN', reassignNeeded: true, version: 2 });
});
it('锁计划变化整笔重试后成功，仅留一次回池历史', async () => {
  const task = await makeTask(); await claim(task); let calls = 0;
  const extra = randomUUID(); await prisma.$executeRaw`INSERT INTO task_entry_fixture_resource(id,kind) VALUES(${extra}::uuid,'SKU_STOCK')`;
  adapters.onPlan = async () => { if (++calls === 1) await prisma.$executeRaw`UPDATE task_entry_fixture SET extra_locks=${JSON.stringify([{ kind: 'SKU_STOCK', id: extra }])}::jsonb WHERE id=${task.businessId}::uuid`; };
  await disable(); expect(calls).toBe(4); expect(await prisma.taskHistory.count({ where: { action: 'QUALIFICATION_LOST' } })).toBe(1);
});
it('锁计划持续变化最多重试三次，员工/会话/任务保持原状', async () => {
  const task = await makeTask(); await claim(task); const extra = randomUUID();
  await prisma.$executeRaw`INSERT INTO task_entry_fixture_resource(id,kind) VALUES(${extra}::uuid,'SKU_STOCK')`;
  const before = await state(); let calls = 0;
  adapters.onPlan = async () => { calls++; if (calls % 2 === 1) {
    const locks = calls % 4 === 1 ? [{ kind: 'SKU_STOCK', id: extra }] : [];
    await prisma.$executeRaw`UPDATE task_entry_fixture SET extra_locks=${JSON.stringify(locks)}::jsonb WHERE id=${task.businessId}::uuid`;
  } };
  await expect(disable()).rejects.toMatchObject({ code: 'TASK_LOCK_PLAN_CHANGED' }); expect(calls).toBe(6);
  // 上游变化属于另一真实事务；只比较本命令负责的员工、会话、任务、交接和审计。
  const after = await state(); expect({ ...after, roots: before.roots }).toEqual(before);
});
it('回池与另一员工处理同订单不同阶段竞争，不反向补锁该员工或丢失其经办', async () => {
  const task = await makeTask(); await claim(task);
  await prisma.$executeRaw`UPDATE task_entry_fixture SET allowed_stage='CUSTOMER_CONTACT' WHERE id=${task.businessId}::uuid`;
  const contact = await prisma.$transaction(tx => entry.withContext(tx, { type: 'SYSTEM' }, [task], randomUUID(), async context =>
    (await entry.enterStage(context, { businessType: 'ORDER', businessId: task.businessId, stage: 'CUSTOMER_CONTACT', entryKey: 'isolated:contact', reason: '隔离并行沟通' })).task));
  await claim(contact, support);
  await holder.query('BEGIN'); const pid = Number((await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
  await holder.query('SELECT id FROM task_entry_fixture WHERE id=$1 FOR UPDATE', [task.businessId]);
  const disabled = disable(); const settledDisable = Promise.allSettled([disabled]);
  await waitBlocked(pid);
  const released = commands.release(support.identity, support.token, contact.id, { expectedVersion: 1, reason: '客服安全交班' }, randomUUID());
  const settledRelease = Promise.allSettled([released]);
  try { await waitBlocked(pid); } finally { await holder.query('COMMIT'); }
  expect((await settledDisable)[0]?.status).toBe('fulfilled'); expect((await settledRelease)[0]?.status).toBe('fulfilled');
  expect(await prisma.task.findUnique({ where: { id: task.id } })).toMatchObject({ status: 'OPEN', reassignNeeded: true, version: 2 });
  expect(await prisma.task.findUnique({ where: { id: contact.id } })).toMatchObject({ status: 'OPEN', reassignNeeded: false, version: 2 });
});
it('停用无已领任务时仍撤会话，重新启用不自动重新领取任务', async () => {
  const task = await makeTask(); await claim(task); await disable();
  const result = await app.get(EmployeeStatusService).change(manager.identity, manager.token, warehouse.identity.subjectId, 'ACTIVE', { expectedVersion: 1, reason: '重新启用' }, randomUUID());
  expect(result.changed).toBe(true); expect(await prisma.task.findUnique({ where: { id: task.id } })).toMatchObject({ status: 'OPEN', assigneeId: null, reassignNeeded: true, version: 2 });
  expect(await prisma.taskHistory.count({ where: { action: 'QUALIFICATION_LOST' } })).toBe(1);
});
it('撤销无关额外权限时仍合资格的已领任务完全不变', async () => {
  const task = await makeTask(); await claim(task);
  await prisma.employeeExtraPermission.create({ data: { employeeId: warehouse.identity.subjectId, permissionCode: 'customer.read', grantedById: manager.identity.subjectId } });
  const before = await prisma.task.findUniqueOrThrow({ where: { id: task.id } }); await revoke(warehouse);
  expect(await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).toEqual(before);
  expect(await prisma.taskHistory.count({ where: { action: 'QUALIFICATION_LOST' } })).toBe(0);
});
it('转交预定位后原经办变化，重新确认版本而不覆盖新经办', async () => {
  const task = await makeTask(); await claim(task); const next = await person('MERCH_WAREHOUSE'); const gate = barrier(); let plans = 0;
  adapters.onPlan = async () => { if (++plans === 1) { gate.signal(); await gate.held; } };
  const pending = commands.transfer(manager.identity, manager.token, task.id, { targetEmployeeId: manager.identity.subjectId, expectedVersion: 1, reason: '并发原经办交接' }, randomUUID());
  const settled = Promise.allSettled([pending]); await gate.ready;
  try {
    await commands.release(warehouse.identity, warehouse.token, task.id, { expectedVersion: 1, reason: '本人交班' }, randomUUID());
    await commands.claim(next.identity, next.token, task.id, { expectedVersion: 2 }, randomUUID());
  } finally { gate.release(); }
  expect((await settled)[0]).toMatchObject({ status: 'rejected', reason: { code: 'VERSION_CONFLICT' } });
  expect(await prisma.task.findUnique({ where: { id: task.id } })).toMatchObject({ assigneeId: next.identity.subjectId, status: 'CLAIMED', version: 3 });
  expect(await prisma.taskHistory.count({ where: { action: 'TRANSFERRED' } })).toBe(0);
});
it('版本达到上限的回池拒绝并回滚整个员工命令', async () => {
  const task = await makeTask(); await claim(task); await prisma.task.update({ where: { id: task.id }, data: { version: 2147483647 } });
  const before = await state(); await expect(disable()).rejects.toMatchObject({ code: 'TASK_VERSION_EXHAUSTED' }); expect(await state()).toEqual(before);
});
it('版本达到上限的任务不能转交', async () => {
  let task = await makeTask(); task = await prisma.task.update({ where: { id: task.id }, data: { version: 2147483647 } });
  const before = await state(); expect((await transfer(task, warehouse, 2147483647, 409)).code).toBe('TASK_VERSION_EXHAUSTED'); expect(await state()).toEqual(before);
});
