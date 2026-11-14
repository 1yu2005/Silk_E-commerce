import {AfterSaleAdapters} from '../src/after-sales/after-sale.adapters.js';
// 作用：在独占PostgreSQL库用真实HTTP、身份和事务验证延期/首次指定、历史逾期、领域同步、竞争及整体回滚。
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { EmployeeRole, Prisma, Task } from '@prisma/client';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { assertSafeTestDatabase } from '../scripts/database-env.js';
import { runPrisma } from '../scripts/database.js';
import { AppModule } from '../src/app.module.js';
import { OrderAdapters } from '../src/orders/order.adapters.js';
import { InventoryAdapters } from '../src/inventory/inventory.adapters.js';
import { AuditService, type AuditPayload } from '../src/audit/audit.service.js';
import { AuthSessionService } from '../src/auth/auth-session.service.js';
import { CurrentIdentityService } from '../src/auth/current-identity.service.js';
import { JwtTokenService } from '../src/auth/jwt-token.service.js';
import { PasswordService } from '../src/auth/password.service.js';
import { Clock } from '../src/common/time/clock.js';
import { configureApp } from '../src/common/configure-app.js';
import { APP_CONFIG, loadConfiguration } from '../src/config/environment.js';
import { EmployeeRoleService } from '../src/employees/employee-role.service.js';
import { EmployeeStatusService } from '../src/employees/employee-status.service.js';
import { PermissionService } from '../src/permissions/permission.service.js';
import { seedPermissionCatalog } from '../src/permissions/permission-seed.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { TaskBusinessAdapters, type TaskEmployee } from '../src/tasks/task-business-adapters.js';
import { TaskCommandService } from '../src/tasks/task-command.service.js';
import { TaskDeadlineService } from '../src/tasks/task-deadline.service.js';
import { TaskEntryService } from '../src/tasks/task-entry.service.js';
import type { TaskQueryService } from '../src/tasks/task-query.service.js';
import { FixtureDeadlineAdapters, installDeadlineFixture } from './fixtures/task-deadline-business.js';
import { createFixture, observeLocks, type FixtureBusiness, type LockObservation } from './fixtures/task-entry-business.js';

const safe = assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('延期测试仅限test环境');
const targetUrl = new URL(safe.testUrl); targetUrl.pathname = `/task_deadline_${randomUUID().replaceAll('-', '')}_test`;
const target = assertSafeTestDatabase(safe.developmentUrl, targetUrl.toString());
if (!/^task_deadline_[a-f0-9]{32}_test$/.test(target.testName)) throw new Error('专属库名不合法');
const server = new URL(safe.testUrl); server.pathname = '/postgres';
const admin = new Client({ connectionString: server.toString() }); const holder = new Client({ connectionString: target.testUrl });
const start = Date.parse('2026-11-13T02:00:00.000Z'); let millis = start; const clock = () => new Date(millis);
const tokens = new JwtTokenService({ secret: 'isolated-task-deadline-key-2026-'.repeat(3), ttlSeconds: 7200 }, clock);
const sessions = new AuthSessionService(tokens, clock); const identities = new CurrentIdentityService(tokens, new PermissionService(), clock);
const adapters = new FixtureDeadlineAdapters();
class ControlledAudit extends AuditService {
  failAction = ''; observed = false;
  override async appendAudit(tx: Prisma.TransactionClient, payload: AuditPayload) {
    await super.appendAudit(tx, payload);
    if (payload.action === this.failAction) { this.observed = await tx.auditLog.count({ where: { requestId: payload.requestId, action: payload.action } }) > 0;
      throw new Error('隔离延期审计写后故障'); }
  }
}
const audit = new ControlledAudit(); let app: INestApplication; let prisma: PrismaService; let entry: TaskEntryService; let service: TaskDeadlineService;
let commands: TaskCommandService; let created = false; let base = ''; let passwordHash = ''; let customerId = ''; let customerToken = '';
interface Person { identity: TaskEmployee; token: string }
let manager: Person; let otherManager: Person; let warehouse: Person; let support: Person;
type Result = Awaited<ReturnType<TaskDeadlineService['extend']>>;
beforeAll(async () => {
  await admin.connect(); await admin.query(`CREATE DATABASE "${target.testName}" ENCODING 'UTF8' TEMPLATE template0`); created = true;
  runPrisma(['migrate', 'deploy'], { ...process.env, DATABASE_URL: target.testUrl });
  const config = loadConfiguration({ ...process.env, DATABASE_URL: target.testUrl, LOG_LEVEL: 'silent' });
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(APP_CONFIG).useValue(config)
    .overrideProvider(JwtTokenService).useValue(tokens).overrideProvider(AuthSessionService).useValue(sessions).overrideProvider(CurrentIdentityService).useValue(identities)
    .overrideProvider(Clock).useValue({ now: clock }).overrideProvider(TaskBusinessAdapters).useValue(adapters).overrideProvider(AuditService).useValue(audit).overrideProvider(OrderAdapters).useValue({onModuleInit(){ /* 任务内核隔离测试使用本文件的父事实夹具；真实订单接通由orders.integration覆盖。 */ }}).overrideProvider(InventoryAdapters).useValue({onModuleInit(){ /* 本文件用真实SQL父事实夹具统一替代业务适配器，库存正式注册由库存集成测试验证。 */ }}).overrideProvider(AfterSaleAdapters).useValue({ /* 本套件只安装任务内核夹具；真实售后适配由售后集成套件验证。 */ }).compile();
  app = module.createNestApplication(); configureApp(app); await app.listen(0, '127.0.0.1'); base = (await app.getUrl()) + '/api/v1';
  prisma = app.get(PrismaService); entry = app.get(TaskEntryService); service = app.get(TaskDeadlineService); commands = app.get(TaskCommandService); await holder.connect();
  await prisma.$transaction(installDeadlineFixture); await seedPermissionCatalog(prisma); passwordHash = await new PasswordService().hash('IsolatedDeadline#2026');
}, 45_000);
async function person(role: EmployeeRole) {
  const row = await prisma.employee.create({ data: { username: `td_${randomUUID().replaceAll('-', '').slice(0, 20)}`, displayName: '隔离期限员工', role, passwordHash, mustChangePassword: false } });
  const session = await prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx, { subjectType: 'EMPLOYEE', subjectId: row.id, expectedPasswordHash: passwordHash, expectedTokenVersion: 0 }));
  const identity = await identities.authenticate(prisma, session.accessToken, 'EMPLOYEE');
  if (identity.subjectType !== 'EMPLOYEE') throw new Error('期限员工夹具错误'); return { identity, token: session.accessToken };
}
beforeEach(async () => {
  millis = start; audit.failAction = ''; audit.observed = false; adapters.onDeadlineCheck = undefined; adapters.onExtend = undefined;
  adapters.onPlan = undefined; adapters.onScope = undefined; adapters.onClaim = undefined; adapters.onTransfer = undefined;
  await prisma.$executeRawUnsafe('DELETE FROM task_deadline_fixture'); await prisma.$executeRawUnsafe('DELETE FROM task_handoff_fixture');
  await prisma.deadlineEvent.deleteMany(); await prisma.taskHistory.deleteMany(); await prisma.task.deleteMany(); await prisma.taskStageCursor.deleteMany();
  await prisma.$executeRawUnsafe('DELETE FROM task_entry_fixture'); await prisma.$executeRawUnsafe('DELETE FROM task_entry_fixture_resource');
  await prisma.storeSettingHead.update({ where: { id: 1 }, data: { currentVersionId: null, version: 0 } }); await prisma.storeSettingVersion.deleteMany();
  await prisma.auditLog.deleteMany(); await prisma.authSession.deleteMany(); await prisma.employeeExtraPermission.deleteMany(); await prisma.employee.deleteMany(); await prisma.customer.deleteMany();
  manager = await person('SUPER_ADMIN'); otherManager = await person('SUPER_ADMIN'); warehouse = await person('MERCH_WAREHOUSE'); support = await person('CUSTOMER_SERVICE');
  customerId = (await prisma.customer.create({ data: { phone: '19900000081', nickname: '隔离服装期限顾客', passwordHash } })).id;
  customerToken = (await prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx, { subjectType: 'CUSTOMER', subjectId: customerId, expectedPasswordHash: passwordHash, expectedTokenVersion: 0 }))).accessToken;
  await configure();
});
afterAll(async () => {
  await holder.end(); await app?.close();
  try { if (created) { assertSafeTestDatabase(safe.developmentUrl, target.testUrl); await admin.query(`DROP DATABASE "${target.testName}"`); console.info('步骤8专属延期库已删除'); } }
  finally { await admin.end(); }
}, 20_000);
async function configure() {
  const versionNumber = await prisma.storeSettingVersion.count() + 1;
  const setting = await prisma.storeSettingVersion.create({ data: { versionNumber, createdByEmployeeId: manager.identity.subjectId, reason: '隔离期限设置',
    shippingFeeCents: 1000, freeShippingEnabled: true, freeShippingThresholdCents: 9900, returnReceiver: '隔离仓库', returnPhone: '01000000000',
    returnProvince: '测试省', returnCity: '测试市', returnDistrict: '测试区', returnDetail: '仅隔离测试库', servicePhone: '01000000000',
    paymentMinutes: 30, autoReceiptDays: 10, afterSaleWindowDays: 7, reviewWorkdays: 2, supplementDays: 7, returnShipDays: 7, inspectionWorkdays: 2, refundWorkdays: 1 } });
  await prisma.storeSettingHead.update({ where: { id: 1 }, data: { currentVersionId: setting.id, version: versionNumber } }); return setting;
}
async function makeTask(options: { root?: Partial<FixtureBusiness>; dueAt?: Date | null } = {}): Promise<Task> {
  const root = await createFixture(prisma, customerId, { businessType: 'ORDER', allowedStage: 'SHIPMENT_PROCESS', startedAt: new Date(start - 3600_000), ...options.root });
  const reference = { businessType: root.businessType, businessId: root.id };
  let task = await prisma.$transaction(tx => entry.withContext(tx, { type: 'SYSTEM' }, [reference], randomUUID(), async context =>
    (await entry.enterStage(context, { ...reference, stage: root.allowedStage as Task['stage'], entryKey: 'isolated:deadline', reason: '隔离期限阶段进入' })).task));
  if (options.dueAt !== undefined) task = await prisma.task.update({ where: { id: task.id }, data: { dueAt: options.dueAt, originalDueAt: options.dueAt } });
  await prisma.$executeRaw`INSERT INTO task_deadline_fixture(task_id,due_at,payment_due_at,application_window_at,receipt_base_due_at,actual_handover_at)
    VALUES(${task.id}::uuid,${task.dueAt},${new Date(start + 30 * 60_000)},${new Date(start + 7 * 86400_000)},${new Date(start + 10 * 86400_000)},${new Date(start - 86400_000)})`;
  return task;
}
async function http<T = Result>(path: string, options: { body?: unknown; person?: Person; token?: string | null; status?: number } = {}) {
  const token = options.token === undefined ? (options.person ?? manager).token : options.token;
  const response = await fetch(base + path, { method: options.body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
  const result = await response.json() as { data: T; code: string; requestId: string }; expect(response.status, JSON.stringify(result)).toBe(options.status ?? 200);
  expect(result.requestId).toBe(response.headers.get('x-request-id')); if (response.ok) expect(response.headers.get('cache-control')).toBe('no-store');
  for (const secret of [passwordHash, manager.token, warehouse.token]) expect(JSON.stringify(result)).not.toContain(secret); return result;
}
const later = (amount = 3600_000) => new Date(millis + amount).toISOString();
const input = (version = 0, newDueAt = later(), reason = '进一步核实服装业务') => ({ expectedVersion: version, newDueAt, reason });
const extend = (task: Task, body = input(task.version), status = 200, who = manager) => http(`/admin/tasks/${task.id}/extend-deadline`, { body, status, person: who });
const direct = (task: Task, body = input(task.version), who = manager) => service.extend(who.identity, who.token, task.id, body, randomUUID());
const claim = (task: Task, who = warehouse) => commands.claim(who.identity, who.token, task.id, { expectedVersion: task.version }, randomUUID());
async function state() {
  return { tasks: await prisma.task.findMany({ orderBy: { id: 'asc' } }), cursors: await prisma.taskStageCursor.findMany({ orderBy: { id: 'asc' } }),
    events: await prisma.deadlineEvent.findMany({ orderBy: { id: 'asc' } }), history: await prisma.taskHistory.findMany({ orderBy: { id: 'asc' } }),
    audit: await prisma.auditLog.findMany({ orderBy: { id: 'asc' } }), domain: await prisma.$queryRaw`SELECT * FROM task_deadline_fixture ORDER BY task_id`,
    handlers: await prisma.$queryRaw`SELECT * FROM task_handoff_fixture ORDER BY task_id`, roots: await prisma.$queryRaw`SELECT * FROM task_entry_fixture ORDER BY id` };
}
async function protectedDomain(task: Task) { return prisma.$queryRaw`SELECT payment_due_at,application_window_at,receipt_base_due_at,actual_handover_at FROM task_deadline_fixture WHERE task_id=${task.id}::uuid`; }
function barrier() { let release!: () => void; let signal!: () => void; const held = new Promise<void>(yes => { release = yes; }); const ready = new Promise<void>(yes => { signal = yes; }); return { release, signal, held, ready }; }
async function waitBlocked(pid: number, count = 1) {
  const until = performance.now() + 500;
  while (performance.now() < until) {
    const result = await admin.query(`WITH RECURSIVE blocked(pid) AS (SELECT pid FROM pg_stat_activity WHERE datname=$1 AND $2=ANY(pg_blocking_pids(pid))
      UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid=ANY(pg_blocking_pids(a.pid)) WHERE a.datname=$1) SELECT count(*)::int AS count FROM blocked`, [target.testName, pid]);
    if (result.rows[0].count >= count) return; await new Promise(yes => setTimeout(yes, 5));
  }
  throw new Error('未观察到延期真实锁等待');
}
async function holdRoot(task: Task) { await holder.query('BEGIN'); const pid = Number((await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
  await holder.query('SELECT id FROM task_entry_fixture WHERE id=$1 FOR UPDATE', [task.businessId]); return pid; }

it('已领任务延期同步领域截止，保留经办/轮次/原截止/规则及所有固定计时事实', async () => {
  const task = await makeTask({ dueAt: new Date(start + 30 * 60_000) }); await claim(task);
  const claimed = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
  const originalDomain = await protectedDomain(task); const response = await extend(task, input(1, later(), ' 进一步核实 '));
  expect(response.data).toMatchObject({ changed: true, task: { status: 'CLAIMED', round: 1, version: 2, assignee: { id: warehouse.identity.subjectId },
    originalDueAt: task.originalDueAt?.toISOString(), dueAt: later(), isCurrentlyOverdue: false, hasEverOverdue: false } });
  expect(response.data.task.allowedActions).toContain('extendDeadline');
  const saved = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
  expect({ ...saved, dueAt: claimed.dueAt, version: claimed.version }).toEqual(claimed); expect(await protectedDomain(task)).toEqual(originalDomain);
  expect(await prisma.$queryRaw`SELECT due_at,extension_count FROM task_deadline_fixture WHERE task_id=${task.id}::uuid`).toEqual([{ due_at: new Date(later()), extension_count: 1 }]);
  const event = await prisma.deadlineEvent.findFirstOrThrow({ where: { taskId: task.id, eventType: 'EXTENDED' } });
  expect(event).toMatchObject({ deadlineAt: task.dueAt, newDueAt: new Date(later()), occurredAt: clock(), detectedAt: clock(), actorEmployeeId: manager.identity.subjectId, reason: '进一步核实' });
  expect(await prisma.taskHistory.findFirst({ where: { taskId: task.id, action: 'DEADLINE_CHANGED' } })).toMatchObject({ fromAssigneeId: warehouse.identity.subjectId, toAssigneeId: warehouse.identity.subjectId, beforeStatus: 'CLAIMED', afterStatus: 'CLAIMED', requestId: event.requestId });
  expect(await prisma.auditLog.findFirst({ where: { requestId: event.requestId, action: 'task.deadline.extend' } })).toMatchObject({ actorEmployeeId: manager.identity.subjectId, reason: '进一步核实' });
});
it('无SLA首次指定保留originalDueAt=null，DEADLINE_ASSIGNED两个截止均取新指定值', async () => {
  const task = await makeTask(); expect(task.dueAt).toBeNull(); await extend(task);
  expect(await prisma.task.findUnique({ where: { id: task.id } })).toMatchObject({ originalDueAt: null, dueAt: new Date(later()), round: 1, status: 'OPEN', assigneeId: null, version: 1 });
  expect(await prisma.deadlineEvent.findFirst({ where: { taskId: task.id } })).toMatchObject({ eventType: 'DEADLINE_ASSIGNED', deadlineAt: new Date(later()), newDueAt: new Date(later()) });
  expect(await prisma.deadlineEvent.count({ where: { eventType: 'OVERDUE' } })).toBe(0);
});
it.each([-1, 0, 1])('旧截止相对当前%d毫秒，等号也补记逾期，发生时间为真实旧截止', async offset => {
  const task = await makeTask({ dueAt: new Date(start + offset) }); const result = await extend(task);
  expect(result.data.task).toMatchObject({ isCurrentlyOverdue: false, hasEverOverdue: offset <= 0 });
  const events = await prisma.deadlineEvent.findMany({ where: { eventType: 'OVERDUE' } }); expect(events).toHaveLength(offset <= 0 ? 1 : 0);
  if (events[0]) { expect(events[0]).toMatchObject({ deadlineAt: task.dueAt, occurredAt: task.dueAt, detectedAt: clock() });
    expect(await prisma.task.findUnique({ where: { id: task.id } })).toMatchObject({ firstOverdueAt: task.dueAt, everOverdue: true }); }
});
it('多次延期每个真实截止各留一条OVERDUE，最早逾期和原截止不变', async () => {
  const task = await makeTask({ dueAt: new Date(start - 60_000) }); const first = start + 30 * 60_000; await extend(task, input(0, new Date(first).toISOString()));
  millis = first; const second = millis + 30 * 60_000; await extend(task, input(1, new Date(second).toISOString()));
  millis = second; await extend(task, input(2, later(30 * 60_000)));
  expect(await prisma.task.findUnique({ where: { id: task.id } })).toMatchObject({ firstOverdueAt: task.dueAt, originalDueAt: task.dueAt, everOverdue: true, round: 1, version: 3 });
  const overdue = await prisma.deadlineEvent.findMany({ where: { taskId: task.id, eventType: 'OVERDUE' }, orderBy: { deadlineAt: 'asc' } });
  expect(overdue.map(row => row.deadlineAt.getTime())).toEqual([start - 60_000, first, second]);
});
it('已有同截止逾期事件即使语义键不同也不重复，保留更早firstOverdueAt', async () => {
  const task = await makeTask({ dueAt: new Date(start - 1) }); const earlier = new Date(start - 60_000);
  await prisma.task.update({ where: { id: task.id }, data: { everOverdue: true, firstOverdueAt: earlier } });
  await prisma.deadlineEvent.create({ data: { taskId: task.id, eventType: 'OVERDUE', deadlineAt: task.dueAt!, occurredAt: task.dueAt!, detectedAt: clock(), actorType: 'SYSTEM', commandKey: 'isolated:existing-event', requestId: randomUUID() } });
  await extend(task); expect(await prisma.deadlineEvent.count({ where: { taskId: task.id, eventType: 'OVERDUE' } })).toBe(1);
  expect(await prisma.auditLog.count({ where: { action: 'task.overdue.record' } })).toBe(0);
  expect(await prisma.task.findUnique({ where: { id: task.id } })).toMatchObject({ firstOverdueAt: earlier, everOverdue: true });
});
it('外部等待阶段同步真实领域截止，不更改快照或采用新全店设置', async () => {
  const task = await makeTask({ root: { businessType: 'AFTER_SALE', allowedStage: 'SUPPLEMENT_FOLLOW' } });
  await prisma.$executeRaw`UPDATE task_deadline_fixture SET timer_kind='EXTERNAL_WAIT' WHERE task_id=${task.id}::uuid`;
  await configure(); const newDueAt = new Date(task.dueAt!.getTime() + 86400_000).toISOString(); await extend(task, input(0, newDueAt));
  expect(await prisma.task.findUnique({ where: { id: task.id } })).toMatchObject({ dueAt: new Date(newDueAt), originalDueAt: task.dueAt, settingsVersionId: task.settingsVersionId, ruleSnapshot: task.ruleSnapshot });
  expect(await prisma.$queryRaw`SELECT due_at FROM task_deadline_fixture WHERE task_id=${task.id}::uuid`).toEqual([{ due_at: new Date(newDueAt) }]);
});
it('同主体/旧版本/规范化截止与原因重放changed=false，领域/事件/审计完全不再写', async () => {
  const task = await makeTask(); const body = input(0, later(), ' 首次安排 '); await extend(task, body); const before = await state();
  const response = await extend(task, { ...body, newDueAt: body.newDueAt.replace('.000Z', 'Z'), reason: '首次安排' }); expect(response.data.changed).toBe(false); expect(await state()).toEqual(before);
  millis += 3600_000; expect((await extend(task, body)).data.changed).toBe(false); expect(await state()).toEqual(before);
});
it('更换原因、目标截止、操作者或发生其它版本变化不能重放旧延期', async () => {
  const task = await makeTask(); const body = input(); await extend(task, body); const before = await state();
  for (const next of [{ ...body, reason: '不同原因' }, { ...body, newDueAt: later(7200_000) }]) expect((await extend(task, next, 409)).code).toBe('VERSION_CONFLICT');
  expect((await extend(task, body, 409, otherManager)).code).toBe('VERSION_CONFLICT'); expect(await state()).toEqual(before);
  await claim({ ...task, version: 1 }); expect((await extend(task, body, 409)).code).toBe('VERSION_CONFLICT');
});
it.each(['COMPLETED', 'CANCELLED'] as const)('%s不能延期或首次指定', async status => {
  const task = await makeTask(); await prisma.task.update({ where: { id: task.id }, data: { status, closedAt: clock() } }); const before = await state();
  expect((await extend(task, input(), 409)).code).toBe('TASK_DEADLINE_BLOCKED'); expect(await state()).toEqual(before);
});
it('暂停默认由领域拒绝；明确允许人工期限时可延但不恢复或重新分派', async () => {
  const task = await makeTask(); await prisma.task.update({ where: { id: task.id }, data: { status: 'SUSPENDED' } });
  expect((await extend(task, input(), 409)).code).toBe('TASK_DEADLINE_BLOCKED');
  await prisma.$executeRaw`UPDATE task_deadline_fixture SET allow_when_suspended=true WHERE task_id=${task.id}::uuid`;
  expect((await extend(task)).data.task).toMatchObject({ status: 'SUSPENDED', assignee: null, round: 1, version: 1 });
});
it.each(['PAYMENT', 'APPLICATION_WINDOW', 'AUTO_RECEIPT'])('领域%s固定业务计时不允许通过人工任务延期', async kind => {
  const task = await makeTask(); await prisma.$executeRaw`UPDATE task_deadline_fixture SET timer_kind=${kind} WHERE task_id=${task.id}::uuid`; const before = await state();
  expect((await extend(task, input(), 409)).code).toBe('TASK_DEADLINE_BLOCKED'); expect(await state()).toEqual(before);
});
it('领域未支持该阶段或缺少期限接入时明确拒绝，不只修改任务列表', async () => {
  const task = await makeTask(); await prisma.$executeRaw`UPDATE task_deadline_fixture SET allow_extend=false WHERE task_id=${task.id}::uuid`; const before = await state();
  expect((await extend(task, input(), 409)).code).toBe('TASK_DEADLINE_BLOCKED');
  const spy = vi.spyOn(adapters, 'getDeadline').mockReturnValue(undefined);
  try { expect((await extend(task, input(), 409)).code).toBe('BUSINESS_MODULE_NOT_READY'); } finally { spy.mockRestore(); }
  expect(await state()).toEqual(before);
});
it.each(['warehouse', 'support', 'password', 'anonymous', 'customer'] as const)('延期拒绝身份/权限%s', async condition => {
  const task = await makeTask(); const before = await state();
  if (condition === 'password') await prisma.employee.update({ where: { id: manager.identity.subjectId }, data: { mustChangePassword: true } });
  const token = condition === 'anonymous' ? null : condition === 'customer' ? customerToken : undefined;
  const person = condition === 'warehouse' ? warehouse : condition === 'support' ? support : manager;
  await http(`/admin/tasks/${task.id}/extend-deadline`, { body: input(), person, ...(token !== undefined ? { token } : {}), status: ['anonymous', 'customer'].includes(condition) ? 401 : 403 });
  expect(await state()).toEqual(before);
});
it('管理员仍需真实业务读取权，不存在和不可见都404', async () => {
  const task = await makeTask(); await prisma.$executeRaw`UPDATE task_entry_fixture SET reader_employee_id=${warehouse.identity.subjectId}::uuid WHERE id=${task.businessId}::uuid`; const before = await state();
  expect((await extend(task, input(), 404)).code).toBe('TASK_NOT_FOUND'); await http(`/admin/tasks/${randomUUID()}/extend-deadline`, { body: input(), status: 404 }); expect(await state()).toEqual(before);
});
it.each(['same', 'earlier', 'now', 'past'] as const)('截止%s不晚于现截止/现在时409，原值不变', async condition => {
  const task = await makeTask({ dueAt: new Date(start + 1800_000) }); const dueAt = condition === 'same' ? task.dueAt! : new Date(start + (condition === 'earlier' ? 900_000 : condition === 'now' ? 0 : -1));
  const before = await state(); expect((await extend(task, input(0, dueAt.toISOString()), 409)).code).toBe('TASK_DEADLINE_NOT_LATER'); expect(await state()).toEqual(before);
});
it.each([{ newDueAt: '2026-02-30T02:00:00Z' }, { newDueAt: '2026-11-20T02:00:00' }, { newDueAt: '2026-11-20T10:00:00+08:00' },
  { newDueAt: 1795130400000 }, { newDueAt: '2026-11-20T02:00:00.0001Z' }, { expectedVersion: '0' }, { reason: ' ' },
  { dueAt: '2026-11-20T02:00:00Z' }, { originalDueAt: '2026-11-20T02:00:00Z' }, { newDueAt: null }])('HTTP严格拒绝非法字段/格式%s', async patch => {
  const task = await makeTask(); const before = await state(); await http(`/admin/tasks/${task.id}/extend-deadline`, { body: { ...input(), ...patch }, status: 400 }); expect(await state()).toEqual(before);
});
it('HTTP漏截止必填，不接受客户端改经办、状态或轮次', async () => {
  const task = await makeTask(); const before = await state(); await http(`/admin/tasks/${task.id}/extend-deadline`, { body: { expectedVersion: 0, reason: '缺少截止' }, status: 400 });
  await http(`/admin/tasks/${task.id}/extend-deadline`, { body: { ...input(), assigneeId: manager.identity.subjectId, status: 'OPEN', round: 2 }, status: 400 }); expect(await state()).toEqual(before);
});
it.each(['domain', 'overdueAudit', 'event', 'history', 'audit'] as const)('%s真实写后故障时领域截止/任务/旧逾期/延期/历史/审计全部回滚', async phase => {
  const task = await makeTask({ dueAt: new Date(start - 1) }); const before = await state();
  if (phase === 'domain') adapters.onExtend = async () => { throw new Error('隔离领域截止同步后故障'); };
  if (phase === 'overdueAudit') audit.failAction = 'task.overdue.record'; if (phase === 'audit') audit.failAction = 'task.deadline.extend';
  const original = prisma.$transaction.bind(prisma); let observed = false;
  const spy = vi.spyOn(prisma, '$transaction').mockImplementation(((command: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => original(async tx => {
    const proxy = new Proxy(tx, { get(client, key) {
      if (!((phase === 'event' && key === 'deadlineEvent') || (phase === 'history' && key === 'taskHistory'))) return Reflect.get(client, key);
      const model = Reflect.get(client, key) as unknown as { create: (input: { data: Record<string, unknown> }) => Promise<unknown> };
      return new Proxy(model, { get(delegate, method) { if (method !== 'create') return Reflect.get(delegate, method);
        return async (arg: { data: Record<string, unknown> }) => { const result = await delegate.create(arg);
          if (arg.data.eventType === 'EXTENDED' || arg.data.action === 'DEADLINE_CHANGED') { observed = true; throw new Error('隔离事件/历史实际写后故障'); } return result; }; } });
    } }); return command(proxy);
  }, options)) as typeof prisma.$transaction);
  try { await extend(task, input(), 500); } finally { spy.mockRestore(); }
  if (['event', 'history'].includes(phase)) expect(observed).toBe(true); if (['overdueAudit', 'audit'].includes(phase)) expect(audit.observed).toBe(true);
  expect(await state()).toEqual(before);
});
it.each(['check', 'write'] as const)('领域%s等待期间凭证到期拒绝，已写领域截止也回滚', async phase => {
  const task = await makeTask(); const before = await state(); const expire = async () => { millis += 7200_000; };
  if (phase === 'check') adapters.onDeadlineCheck = expire; else adapters.onExtend = expire;
  await extend(task, input(), 401); expect(await state()).toEqual(before);
});
it('领域同步等待后新截止已到等号，最终复核409并回滚领域写入', async () => {
  const task = await makeTask(); const body = input(); const before = await state(); adapters.onExtend = async () => { millis = Date.parse(body.newDueAt); };
  expect((await extend(task, body, 409)).code).toBe('TASK_DEADLINE_NOT_LATER'); expect(await state()).toEqual(before);
});
it('领域等待跨过旧截止，最终写入前按新服务器时刻补记真实逾期', async () => {
  const task = await makeTask({ dueAt: new Date(start + 60_000) }); adapters.onExtend = async () => { millis += 60_000; };
  await extend(task); expect(await prisma.deadlineEvent.findFirst({ where: { eventType: 'OVERDUE' } })).toMatchObject({ occurredAt: task.dueAt, detectedAt: clock() });
});
it.each([{ role: 'CUSTOMER_SERVICE' as const, code: 'TASK_NOT_FOUND' }, { role: 'MERCH_WAREHOUSE' as const, code: 'FORBIDDEN' }])('预定位后真实调岗为$role，持锁后使用最新范围和权限拒绝延期', async change => {
  const task = await makeTask(); const gate = barrier(); let plans = 0; adapters.onPlan = async () => { if (++plans === 1) { gate.signal(); await gate.held; } };
  const pending = direct(task); const settled = Promise.allSettled([pending]); await gate.ready;
  try { await app.get(EmployeeRoleService).change(otherManager.identity, otherManager.token, manager.identity.subjectId,
    { expectedVersion: 0, role: change.role, reason: '隔离真实调岗竞争' }, randomUUID()); } finally { gate.release(); }
  // 从未参与且失去完整资格时不可见即404；仍能读该任务但失去管理员延期权时403。
  expect((await settled)[0]).toMatchObject({ status: 'rejected', reason: { code: change.code } });
  expect(await prisma.deadlineEvent.count()).toBe(0); expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).version).toBe(0);
});
it.each(['different', 'same'] as const)('两个独立事务%s参数争延，同旧版本只写一次，重放按主体约束', async mode => {
  const task = await makeTask(); const pid = await holdRoot(task);
  const one = direct(task); const two = direct(task, input(0, later(mode === 'same' ? 3600_000 : 7200_000)), mode === 'same' ? manager : otherManager);
  const settled = Promise.allSettled([one, two]);
  try { await waitBlocked(pid, 2); } finally { await holder.query('COMMIT'); }
  const results = await settled; const fulfilled = results.filter(row => row.status === 'fulfilled');
  expect(fulfilled).toHaveLength(mode === 'same' ? 2 : 1);
  if (mode === 'same') expect(fulfilled.map(row => row.value.changed).sort()).toEqual([false, true]);
  else expect(results.find(row => row.status === 'rejected')).toMatchObject({ reason: { code: 'VERSION_CONFLICT' } });
  expect(await prisma.deadlineEvent.count()).toBe(1); expect(await prisma.taskHistory.count({ where: { action: 'DEADLINE_CHANGED' } })).toBe(1);
  expect(await prisma.$queryRaw`SELECT extension_count FROM task_deadline_fixture WHERE task_id=${task.id}::uuid`).toEqual([{ extension_count: 1 }]);
});
it('延期和领取争同版本，候选经办变化须重新定位且只接受一个命令', async () => {
  const task = await makeTask(); const pid = await holdRoot(task); const pending = Promise.allSettled([direct(task), claim(task)]);
  try { await waitBlocked(pid, 2); } finally { await holder.query('COMMIT'); }
  const result = await pending; expect(result.filter(row => row.status === 'fulfilled')).toHaveLength(1);
  expect(result.find(row => row.status === 'rejected')).toMatchObject({ reason: { code: 'VERSION_CONFLICT' } });
  expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).version).toBe(1);
});
it('延期先持经办锁，随后停用同步回池仍保留新截止', async () => {
  const task = await makeTask(); await claim(task); const pid = await holdRoot(task); const body = input(1);
  const extended = direct(task, body); const settledExtension = Promise.allSettled([extended]); await waitBlocked(pid);
  const disabled = app.get(EmployeeStatusService).change(manager.identity, manager.token, warehouse.identity.subjectId, 'DISABLED', { expectedVersion: 0, reason: '隔离停用竞争' }, randomUUID());
  const settledDisable = Promise.allSettled([disabled]); try { await waitBlocked(pid, 2); } finally { await holder.query('COMMIT'); }
  expect((await settledExtension)[0]?.status).toBe('fulfilled'); expect((await settledDisable)[0]?.status).toBe('fulfilled');
  expect(await prisma.task.findUnique({ where: { id: task.id } })).toMatchObject({ status: 'OPEN', assigneeId: null, reassignNeeded: true, dueAt: new Date(body.newDueAt), originalDueAt: null, version: 3 });
});
it('上游顾客集合变化整笔重试，仅最终一次同步领域和期限事件', async () => {
  const task = await makeTask(); const other = await prisma.customer.create({ data: { phone: '19900000082', nickname: '隔离上游顾客', passwordHash } }); let plans = 0;
  adapters.onPlan = async () => { if (++plans === 1) await prisma.$executeRaw`UPDATE task_entry_fixture SET customer_id=${other.id}::uuid WHERE id=${task.businessId}::uuid`; };
  await extend(task); expect(plans).toBe(4); expect(await prisma.deadlineEvent.count()).toBe(1);
  expect(await prisma.$queryRaw`SELECT extension_count FROM task_deadline_fixture WHERE task_id=${task.id}::uuid`).toEqual([{ extension_count: 1 }]);
});
it('版本达到上限拒绝延期，不溢出或留下领域变更', async () => {
  let task = await makeTask(); task = await prisma.task.update({ where: { id: task.id }, data: { version: 2147483647 } }); const before = await state();
  expect((await extend(task, input(2147483647), 409)).code).toBe('TASK_VERSION_EXHAUSTED'); expect(await state()).toEqual(before);
});
it('详情、摘要与统一时间线显示历史逾期和延期，新截止下当前逾期恢复false且原因按权限裁剪', async () => {
  const task = await makeTask({ dueAt: new Date(start - 1) }); await extend(task);
  const detail = await http<Awaited<ReturnType<TaskQueryService['detail']>>>(`/admin/tasks/${task.id}`);
  expect(detail.data).toMatchObject({ originalDueAt: task.originalDueAt?.toISOString(), isCurrentlyOverdue: false, hasEverOverdue: true, latestDeadlineEvent: { eventType: 'EXTENDED' } });
  const history = await http<Awaited<ReturnType<TaskQueryService['history']>>>(`/admin/tasks/${task.id}/history?pageSize=100`);
  expect(history.data.items.filter(row => row.kind === 'DEADLINE_EVENT').map(row => row.eventType).sort()).toEqual(['EXTENDED', 'OVERDUE']);
  expect(history.data.items.some(row => row.kind === 'TASK_CHANGE' && row.action === 'DEADLINE_CHANGED')).toBe(true);
  await prisma.$executeRaw`UPDATE task_entry_fixture SET hidden_reason=true WHERE id=${task.businessId}::uuid`;
  const hidden = await http<Awaited<ReturnType<TaskQueryService['history']>>>(`/admin/tasks/${task.id}/history?pageSize=100`); expect(hidden.data.items.every(row => row.reason === null)).toBe(true);
  const summary = await http<Awaited<ReturnType<TaskQueryService['summary']>>>('/admin/tasks/summary'); expect(summary.data).toMatchObject({ currentOverdue: 0, everOverdue: 1 });
});
it('延期沿用员工→顾客→订单→SKU→售后→Cursor→Task锁序', async () => {
  const order = await createFixture(prisma, customerId, { businessType: 'ORDER', allowedStage: 'SHIPMENT_PROCESS' }); const sku = randomUUID();
  await prisma.$executeRaw`INSERT INTO task_entry_fixture_resource(id,kind) VALUES(${sku}::uuid,'SKU_STOCK')`;
  const task = await makeTask({ root: { businessType: 'AFTER_SALE', allowedStage: 'SUPPLEMENT_FOLLOW', orderId: order.id, extraLocks: [{ kind: 'SKU_STOCK', id: sku }] } });
  const trace: LockObservation[] = []; const original = prisma.$transaction.bind(prisma);
  const spy = vi.spyOn(prisma, '$transaction').mockImplementation(((command: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => original(tx => command(observeLocks(tx, trace)), options)) as typeof prisma.$transaction);
  try { await direct(task, input(0, new Date(task.dueAt!.getTime() + 86400_000).toISOString())); } finally { spy.mockRestore(); }
  expect(trace).toEqual([{ table: 'employee', ids: [manager.identity.subjectId] }, { table: 'customer', ids: [customerId] },
    { table: 'task_entry_fixture', ids: [order.id] }, { table: 'task_entry_fixture_resource', ids: [sku] }, { table: 'task_entry_fixture', ids: [task.businessId] },
    { table: 'task_stage_cursor', ids: [task.cursorId] }, { table: 'task', ids: [task.id] }]);
});
