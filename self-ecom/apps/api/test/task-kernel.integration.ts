// 作用：专属PostgreSQL库验证扫描、多来源/生命周期及BR-05事务端口；真实锁/身份/审计不作Mock。
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
import { OrderTimerAdapter } from '../src/orders/order-timer.adapter.js';
import { OrderAdapters } from '../src/orders/order.adapters.js';
import { InventoryAdapters } from '../src/inventory/inventory.adapters.js';
import { AuditService, type AuditPayload } from '../src/audit/audit.service.js';
import { AuthSessionService } from '../src/auth/auth-session.service.js';
import { CurrentIdentityService } from '../src/auth/current-identity.service.js';
import { JwtTokenService } from '../src/auth/jwt-token.service.js';
import { PasswordService } from '../src/auth/password.service.js';
import { Clock } from '../src/common/time/clock.js';
import { APP_CONFIG, loadConfiguration } from '../src/config/environment.js';
import { PermissionService } from '../src/permissions/permission.service.js';
import { seedPermissionCatalog } from '../src/permissions/permission-seed.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { TaskBusinessAdapters, type TaskBusinessReference } from '../src/tasks/task-business-adapters.js';
import { TaskCommandService } from '../src/tasks/task-command.service.js';
import { TaskDeadlineService } from '../src/tasks/task-deadline.service.js';
import { TaskEntryService, type TaskActorAccess, type TaskEntryContext } from '../src/tasks/task-entry.service.js';
import { TaskLifecycleService, type TaskTransition, type TaskTransitionInput } from '../src/tasks/task-lifecycle.service.js';
import { TaskSourceService, type TaskSourceInput } from '../src/tasks/task-source.service.js';
import type { TaskSourceReference } from '../src/tasks/task-source.contract.js';
import { OrderTimerRepositories, OrderTimerService } from '../src/tasks/order-timer.service.js';
import type { OrderTimerCommand, OrderTimerState } from '../src/tasks/order-timer.rules.js';
import { TaskOverdueScanService } from '../src/tasks/task-overdue-scan.service.js';
import { FixtureKernelAdapters, installKernelFixture } from './fixtures/task-kernel-business.js';
import { createFixture, observeLocks, type LockObservation } from './fixtures/task-entry-business.js';

const safe = assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('内核验证仅限test');
const url = new URL(safe.testUrl); url.pathname = `/task_kernel_${randomUUID().replaceAll('-', '')}_test`;
const target = assertSafeTestDatabase(safe.developmentUrl, url.toString()); if (!/^task_kernel_[a-f0-9]{32}_test$/.test(target.testName)) throw new Error('专属库名不合法');
const server = new URL(safe.testUrl); server.pathname = '/postgres'; const admin = new Client({ connectionString: server.toString() }); const holder = new Client({ connectionString: target.testUrl });
const date = (day: number) => new Date(`2026-11-${String(day).padStart(2, '0')}T02:00:00.000Z`); let now = +date(18); const clock = () => new Date(now);
const tokens = new JwtTokenService({ secret: 'isolated-task-kernel-key-2026-'.repeat(3), ttlSeconds: 7200 }, clock);
const sessions = new AuthSessionService(tokens, clock); const identities = new CurrentIdentityService(tokens, new PermissionService(), clock);
const adapters = new FixtureKernelAdapters();
class ControlledAudit extends AuditService {
  failAction = ''; observed = false;
  override async appendAudit(tx: Prisma.TransactionClient, payload: AuditPayload) {
    await super.appendAudit(tx, payload);
    if (payload.action === this.failAction) { this.observed = await tx.auditLog.count({ where: { requestId: payload.requestId, action: payload.action } }) > 0; throw new Error('隔离内核审计真实写后故障'); }
  }
}
const audit = new ControlledAudit(); let app: INestApplication; let prisma: PrismaService; let entry: TaskEntryService; let lifecycle: TaskLifecycleService;
let sources: TaskSourceService; let timer: OrderTimerService; let scanner: TaskOverdueScanService; let commands: TaskCommandService; let deadline: TaskDeadlineService;
let created = false; let hash = ''; let customerId = ''; let employee: TaskActorAccess; let warehouse: TaskActorAccess;
const system = { type: 'SYSTEM' } as const;
beforeAll(async () => {
  await admin.connect(); await admin.query(`CREATE DATABASE "${target.testName}" ENCODING 'UTF8' TEMPLATE template0`); created = true;
  runPrisma(['migrate', 'deploy'], { ...process.env, DATABASE_URL: target.testUrl });
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(APP_CONFIG).useValue(loadConfiguration({ ...process.env, DATABASE_URL: target.testUrl, LOG_LEVEL: 'silent' }))
    .overrideProvider(JwtTokenService).useValue(tokens).overrideProvider(AuthSessionService).useValue(sessions).overrideProvider(CurrentIdentityService).useValue(identities)
    .overrideProvider(Clock).useValue({ now: clock }).overrideProvider(TaskBusinessAdapters).useValue(adapters).overrideProvider(AuditService).useValue(audit).overrideProvider(OrderTimerAdapter).useValue({onModuleInit(){ /* 本文件独立验证暂停计时端口。 */ }}).overrideProvider(OrderAdapters).useValue({onModuleInit(){ /* 任务内核隔离测试使用本文件的父事实夹具；真实订单接通由orders.integration覆盖。 */ }}).overrideProvider(InventoryAdapters).useValue({onModuleInit(){ /* 本文件用真实SQL父事实夹具统一替代业务适配器，库存正式注册由库存集成测试验证。 */ }}).compile();
  app = module.createNestApplication(); await app.init(); prisma = app.get(PrismaService); entry = app.get(TaskEntryService); lifecycle = app.get(TaskLifecycleService);
  sources = app.get(TaskSourceService); timer = app.get(OrderTimerService); scanner = app.get(TaskOverdueScanService); commands = app.get(TaskCommandService); deadline = app.get(TaskDeadlineService);
  app.get(OrderTimerRepositories).register(adapters.timerRepository); await holder.connect(); await prisma.$transaction(installKernelFixture); await seedPermissionCatalog(prisma);
  hash = await new PasswordService().hash('IsolatedKernel#2026');
}, 45_000);
async function person(role: EmployeeRole): Promise<TaskActorAccess> {
  const row = await prisma.employee.create({ data: { username: 'tk_' + randomUUID().replaceAll('-', '').slice(0, 20), displayName: '隔离内核员工', role, passwordHash: hash, mustChangePassword: false } });
  const session = await prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx, { subjectType: 'EMPLOYEE', subjectId: row.id, expectedPasswordHash: hash, expectedTokenVersion: 0 }));
  return { type: 'EMPLOYEE', subjectId: row.id, token: session.accessToken };
}
beforeEach(async () => {
  now = +date(18); audit.failAction = ''; audit.observed = false; adapters.onTransitionCheck = undefined; adapters.onTransitionWrite = undefined; adapters.onSourceWrite = undefined;
  adapters.onTimerWrite = undefined; adapters.onAuthorize = undefined; adapters.onPlan = undefined;
  await prisma.schedulerFailure.deleteMany(); await prisma.schedulerRun.deleteMany();
  for (const name of ['kernel_timer_history', 'kernel_timer_command', 'kernel_timer_block', 'kernel_timer_pause', 'kernel_timer_order', 'kernel_source_history', 'kernel_task_source', 'kernel_domain_source', 'task_deadline_fixture', 'task_handoff_fixture']) await prisma.$executeRawUnsafe(`DELETE FROM ${name}`);
  await prisma.deadlineEvent.deleteMany(); await prisma.taskHistory.deleteMany(); await prisma.task.deleteMany(); await prisma.taskStageCursor.deleteMany();
  await prisma.$executeRawUnsafe('DELETE FROM task_entry_fixture'); await prisma.$executeRawUnsafe('DELETE FROM task_entry_fixture_resource');
  await prisma.auditLog.deleteMany(); await prisma.authSession.deleteMany(); await prisma.employee.deleteMany(); await prisma.customer.deleteMany();
  employee = await person('SUPER_ADMIN'); warehouse = await person('MERCH_WAREHOUSE');
  customerId = (await prisma.customer.create({ data: { phone: '19900000091', nickname: '隔离内核顾客', passwordHash: hash } })).id;
});
afterAll(async () => {
  await holder.end(); await app?.close();
  try { if (created) { assertSafeTestDatabase(safe.developmentUrl, target.testUrl); await admin.query(`DROP DATABASE "${target.testName}"`); console.info('步骤9专属内核库已删除'); } } finally { await admin.end(); }
}, 20_000);
const ref = (task: Task): TaskBusinessReference => ({ businessType: task.businessType, businessId: task.businessId });
const business = (root: TaskBusinessReference, command: (context: TaskEntryContext) => Promise<unknown>, access: TaskActorAccess = system, trace?: LockObservation[]) =>
  prisma.$transaction(tx => entry.withContext(trace ? observeLocks(tx, trace) : tx, access, [root], randomUUID(), command), { timeout: 5000 });
async function makeTask(dueAt: Date | null = null) {
  const root = await createFixture(prisma, customerId, { businessType: 'ORDER', allowedStage: 'SHIPMENT_PROCESS', startedAt: date(10) }); let task!: Task;
  await business({ businessType: 'ORDER', businessId: root.id }, async context => { task = (await entry.enterStage(context, { businessType: 'ORDER', businessId: root.id, stage: 'SHIPMENT_PROCESS', entryKey: 'kernel:initial', reason: '隔离内核阶段' })).task; });
  task = await prisma.task.update({ where: { id: task.id }, data: { dueAt, originalDueAt: dueAt } });
  await prisma.$executeRaw`INSERT INTO task_deadline_fixture(task_id,due_at,payment_due_at,application_window_at,receipt_base_due_at,actual_handover_at) VALUES(${task.id}::uuid,${dueAt},${date(19)},${date(20)},${date(20)},${date(10)})`; return task;
}
async function realSource(orderId: string, sourceType: TaskSourceReference['sourceType'] = 'AFTER_SALE'): Promise<TaskSourceReference> {
  const id = randomUUID(); await prisma.$executeRaw`INSERT INTO kernel_domain_source(id,order_id,source_type) VALUES(${id}::uuid,${orderId}::uuid,${sourceType})`; return { sourceType, sourceId: id };
}
const transitionInput = (task: Task, action: TaskTransition, patch: Partial<TaskTransitionInput> = {}): TaskTransitionInput => ({ ...ref(task), taskId: task.id, action, expectedVersion: task.version, commandKey: randomUUID(), reason: '隔离生命周期', ...patch });
const transition = (task: Task, action: TaskTransition, patch: Partial<TaskTransitionInput> = {}, who: TaskActorAccess = system) => business(ref(task), context => lifecycle.transition(context, transitionInput(task, action, patch)), who);
const sourceInput = (task: Task, source: TaskSourceReference, patch: Partial<TaskSourceInput> = {}): TaskSourceInput => ({ ...ref(task), ...source, taskId: task.id, expectedVersion: task.version, commandKey: randomUUID(), reason: '隔离来源变化', ...patch });
async function state() {
  const result: Record<string, unknown> = { tasks: await prisma.task.findMany({ orderBy: { id: 'asc' } }), history: await prisma.taskHistory.findMany({ orderBy: { id: 'asc' } }),
    deadlines: await prisma.deadlineEvent.findMany({ orderBy: { id: 'asc' } }), audits: await prisma.auditLog.findMany({ orderBy: { id: 'asc' } }) };
  for (const name of ['task_entry_fixture', 'task_handoff_fixture', 'kernel_task_source', 'kernel_source_history', 'kernel_timer_order', 'kernel_timer_block', 'kernel_timer_pause', 'kernel_timer_command', 'kernel_timer_history'])
    result[name] = await prisma.$queryRawUnsafe(`SELECT to_jsonb(t) AS data FROM ${name} t ORDER BY to_jsonb(t)::text`); return result;
}
async function createTimer(task: Task, patch: Partial<OrderTimerState> = {}) {
  const value: OrderTimerState = { orderId: task.businessId, status: 'SHIPPED', version: 0, autoReceiptDays: 10, actualHandoverAt: date(10), baseDueAt: date(20), dueAt: date(20),
    updatedAt: date(10), blocks: [], pauses: [], commandReceipts: [], ...patch };
  await prisma.$executeRaw`INSERT INTO kernel_timer_order(order_id,version,data) VALUES(${task.businessId}::uuid,${value.version},${JSON.stringify(value)}::jsonb)`; return value;
}
type TimerFields<T = OrderTimerCommand> = T extends OrderTimerCommand ? Omit<T, 'commandKey' | 'reason'> : never;
function timerCommand(command: TimerFields): OrderTimerCommand { return { commandKey: randomUUID(), reason: '隔离订单计时', ...command }; }
const timerApply = (task: Task, command: OrderTimerCommand, who: TaskActorAccess = system) => business(ref(task), context => {
  if (command.action === 'ADD_BLOCK') return timer.addBlock(context, task.businessId, command.source, command);
  if (command.action === 'RELEASE_BLOCK') return timer.releaseBlock(context, task.businessId, command.source, command);
  if (command.action === 'RECORD_HANDOVER') return timer.recordActualHandover(context, task.businessId, command.actualAt, command);
  if (command.action === 'FINISH') return timer.finishOrderTimer(context, task.businessId, command.terminal, command);
  throw new Error('未知计时夹具动作');
}, who);
async function hold(task: Task) { await holder.query('BEGIN'); await holder.query('SELECT id FROM task_entry_fixture WHERE id=$1 FOR UPDATE', [task.businessId]); return Number((await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid); }
async function blocked(pid: number, count = 1) {
  const until = performance.now() + 500;
  while (performance.now() < until) {
    const result = await admin.query(`WITH RECURSIVE blocked(pid) AS (SELECT pid FROM pg_stat_activity WHERE datname=$1 AND $2=ANY(pg_blocking_pids(pid))
      UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid=ANY(pg_blocking_pids(a.pid)) WHERE a.datname=$1) SELECT count(*)::int AS count FROM blocked`, [target.testName, pid]);
    if (result.rows[0].count >= count) return; await new Promise(yes => setTimeout(yes, 5));
  } throw new Error('未观察到内核真实连接锁等待');
}
async function claim(task: Task) {
  if (warehouse.type !== 'EMPLOYEE') throw new Error('夹具身份错误'); const identity = await identities.authenticate(prisma, warehouse.token, 'EMPLOYEE');
  await commands.claim(identity, warehouse.token, task.id, { expectedVersion: task.version }, randomUUID()); return prisma.task.findUniqueOrThrow({ where: { id: task.id } });
}

it('空扫描真实成功0项，运行主体独立编号，没有新增任务或业务审计', async () => {
  const run = await scanner.scan(); expect(run).toMatchObject({ status: 'SUCCEEDED', scannedCount: 0, changedCount: 0, failedCount: 0 });
  expect(run.requestId).not.toBe(run.id); expect(await prisma.task.count()).toBe(0); expect(await prisma.auditLog.count()).toBe(0);
  expect(await prisma.schedulerRun.findUnique({ where: { id: run.id } })).toMatchObject({ status: 'SUCCEEDED', finishedAt: clock() });
});
it.each([-1, 0, 1])('截止相对现在%d毫秒：前/等号/后及真实发生时间', async offset => {
  const task = await makeTask(new Date(now + offset)); const run = await scanner.scan();
  expect(run.changedCount).toBe(offset <= 0 ? 1 : 0);
  const event = await prisma.deadlineEvent.findFirst(); if (offset <= 0) expect(event).toMatchObject({ occurredAt: task.dueAt, detectedAt: clock(), actorType: 'SYSTEM', requestId: run.requestId }); else expect(event).toBeNull();
});
it('已扫描前100条不阻塞后续，分页扫描115条并重复运行0写入', async () => {
  for (let n = 0; n < 115; n++) await makeTask(new Date(now - 86400_000 + n));
  const first = await scanner.scan(100); expect(first).toMatchObject({ scannedCount: 115, changedCount: 115 });
  const taskState = await state(); const second = await scanner.scan(100); expect(second).toMatchObject({ scannedCount: 0, changedCount: 0 }); expect(await state()).toEqual(taskState);
  const last = await makeTask(new Date(now - 1)); expect((await scanner.scan()).changedCount).toBe(1); expect(await prisma.deadlineEvent.count({ where: { taskId: last.id } })).toBe(1);
}, 45_000);
it('单项真实审计写后失败全部回滚，其余继续，诊断脱敏，下一轮恢复', async () => {
  const bad = await makeTask(new Date(now - 2)); const good = await makeTask(new Date(now - 1));
  adapters.onAuthorize = async (_tx, reference) => { audit.failAction = reference.businessId === bad.businessId ? 'task.overdue.record' : ''; };
  const result = await scanner.scan(); expect(result).toMatchObject({ status: 'PARTIAL_FAILED', scannedCount: 2, changedCount: 1, failedCount: 1 }); expect(audit.observed).toBe(true);
  expect(await prisma.deadlineEvent.count({ where: { taskId: bad.id } })).toBe(0); expect(await prisma.deadlineEvent.count({ where: { taskId: good.id } })).toBe(1);
  expect((await prisma.task.findUniqueOrThrow({ where: { id: bad.id } })).everOverdue).toBe(false);
  const failure = await prisma.schedulerFailure.findFirstOrThrow(); expect(failure).toMatchObject({ runId: result.id, taskId: bad.id, errorCode: 'TASK_SCAN_FAILED' });
  expect(failure.sanitizedMessage).not.toContain('写后故障'); audit.failAction = ''; adapters.onAuthorize = undefined;
  expect((await scanner.scan()).changedCount).toBe(1); expect(await prisma.schedulerFailure.count()).toBe(1);
});
it('所有候选失败标FAILED，保留诊断，不伪报扫描业务成功', async () => {
  await makeTask(new Date(now - 1)); adapters.onAuthorize = async () => { throw Object.assign(new Error('password Bearer private postgres://secret'), { code: 'leak' }); };
  expect(await scanner.scan()).toMatchObject({ status: 'FAILED', failedCount: 1, changedCount: 0 });
  expect(JSON.stringify(await prisma.schedulerFailure.findMany())).not.toMatch(/password|private|postgres|leak/);
});
it('崩溃RUNNING无会话锁才ABANDONED；持锁的另一活跃实例保持RUNNING', async () => {
  const crashed = await prisma.schedulerRun.create({ data: { jobName: 'task-overdue-scan', instanceId: 'crashed-fixture', requestId: randomUUID(), startedAt: date(17) } });
  const alive = await prisma.schedulerRun.create({ data: { jobName: 'task-overdue-scan', instanceId: 'alive-fixture', requestId: randomUUID(), startedAt: date(17) } });
  await holder.query('SELECT pg_advisory_lock(hashtextextended($1,0))', ['task-overdue-run:' + alive.id]);
  try { await scanner.scan(); expect((await prisma.schedulerRun.findUniqueOrThrow({ where: { id: crashed.id } })).status).toBe('ABANDONED');
    expect((await prisma.schedulerRun.findUniqueOrThrow({ where: { id: alive.id } })).status).toBe('RUNNING'); }
  finally { await holder.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', ['task-overdue-run:' + alive.id]); }
  await scanner.scan(); expect((await prisma.schedulerRun.findUniqueOrThrow({ where: { id: alive.id } })).status).toBe('ABANDONED');
});
it('两个运行会话同时扫描同任务，真实锁等待后只留一事实/审计，不误判对方崩溃', async () => {
  const task = await makeTask(new Date(now - 1)); const pid = await hold(task); const results = Promise.allSettled([scanner.scan(), scanner.scan()]);
  try { await blocked(pid, 2); expect(await prisma.schedulerRun.count({ where: { status: 'RUNNING' } })).toBe(2); } finally { await holder.query('COMMIT'); }
  const finished = await results; expect(finished.every(row => row.status === 'fulfilled')).toBe(true); expect(await prisma.deadlineEvent.count()).toBe(1);
  expect(await prisma.auditLog.count({ where: { action: 'task.overdue.record' } })).toBe(1); expect(await prisma.schedulerRun.count({ where: { status: 'ABANDONED' } })).toBe(0);
});
it('停机多天后补扫按真实旧截止；暂停可记录逾期，完成/取消不进入候选', async () => {
  const overdue = await makeTask(date(12)); const suspended = await makeTask(date(13)); await transition(suspended, 'SUSPENDED');
  const completed = await makeTask(date(14)); await transition(completed, 'COMPLETED');
  const cancelled = await makeTask(date(15)); await transition(cancelled, 'CANCELLED');
  const run = await scanner.scan(); expect(run.changedCount).toBe(1);
  expect(await prisma.deadlineEvent.findFirst({ where: { taskId: overdue.id } })).toMatchObject({ occurredAt: date(12), detectedAt: clock() });
  expect(await prisma.deadlineEvent.count()).toBe(4);
});
it('扫描与完成并发只记一次旧逾期，终结状态不被扫描改回', async () => {
  const task = await makeTask(new Date(now - 1)); const pid = await hold(task); const result = Promise.allSettled([scanner.scan(), transition(task, 'COMPLETED')]);
  try { await blocked(pid, 2); } finally { await holder.query('COMMIT'); } expect((await result).every(row => row.status === 'fulfilled')).toBe(true);
  expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('COMPLETED'); expect(await prisma.deadlineEvent.count()).toBe(1);
});
it('扫描与延期并发保留旧逾期，新截止未到不产生新逾期', async () => {
  const task = await makeTask(new Date(now - 1)); if (employee.type !== 'EMPLOYEE') throw new Error('夹具身份错误');
  const actor = await identities.authenticate(prisma, employee.token, 'EMPLOYEE'); const pid = await hold(task);
  const result = Promise.allSettled([scanner.scan(), deadline.extend(actor, employee.token, task.id, { expectedVersion: 0, reason: '隔离延期竞争', newDueAt: new Date(now + 3600_000).toISOString() }, randomUUID())]);
  try { await blocked(pid, 2); } finally { await holder.query('COMMIT'); } expect((await result).every(row => row.status === 'fulfilled')).toBe(true);
  expect(await prisma.deadlineEvent.count({ where: { eventType: 'OVERDUE' } })).toBe(1); expect(await prisma.deadlineEvent.count({ where: { eventType: 'EXTENDED' } })).toBe(1);
  expect((await scanner.scan()).changedCount).toBe(0);
});
it('领取后暂停清经办/领域经办，恢复回OPEN，保留轮次及所有期限；同命令幂等', async () => {
  const task = await claim(await makeTask(date(20))); const input = transitionInput(task, 'SUSPENDED');
  await business(ref(task), context => lifecycle.transition(context, input)); const after = await state();
  await business(ref(task), context => lifecycle.transition(context, input)); expect(await state()).toEqual(after);
  const suspended = await prisma.task.findUniqueOrThrow({ where: { id: task.id } }); expect(suspended).toMatchObject({ status: 'SUSPENDED', assigneeId: null, originalDueAt: task.originalDueAt, dueAt: task.dueAt, round: 1, version: 2 });
  await transition(suspended, 'RESUMED'); expect(await prisma.task.findUnique({ where: { id: task.id } })).toMatchObject({ status: 'OPEN', assigneeId: null, version: 3, dueAt: task.dueAt, round: 1 });
  expect(await prisma.$queryRaw`SELECT assignee_id FROM task_handoff_fixture WHERE task_id=${task.id}::uuid`).toEqual([{ assignee_id: null }]);
});
it('员工完成须当前经办；管理员无权跳过领取完成OPEN，系统/顾客由领域明确允许', async () => {
  const task = await makeTask(); await expect(transition(task, 'COMPLETED', {}, employee)).rejects.toMatchObject({ code: 'TASK_NOT_ASSIGNEE' });
  const claimed = await claim(task); await transition(claimed, 'COMPLETED', {}, warehouse);
  expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('COMPLETED');
});
it.each(['COMPLETED', 'CANCELLED'] as const)('终结%s保留期限、补旧逾期；新动作不能复活终结任务', async action => {
  const task = await makeTask(new Date(now - 1)); const input = transitionInput(task, action); await business(ref(task), context => lifecycle.transition(context, input));
  const after = await state(); await business(ref(task), context => lifecycle.transition(context, input)); expect(await state()).toEqual(after);
  const closed = await prisma.task.findUniqueOrThrow({ where: { id: task.id } }); expect(closed).toMatchObject({ status: action, dueAt: task.dueAt, originalDueAt: task.originalDueAt, everOverdue: true, firstOverdueAt: task.dueAt, round: 1 });
  await expect(transition(closed, 'RESUMED')).rejects.toMatchObject({ code: 'TASK_TRANSITION_BLOCKED' });
});
it.each(['domain', 'audit'] as const)('生命周期%s真实写后失败，领域/任务/逾期/历史/审计整体回滚', async phase => {
  const task = await makeTask(new Date(now - 1)); const before = await state();
  if (phase === 'domain') adapters.onTransitionWrite = async () => { throw new Error('隔离领域写后故障'); }; else audit.failAction = 'task.stage.complete';
  await expect(transition(task, 'COMPLETED')).rejects.toThrow(); if (phase === 'audit') expect(audit.observed).toBe(true); expect(await state()).toEqual(before);
});
it('生命周期领域等待后凭证过期拒绝；上下文不可伪造/跨业务/回调后复用', async () => {
  const task = await claim(await makeTask()); const before = await state(); adapters.onTransitionWrite = async () => { now += 7200_000; };
  await expect(transition(task, 'COMPLETED', {}, warehouse)).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' }); expect(await state()).toEqual(before);
  adapters.onTransitionWrite = undefined; let saved!: TaskEntryContext; await business(ref(task), async context => { saved = context; });
  await expect(lifecycle.transition(saved, transitionInput(task, 'CANCELLED'))).rejects.toMatchObject({ code: 'TASK_CONTEXT_INVALID' });
  await expect(lifecycle.transition({ requestId: randomUUID() }, transitionInput(task, 'CANCELLED'))).rejects.toMatchObject({ code: 'TASK_CONTEXT_INVALID' });
  const other = await makeTask(); await expect(business(ref(other), context => lifecycle.transition(context, transitionInput(task, 'CANCELLED')))).rejects.toMatchObject({ code: 'TASK_CONTEXT_INVALID' });
});
it('两个异常共用同阶段任务；部分来源结束不结束任务，最后来源结束才终结', async () => {
  const task = await makeTask(); const a = await realSource(task.businessId); const b = await realSource(task.businessId, 'SHIPMENT_EXCEPTION');
  for (const [n, source] of [a, b].entries()) await business(ref(task), context => sources.attach(context, { ...ref(task), ...source, stage: task.stage, entryKey: 'shared:' + n, reason: '同阶段多来源' }));
  expect(await prisma.task.count()).toBe(1); expect(await prisma.taskStageCursor.findUnique({ where: { id: task.cursorId } })).toMatchObject({ lastRound: 1 });
  await business(ref(task), context => sources.resolve(context, sourceInput(task, a))); expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('OPEN');
  const input = sourceInput(task, b); await business(ref(task), context => sources.resolve(context, input)); const after = await state();
  await business(ref(task), context => sources.resolve(context, input)); expect(await state()).toEqual(after);
  expect(await prisma.taskHistory.count({ where: { action: 'COMPLETED' } })).toBe(1);
  await expect(business(ref(task), context => sources.resolve(context, input, 'CANCELLED'))).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
});
it('来源添加重试不造关联/历史；跨订单来源/任意来源UUID明确拒绝', async () => {
  const task = await makeTask(); const other = await makeTask(); const source = await realSource(task.businessId); const input = sourceInput(task, source);
  await business(ref(task), context => sources.add(context, input)); const before = await state(); await business(ref(task), context => sources.add(context, input)); expect(await state()).toEqual(before);
  await expect(business(ref(other), context => sources.add(context, { ...input, ...ref(other), taskId: other.id }))).rejects.toMatchObject({ code: 'TASK_SOURCE_CONFLICT' });
  await expect(business(ref(task), context => sources.add(context, { ...input, sourceId: randomUUID() }))).rejects.toMatchObject({ code: 'TASK_SOURCE_CONFLICT' });
});
it('仍有ACTIVE来源时，生命周期及阶段替换均不得提前结束共享任务', async () => {
  const task = await makeTask(); const source = await realSource(task.businessId); await business(ref(task), context => sources.add(context, sourceInput(task, source)));
  await expect(transition(task, 'CANCELLED')).rejects.toMatchObject({ code: 'TASK_SOURCE_ACTIVE' });
  await prisma.$executeRaw`UPDATE task_entry_fixture SET replace_active=true,expected_task_id=${task.id}::uuid,expected_version=0 WHERE id=${task.businessId}::uuid`;
  await expect(business(ref(task), context => entry.enterStage(context, { ...ref(task), stage: task.stage, entryKey: 'new-with-active', reason: '禁止结束其它来源' }))).rejects.toMatchObject({ code: 'TASK_SOURCE_ACTIVE' });
  expect(await prisma.task.count()).toBe(1);
});
it('两个连接并发结束不同来源仅最后一次结束任务，来源自身重复也只写一次', async () => {
  const task = await makeTask(); const a = await realSource(task.businessId); const b = await realSource(task.businessId, 'STOCK_EXCEPTION');
  for (const source of [a, b]) await business(ref(task), context => sources.add(context, sourceInput(task, source)));
  const pid = await hold(task); const result = Promise.allSettled([a, b].map(source => business(ref(task), context => sources.resolve(context, sourceInput(task, source)))));
  try { await blocked(pid, 2); } finally { await holder.query('COMMIT'); } expect((await result).every(row => row.status === 'fulfilled')).toBe(true);
  expect(await prisma.taskHistory.count({ where: { action: 'COMPLETED' } })).toBe(1); expect(await prisma.$queryRaw`SELECT count(*)::int AS count FROM kernel_source_history WHERE action='RESOLVED'`).toEqual([{ count: 2 }]);
});
it('来源实际写后故障回滚新增/领域/Task和审计；最后来源终结审计故障同样整体回滚', async () => {
  const task = await makeTask(); const source = await realSource(task.businessId); const input = sourceInput(task, source); const before = await state();
  adapters.onSourceWrite = async () => { throw new Error('来源真实写后故障'); }; await expect(business(ref(task), context => sources.add(context, input))).rejects.toThrow(); expect(await state()).toEqual(before);
  adapters.onSourceWrite = undefined; await business(ref(task), context => sources.add(context, input)); const active = await state(); audit.failAction = 'task.stage.complete';
  await expect(business(ref(task), context => sources.resolve(context, sourceInput(task, source)))).rejects.toThrow(); expect(await state()).toEqual(active);
});
it('BR-05真实事务保存多重阻塞/周期/回执，部分解除不恢复，最后解除至少三天', async () => {
  const task = await makeTask(); await createTimer(task); const a = await realSource(task.businessId); const b = await realSource(task.businessId, 'SHIPMENT_EXCEPTION');
  await timerApply(task, timerCommand({ action: 'ADD_BLOCK', source: a })); now = +date(19); await timerApply(task, timerCommand({ action: 'ADD_BLOCK', source: b }));
  now = +date(20); await timerApply(task, timerCommand({ action: 'RELEASE_BLOCK', source: a }));
  expect(await adapters.timerRepository.load(prisma, task.businessId)).toMatchObject({ dueAt: null, pauses: [{ status: 'ACTIVE', remainingMs: 2 * 86400_000 }] });
  now = +date(25); const release = timerCommand({ action: 'RELEASE_BLOCK', source: b }); await timerApply(task, release); const after = await state(); await timerApply(task, release); expect(await state()).toEqual(after);
  expect(await adapters.timerRepository.load(prisma, task.businessId)).toMatchObject({ dueAt: date(28), version: 4, pauses: [{ status: 'RESUMED' }] });
  expect(await prisma.$queryRaw`SELECT count(*)::int AS count FROM kernel_timer_history`).toEqual([{ count: 4 }]);
});
it.each(['COMPLETED', 'REFUNDED'] as const)('终结订单%s，真实周期TERMINATED且后续解除不恢复', async terminal => {
  const task = await makeTask(); await createTimer(task); const source = await realSource(task.businessId); await timerApply(task, timerCommand({ action: 'ADD_BLOCK', source }));
  await timerApply(task, timerCommand({ action: 'FINISH', terminal })); await timerApply(task, timerCommand({ action: 'RELEASE_BLOCK', source }));
  expect(await adapters.timerRepository.load(prisma, task.businessId)).toMatchObject({ status: terminal, dueAt: null, pauses: [{ status: 'TERMINATED' }] });
});
it('交运未知无计时，阻塞中补录十天前事实冻结0，最后解除仍三天', async () => {
  const task = await makeTask(); await createTimer(task, { status: 'HANDOVER_UNKNOWN', actualHandoverAt: null, baseDueAt: null, dueAt: null }); const source = await realSource(task.businessId);
  await timerApply(task, timerCommand({ action: 'ADD_BLOCK', source })); expect((await adapters.timerRepository.load(prisma, task.businessId)).pauses).toEqual([]);
  await timerApply(task, timerCommand({ action: 'RECORD_HANDOVER', actualAt: date(8) })); expect(await adapters.timerRepository.load(prisma, task.businessId)).toMatchObject({ actualHandoverAt: date(8), baseDueAt: date(18), dueAt: null, pauses: [{ remainingMs: 0 }] });
  now = +date(25); await timerApply(task, timerCommand({ action: 'RELEASE_BLOCK', source })); expect((await adapters.timerRepository.load(prisma, task.businessId)).dueAt).toEqual(date(28));
});
it('多来源关闭、订单解除阻塞、周期恢复和任务完成同事务，任一点失败一起回滚', async () => {
  const task = await makeTask(); await createTimer(task); const source = await realSource(task.businessId); await timerApply(task, timerCommand({ action: 'ADD_BLOCK', source }));
  await business(ref(task), context => sources.add(context, sourceInput(task, source))); const before = await state(); audit.failAction = 'task.stage.complete';
  await expect(business(ref(task), async context => { await timer.apply(context, task.businessId, timerCommand({ action: 'RELEASE_BLOCK', source })); await sources.resolve(context, sourceInput(task, source)); })).rejects.toThrow();
  expect(audit.observed).toBe(true); expect(await state()).toEqual(before);
});
it.each(['domain', 'audit'] as const)('计时%s实际写后故障回滚订单/阻塞/周期/回执/历史/审计', async phase => {
  const task = await makeTask(); await createTimer(task); const source = await realSource(task.businessId); const before = await state();
  if (phase === 'domain') adapters.onTimerWrite = async () => { throw new Error('计时真实写后故障'); }; else audit.failAction = 'order.timer.block.add';
  await expect(timerApply(task, timerCommand({ action: 'ADD_BLOCK', source }))).rejects.toThrow(); if (phase === 'audit') expect(audit.observed).toBe(true); expect(await state()).toEqual(before);
});
it('计时写后凭证到期回滚；跨订单阻塞来源及伪造上下文拒绝', async () => {
  const task = await makeTask(); await createTimer(task); const source = await realSource(task.businessId); const before = await state();
  adapters.onTimerWrite = async () => { now += 7200_000; };
  await expect(timerApply(task, timerCommand({ action: 'ADD_BLOCK', source }), employee)).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' }); expect(await state()).toEqual(before);
  adapters.onTimerWrite = undefined; const other = await makeTask(); await createTimer(other);
  await expect(timerApply(other, timerCommand({ action: 'ADD_BLOCK', source }))).rejects.toMatchObject({ code: 'TASK_SOURCE_CONFLICT' });
  await expect(timer.apply({ requestId: randomUUID() }, task.businessId, timerCommand({ action: 'ADD_BLOCK', source }))).rejects.toMatchObject({ code: 'TASK_CONTEXT_INVALID' });
});
it('两个连接并发添加不同阻塞只冻结一次，并发最后解除只恢复一次', async () => {
  const task = await makeTask(); await createTimer(task); const a = await realSource(task.businessId); const b = await realSource(task.businessId, 'ADDRESS_REQUEST');
  const pid = await hold(task); const result = Promise.allSettled([a, b].map(source => timerApply(task, timerCommand({ action: 'ADD_BLOCK', source }))));
  try { await blocked(pid, 2); } finally { await holder.query('COMMIT'); } expect((await result).every(row => row.status === 'fulfilled')).toBe(true);
  expect((await adapters.timerRepository.load(prisma, task.businessId)).pauses).toHaveLength(1);
  now = +date(25); const pid2 = await hold(task); const releases = Promise.allSettled([a, b].map(source => timerApply(task, timerCommand({ action: 'RELEASE_BLOCK', source }))));
  try { await blocked(pid2, 2); } finally { await holder.query('COMMIT'); } expect((await releases).every(row => row.status === 'fulfilled')).toBe(true);
  expect(await adapters.timerRepository.load(prisma, task.businessId)).toMatchObject({ dueAt: date(28), pauses: [{ status: 'RESUMED' }] });
});
it('生命周期实际遵守员工→顾客→订单→Cursor→Task锁序', async () => {
  const task = await claim(await makeTask()); const trace: LockObservation[] = [];
  await business(ref(task), context => lifecycle.transition(context, transitionInput(task, 'COMPLETED')), warehouse, trace);
  if (warehouse.type !== 'EMPLOYEE') throw new Error('夹具身份错误');
  expect(trace).toEqual([{ table: 'employee', ids: [warehouse.subjectId] }, { table: 'customer', ids: [customerId] }, { table: 'task_entry_fixture', ids: [task.businessId] },
    { table: 'task_stage_cursor', ids: [task.cursorId] }, { table: 'task', ids: [task.id] }]);
});
it('扫描实际遵守员工→顾客→订单→Cursor→Task锁序，且不递增任务业务版本', async () => {
  const task = await claim(await makeTask(new Date(now - 1))); const trace: LockObservation[] = []; const original = prisma.$transaction.bind(prisma);
  const spy = vi.spyOn(prisma, '$transaction').mockImplementation(((command: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => original(tx => command(observeLocks(tx, trace)), options)) as typeof prisma.$transaction);
  try { await scanner.scan(); } finally { spy.mockRestore(); }
  if (warehouse.type !== 'EMPLOYEE') throw new Error('夹具身份错误');
  expect(trace).toEqual([{ table: 'employee', ids: [warehouse.subjectId] }, { table: 'customer', ids: [customerId] }, { table: 'task_entry_fixture', ids: [task.businessId] },
    { table: 'task_stage_cursor', ids: [task.cursorId] }, { table: 'task', ids: [task.id] }]);
  expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).version).toBe(task.version);
});
it('扫描候选查询故障标运行FAILED并独立保存全局脱敏诊断', async () => {
  const spy = vi.spyOn(prisma, '$queryRaw').mockImplementationOnce((() => Promise.reject(new Error('候选读取失败 postgres://private password token'))) as typeof prisma.$queryRaw);
  try { await expect(scanner.scan()).rejects.toThrow('候选读取失败'); } finally { spy.mockRestore(); }
  expect(await prisma.schedulerRun.findFirst()).toMatchObject({ status: 'FAILED', failedCount: 1 });
  const failure = await prisma.schedulerFailure.findFirstOrThrow(); expect(failure.taskId).toBeNull(); expect(JSON.stringify(failure)).not.toMatch(/private|password|token|候选读取/);
});
it('管理员SYSTEM均不能复用顾客同主体历史：真实顾客重放成功，系统旧版本冲突', async () => {
  const task = await makeTask(); const session = await prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx, { subjectType: 'CUSTOMER', subjectId: customerId, expectedPasswordHash: hash, expectedTokenVersion: 0 }));
  const customer = { type: 'CUSTOMER', subjectId: customerId, token: session.accessToken } as const; const input = transitionInput(task, 'COMPLETED');
  await business(ref(task), context => lifecycle.transition(context, input), customer); const before = await state();
  await business(ref(task), context => lifecycle.transition(context, input), customer); expect(await state()).toEqual(before);
  await expect(business(ref(task), context => lifecycle.transition(context, input))).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  expect(await prisma.auditLog.findFirst({ where: { action: 'task.stage.complete' } })).toMatchObject({ actorType: 'CUSTOMER', actorCustomerId: customerId });
});
it('生命周期旧版本、换原因和暂停恢复后的ABA旧动作不能重放', async () => {
  const task = await makeTask(); const first = transitionInput(task, 'SUSPENDED'); await business(ref(task), context => lifecycle.transition(context, first));
  await expect(business(ref(task), context => lifecycle.transition(context, { ...first, reason: '不同原因' }))).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  await transition(await prisma.task.findUniqueOrThrow({ where: { id: task.id } }), 'RESUMED'); await transition(await prisma.task.findUniqueOrThrow({ where: { id: task.id } }), 'SUSPENDED');
  const before = await state(); await expect(business(ref(task), context => lifecycle.transition(context, first))).rejects.toMatchObject({ code: 'VERSION_CONFLICT' }); expect(await state()).toEqual(before);
});
it('员工完成仍核对固定阶段及任务附加资格，不能借领域允许跳过撤权', async () => {
  const task = await claim(await makeTask()); await prisma.task.update({ where: { id: task.id }, data: { requiredPermissions: [...task.requiredPermissions as string[], 'after-sale.refund.retry'] } });
  const before = await state(); await expect(transition(task, 'COMPLETED', {}, warehouse)).rejects.toMatchObject({ code: 'FORBIDDEN' }); expect(await state()).toEqual(before);
});
it('生命周期和有来源的阶段替换均明确拒绝任务版本溢出', async () => {
  let task = await makeTask(); task = await prisma.task.update({ where: { id: task.id }, data: { version: 2147483647 } });
  await expect(transition(task, 'CANCELLED')).rejects.toMatchObject({ code: 'TASK_VERSION_EXHAUSTED' });
  await prisma.$executeRaw`UPDATE task_entry_fixture SET replace_active=true,expected_task_id=${task.id}::uuid,expected_version=2147483647 WHERE id=${task.businessId}::uuid`;
  const before = await state(); await expect(business(ref(task), context => entry.enterStage(context, { ...ref(task), stage: task.stage, entryKey: 'exhausted-stage', reason: '拒绝版本溢出' }))).rejects.toMatchObject({ code: 'TASK_VERSION_EXHAUSTED' }); expect(await state()).toEqual(before);
});
it('来源取消只结束自己的来源，最后来源取消才取消任务，不恢复已终结来源', async () => {
  const task = await makeTask(); const a = await realSource(task.businessId); const b = await realSource(task.businessId, 'ADDRESS_REQUEST');
  for (const source of [a, b]) await business(ref(task), context => sources.add(context, sourceInput(task, source)));
  await business(ref(task), context => sources.cancel(context, sourceInput(task, a))); expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('OPEN');
  await business(ref(task), context => sources.cancel(context, sourceInput(task, b))); expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('CANCELLED');
  await expect(business(ref(task), context => sources.add(context, sourceInput(task, a)))).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
});
it('两个连接并发结束同一来源，只写一次来源历史和任务完成', async () => {
  const task = await makeTask(); const source = await realSource(task.businessId); await business(ref(task), context => sources.add(context, sourceInput(task, source))); const input = sourceInput(task, source);
  const pid = await hold(task); const results = Promise.allSettled([1, 2].map(() => business(ref(task), context => sources.resolve(context, input))));
  try { await blocked(pid, 2); } finally { await holder.query('COMMIT'); } expect((await results).every(row => row.status === 'fulfilled')).toBe(true);
  expect(await prisma.$queryRaw`SELECT count(*)::int AS count FROM kernel_source_history WHERE action='RESOLVED'`).toEqual([{ count: 1 }]); expect(await prisma.taskHistory.count({ where: { action: 'COMPLETED' } })).toBe(1);
});
it.each([0, 5])('真实计时仓储冻结剩%d天，延迟解除保留max(剩余,三天)', async remaining => {
  const task = await makeTask(); const due = new Date(now + remaining * 86400_000); await createTimer(task, { dueAt: due, baseDueAt: due }); const source = await realSource(task.businessId);
  await timerApply(task, timerCommand({ action: 'ADD_BLOCK', source })); now = +date(25); await timerApply(task, timerCommand({ action: 'RELEASE_BLOCK', source }));
  expect((await adapters.timerRepository.load(prisma, task.businessId)).dueAt).toEqual(new Date(now + Math.max(remaining, 3) * 86400_000));
});
it('真实计时再次暂停建新周期，旧解除重放不改变新周期，来源解除不得跨订单', async () => {
  const task = await makeTask(); await createTimer(task); const a = await realSource(task.businessId); const b = await realSource(task.businessId, 'STOCK_EXCEPTION');
  await timerApply(task, timerCommand({ action: 'ADD_BLOCK', source: a })); const release = timerCommand({ action: 'RELEASE_BLOCK', source: a }); await timerApply(task, release);
  await timerApply(task, timerCommand({ action: 'ADD_BLOCK', source: b })); const before = await state(); await timerApply(task, release); expect(await state()).toEqual(before);
  expect((await adapters.timerRepository.load(prisma, task.businessId)).pauses.map(row => row.status)).toEqual(['RESUMED', 'ACTIVE']);
});
it.each(['lifecycle', 'replacement'] as const)('暂停任务不能借%s直接完成，须先合法恢复或取消旧轮', async mode => {
  const task = await makeTask(); await transition(task, 'SUSPENDED'); const suspended = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
  if (mode === 'replacement') await prisma.$executeRaw`UPDATE task_entry_fixture SET replace_active=true,outcome='COMPLETED',expected_task_id=${task.id}::uuid,expected_version=1 WHERE id=${task.businessId}::uuid`;
  const before = await state();
  if (mode === 'lifecycle') await expect(transition(suspended, 'COMPLETED')).rejects.toMatchObject({ code: 'TASK_TRANSITION_BLOCKED' });
  else await expect(business(ref(task), context => entry.enterStage(context, { ...ref(task), stage: task.stage, entryKey: 'blocked-completion', reason: '暂停不得继续处理' }))).rejects.toMatchObject({ code: 'TASK_TRANSITION_BLOCKED' });
  expect(await state()).toEqual(before);
});
