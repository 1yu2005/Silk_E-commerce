// 作用：用真实Nest/会话/PostgreSQL在专属库验证任务查询授权、20人争领、版本幂等、安全释放和同事务回滚。
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { EmployeeRole, Prisma, Task } from '@prisma/client';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { assertSafeTestDatabase } from '../scripts/database-env.js';
import { runPrisma } from '../scripts/database.js';
import { AppModule } from '../src/app.module.js';
import { OrderAdapters } from '../src/orders/order.adapters.js';
import { InventoryAdapters } from '../src/inventory/inventory.adapters.js';
import { AuditService, type AuditAction, type AuditPayload } from '../src/audit/audit.service.js';
import { AuthSessionService } from '../src/auth/auth-session.service.js';
import { CurrentIdentityService } from '../src/auth/current-identity.service.js';
import { JwtTokenService } from '../src/auth/jwt-token.service.js';
import { PasswordService } from '../src/auth/password.service.js';
import { Clock } from '../src/common/time/clock.js';
import { configureApp } from '../src/common/configure-app.js';
import { APP_CONFIG, loadConfiguration, type EnvironmentConfig } from '../src/config/environment.js';
import { PermissionService } from '../src/permissions/permission.service.js';
import { seedPermissionCatalog } from '../src/permissions/permission-seed.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { TaskBusinessAdapters, type TaskEmployee } from '../src/tasks/task-business-adapters.js';
import { TaskCommandService } from '../src/tasks/task-command.service.js';
import { TaskAccessService } from '../src/tasks/task-access.service.js';
import { TaskLockService } from '../src/tasks/task-lock.service.js';
import { TaskEntryService } from '../src/tasks/task-entry.service.js';
import type { TaskQueryService } from '../src/tasks/task-query.service.js';
import { FixtureAccessAdapters, installAccessFixture } from './fixtures/task-access-business.js';
import { createFixture, type FixtureBusiness } from './fixtures/task-entry-business.js';

const safe = assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('任务操作测试仅限隔离库');
const targetUrl = new URL(safe.testUrl); targetUrl.pathname = `/task_access_${randomUUID().replaceAll('-', '')}_test`;
const target = assertSafeTestDatabase(safe.developmentUrl, targetUrl.toString());
if (!/^task_access_[a-f0-9]{32}_test$/.test(target.testName)) throw new Error('专属库名不合法');
const server = new URL(safe.testUrl); server.pathname = '/postgres';
const admin = new Client({ connectionString: server.toString() }); const holder = new Client({ connectionString: target.testUrl });
const start = new Date('2026-11-13T02:00:00Z'); let now = start.getTime(); const clock = () => new Date(now);
const tokens = new JwtTokenService({ secret: 'isolated-task-access-only-key-2026-'.repeat(2), ttlSeconds: 7200 }, clock);
const sessions = new AuthSessionService(tokens, clock); const identities = new CurrentIdentityService(tokens, new PermissionService(), clock);
const adapters = new FixtureAccessAdapters();
class ControlledAudit extends AuditService {
  failAction: AuditAction | null = null; observed = false;
  override async appendAudit(tx: Prisma.TransactionClient, payload: AuditPayload) {
    await super.appendAudit(tx, payload);
    if (payload.action === this.failAction) { this.observed = await tx.auditLog.count({ where: { requestId: payload.requestId } }) === 1;
      throw new Error('隔离故障：审计实际写入后失败'); }
  }
}
const audit = new ControlledAudit(); let app: INestApplication; let prisma: PrismaService; let peer: PrismaService; let entry: TaskEntryService;
let config: EnvironmentConfig; let created = false; let base = ''; let passwordHash = ''; let customerId = ''; let customerToken = '';
interface Person { identity: TaskEmployee; token: string }
let manager: Person; let warehouse: Person; let support: Person;
type ListData = Awaited<ReturnType<TaskQueryService['list']>>;
type DetailData = Awaited<ReturnType<TaskQueryService['detail']>>;
type HistoryData = Awaited<ReturnType<TaskQueryService['history']>>;
type SummaryData = Awaited<ReturnType<TaskQueryService['summary']>>;
type CommandData = Awaited<ReturnType<TaskCommandService['claim']>>;
beforeAll(async () => {
  await admin.connect(); await admin.query(`CREATE DATABASE "${target.testName}" ENCODING 'UTF8' TEMPLATE template0`); created = true;
  runPrisma(['migrate', 'deploy'], { ...process.env, DATABASE_URL: target.testUrl });
  config = loadConfiguration({ ...process.env, DATABASE_URL: target.testUrl, LOG_LEVEL: 'silent', SWAGGER_ENABLED: 'true' });
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(APP_CONFIG).useValue(config)
    .overrideProvider(JwtTokenService).useValue(tokens).overrideProvider(AuthSessionService).useValue(sessions).overrideProvider(CurrentIdentityService).useValue(identities)
    .overrideProvider(Clock).useValue({ now: clock }).overrideProvider(TaskBusinessAdapters).useValue(adapters).overrideProvider(AuditService).useValue(audit).overrideProvider(OrderAdapters).useValue({onModuleInit(){ /* 任务内核隔离测试使用本文件的父事实夹具；真实订单接通由orders.integration覆盖。 */ }}).overrideProvider(InventoryAdapters).useValue({onModuleInit(){ /* 本文件用真实SQL父事实夹具统一替代业务适配器，库存正式注册由库存集成测试验证。 */ }}).compile();
  app = module.createNestApplication(); configureApp(app); await app.listen(0, '127.0.0.1'); base = (await app.getUrl()) + '/api/v1';
  prisma = app.get(PrismaService); entry = app.get(TaskEntryService);
  peer = new PrismaService(config); await peer.onModuleInit(); await holder.connect();
  await prisma.$transaction(installAccessFixture); await seedPermissionCatalog(prisma); passwordHash = await new PasswordService().hash('IsolatedTaskAccess#2026');
}, 45_000);
async function person(role: EmployeeRole, username: string) {
  const employee = await prisma.employee.create({ data: { username, displayName: '隔离任务员工', role, passwordHash, mustChangePassword: false } });
  const session = await prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx, { subjectType: 'EMPLOYEE', subjectId: employee.id,
    expectedPasswordHash: passwordHash, expectedTokenVersion: 0 }));
  const identity = await identities.authenticate(prisma, session.accessToken, 'EMPLOYEE');
  if (identity.subjectType !== 'EMPLOYEE') throw new Error('隔离员工夹具错误'); return { identity, token: session.accessToken };
}
beforeEach(async () => {
  now = start.getTime(); audit.failAction = null; audit.observed = false; adapters.onScope = undefined; adapters.onClaim = undefined; adapters.onRelease = undefined; adapters.onPlan = undefined;
  await prisma.deadlineEvent.deleteMany(); await prisma.taskHistory.deleteMany(); await prisma.task.deleteMany(); await prisma.taskStageCursor.deleteMany();
  await prisma.$executeRawUnsafe('DELETE FROM task_entry_fixture'); await prisma.$executeRawUnsafe('DELETE FROM task_entry_fixture_resource');
  await prisma.auditLog.deleteMany(); await prisma.authSession.deleteMany(); await prisma.employeeExtraPermission.deleteMany(); await prisma.employee.deleteMany(); await prisma.customer.deleteMany();
  manager = await person('SUPER_ADMIN', 'access_manager'); warehouse = await person('MERCH_WAREHOUSE', 'access_warehouse'); support = await person('CUSTOMER_SERVICE', 'access_support');
  customerId = (await prisma.customer.create({ data: { phone: '19900000011', nickname: '隔离服装顾客', passwordHash } })).id;
  const customer = await prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx, { subjectType: 'CUSTOMER', subjectId: customerId, expectedPasswordHash: passwordHash, expectedTokenVersion: 0 })); customerToken = customer.accessToken;
});
afterAll(async () => {
  await holder.end(); await peer?.$disconnect(); await app?.close();
  try { if (created) { assertSafeTestDatabase(safe.developmentUrl, target.testUrl); await admin.query(`DROP DATABASE "${target.testName}"`); created = false; console.info('步骤6专属测试库已删除'); } }
  finally { await admin.end(); }
}, 20_000);
async function makeTask(patch: Partial<FixtureBusiness> = {}): Promise<Task> {
  const root = await createFixture(prisma, customerId, { businessType: 'ORDER', allowedStage: 'SHIPMENT_PROCESS', startedAt: new Date(start.getTime() - 604800_000), ...patch });
  return prisma.$transaction(tx => entry.withContext(tx, { type: 'SYSTEM' }, [{ businessType: root.businessType, businessId: root.id }], randomUUID(),
    async context => (await entry.enterStage(context, { businessType: root.businessType, businessId: root.id, stage: root.allowedStage as Task['stage'], entryKey: 'isolated:entry', reason: '隔离真实阶段进入' })).task));
}
async function http<T>(path: string, options: { person?: Person | null; token?: string; body?: unknown; status?: number } = {}) {
  const token = options.token ?? (options.person === null ? null : (options.person ?? warehouse).token);
  const response = await fetch(base + path, { method: options.body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
  const body = await response.json() as { data: T; code?: string; requestId: string }; expect(response.status).toBe(options.status ?? 200);
  expect(body.requestId).toBe(response.headers.get('x-request-id')); if (response.ok) expect(response.headers.get('cache-control')).toBe('no-store'); return body;
}
const claim = (task: Task, who = warehouse, version = task.version, status = 200) => http<CommandData>(`/admin/tasks/${task.id}/claim`, { person: who, body: { expectedVersion: version }, status });
const release = (task: Task, who = warehouse, version = 1, reason = '交班前已确认安全交接', status = 200) => http<CommandData>(`/admin/tasks/${task.id}/release`, { person: who, body: { expectedVersion: version, reason }, status });
async function state() { return { tasks: await prisma.task.findMany({ orderBy: { id: 'asc' } }), cursors: await prisma.taskStageCursor.findMany({ orderBy: { id: 'asc' } }),
  history: await prisma.taskHistory.findMany({ orderBy: { id: 'asc' } }), events: await prisma.deadlineEvent.findMany({ orderBy: { id: 'asc' } }), audit: await prisma.auditLog.findMany({ orderBy: { id: 'asc' } }),
  roots: await prisma.$queryRaw`SELECT * FROM task_entry_fixture ORDER BY id` }; }
function barrier() { let release!: () => void; let signal!: () => void; const held = new Promise<void>(yes => { release = yes; }); const ready = new Promise<void>(yes => { signal = yes; }); return { release, signal, held, ready }; }
async function waitBlocked(pid: number, count = 1) {
  const until = performance.now() + 500;
  while (performance.now() < until) {
    const result = await admin.query(`WITH RECURSIVE blocked(pid) AS (SELECT pid FROM pg_stat_activity WHERE datname=$1 AND $2=ANY(pg_blocking_pids(pid))
      UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid=ANY(pg_blocking_pids(a.pid)) WHERE a.datname=$1) SELECT count(*)::int AS count FROM blocked`, [target.testName, pid]);
    if (result.rows[0].count >= count) return; await new Promise(yes => setTimeout(yes, 5));
  }
  throw new Error('未观察到预期真实锁等待');
}

it('空库返回真实空列表和零摘要，匿名/顾客/强改密拒绝', async () => {
  expect((await http<ListData>('/admin/tasks?view=pool')).data).toMatchObject({ items: [], total: 0, page: 1, pageSize: 20 });
  expect((await http<SummaryData>('/admin/tasks/summary')).data).toMatchObject({ myPending: 0, eligibleOpen: 0, currentOverdue: 0, everOverdue: 0, reassignNeeded: null, countsOverlap: true });
  await http('/admin/tasks', { person: null, status: 401 }); await http('/admin/tasks', { token: customerToken, status: 401 });
  await prisma.employee.update({ where: { id: warehouse.identity.subjectId }, data: { mustChangePassword: true } }); await http('/admin/tasks', { status: 403 });
});
it('岗位池按完整当前资格裁剪，管理员阶段不向普通岗位开放，额外授权不自动增权', async () => {
  const shipping = await makeTask(); const contact = await makeTask({ allowedStage: 'CUSTOMER_CONTACT' }); const adminTask = await makeTask({ allowedStage: 'ADMIN_STOCK_REVIEW' });
  expect((await http<ListData>('/admin/tasks?view=pool')).data.items.map(row => row.id)).toEqual([shipping.id]);
  expect((await http<ListData>('/admin/tasks?view=pool', { person: support })).data.items.map(row => row.id)).toEqual([contact.id]);
  expect((await http<ListData>('/admin/tasks?view=pool', { person: manager })).data.total).toBe(3);
  await http(`/admin/tasks/${adminTask.id}`, { status: 404 });
  await prisma.task.update({ where: { id: shipping.id }, data: { requiredPermissions: [...shipping.requiredPermissions as string[], 'after-sale.refund.retry'] } });
  expect((await http<ListData>('/admin/tasks?view=pool')).data.total).toBe(0);
});
it('业务读取范围不能被管理员或历史经办替代，不存在与无权详情/历史统一404', async () => {
  const task = await makeTask(); await prisma.$executeRaw`UPDATE task_entry_fixture SET reader_employee_id=${warehouse.identity.subjectId}::uuid WHERE id=${task.businessId}::uuid`;
  expect((await http<ListData>('/admin/tasks?view=pool', { person: manager })).data.total).toBe(0);
  await http(`/admin/tasks/${task.id}`, { person: manager, status: 404 }); await http(`/admin/tasks/${task.id}/history`, { person: manager, status: 404 });
  await http(`/admin/tasks/${randomUUID()}`, { status: 404 }); await http(`/admin/tasks/${randomUUID()}/history`, { status: 404 });
  await claim(task); await release(task);
  await prisma.employee.update({ where: { id: warehouse.identity.subjectId }, data: { role: 'CUSTOMER_SERVICE' } });
  // 仍有订单业务读取权，旧经办可读必要历史，但没有发货处理资格。
  expect((await http<HistoryData>(`/admin/tasks/${task.id}/history`)).data.total).toBe(3);
  expect((await http<DetailData>(`/admin/tasks/${task.id}`)).data.allowedActions).toEqual([]);
  expect((await claim(task, warehouse, 2, 403)).code).toBe('FORBIDDEN');
  await prisma.$executeRaw`UPDATE task_entry_fixture SET reader_employee_id=${manager.identity.subjectId}::uuid WHERE id=${task.businessId}::uuid`;
  await http(`/admin/tasks/${task.id}/history`, { status: 404 });
});
it('分页与筛选使用同一授权范围，截止/无截止稳定排序，超大页安全返回空', async () => {
  const late = await makeTask(); const early = await makeTask(); const none = await makeTask();
  await prisma.task.update({ where: { id: late.id }, data: { dueAt: new Date(now + 1000) } }); await prisma.task.update({ where: { id: early.id }, data: { dueAt: clock() } });
  const first = (await http<ListData>('/admin/tasks?view=pool&pageSize=1')).data; expect(first.total).toBe(3); expect(first.items[0]!.id).toBe(early.id);
  expect((await http<ListData>('/admin/tasks?view=pool&page=3&pageSize=1')).data.items[0]!.id).toBe(none.id);
  expect((await http<ListData>(`/admin/tasks?view=pool&businessType=ORDER&businessId=${late.businessId}&stage=SHIPMENT_PROCESS&status=OPEN&overdue=false`)).data.total).toBe(1);
  expect((await http<ListData>('/admin/tasks?view=pool&overdue=true')).data.items.map(row => row.id)).toEqual([early.id]);
  expect((await http<ListData>('/admin/tasks?view=pool&page=9007199254740991&pageSize=100')).data).toMatchObject({ items: [], total: 3 });
});
it('列表与总数使用同一快照，查询中新增任务不污染本页', async () => {
  await makeTask(); const gate = barrier(); let scopes = 0; adapters.onScope = async () => { if (++scopes === 1) { gate.signal(); await gate.held; } };
  const pending = http<ListData>('/admin/tasks?view=pool'); await gate.ready;
  try { await makeTask(); } finally { gate.release(); } const result = (await pending).data; expect(result.total).toBe(1); expect(result.items).toHaveLength(1);
  adapters.onScope = undefined; expect((await http<ListData>('/admin/tasks?view=pool')).data.total).toBe(2);
});
it('摘要卡片允许重叠，终结任务不算当前逾期，未扫描当前逾期也属于曾逾期', async () => {
  const task = await makeTask(); await prisma.task.update({ where: { id: task.id }, data: { dueAt: clock(), reassignNeeded: true } });
  expect((await http<SummaryData>('/admin/tasks/summary')).data).toMatchObject({ eligibleOpen: 1, currentOverdue: 1, everOverdue: 1, reassignNeeded: null });
  expect((await http<SummaryData>('/admin/tasks/summary', { person: manager })).data.reassignNeeded).toBe(1);
  expect((await http<ListData>('/admin/tasks?view=reassign', { person: manager })).data.total).toBe(1); await http('/admin/tasks?view=reassign', { status: 403 });
  await claim(task); expect((await http<SummaryData>('/admin/tasks/summary')).data).toMatchObject({ myPending: 1, eligibleOpen: 0, currentOverdue: 1 });
  await prisma.task.update({ where: { id: task.id }, data: { status: 'COMPLETED', assigneeId: null, closedAt: clock(), everOverdue: true, firstOverdueAt: clock() } });
  expect((await http<SummaryData>('/admin/tasks/summary')).data).toMatchObject({ myPending: 0, currentOverdue: 0, everOverdue: 1 });
});
it('详情只返回白名单，动作依据资格/经办/业务条件，历史原因可以隐藏', async () => {
  const task = await makeTask(); const detail = (await http<DetailData>(`/admin/tasks/${task.id}`)).data;
  expect(detail.allowedActions).toEqual(['claim']); expect(detail.business).toEqual({ number: `ISOLATED-${task.businessId}`, label: '隔离服装业务任务', detailPath: null });
  expect(detail).not.toHaveProperty('entryKey'); expect(detail).not.toHaveProperty('passwordHash'); expect(detail).not.toHaveProperty('actorEmployeeId');
  await prisma.$executeRaw`UPDATE task_entry_fixture SET claim_allowed=false,hidden_reason=true WHERE id=${task.businessId}::uuid`;
  expect((await http<DetailData>(`/admin/tasks/${task.id}`)).data.allowedActions).toEqual([]);
  expect((await http<HistoryData>(`/admin/tasks/${task.id}/history`)).data.items[0]!.reason).toBeNull();
  const before = await state(); expect((await claim(task, warehouse, 0, 409)).code).toBe('TASK_ENTRY_BLOCKED'); expect(await state()).toEqual(before);
});
it('统一时间线合并任务与期限事件，发生时间而非检测时间排序，跨页稳定且不输出审计/账号', async () => {
  const task = await makeTask(); await claim(task); now += 1000; await release(task);
  const event = await prisma.deadlineEvent.create({ data: { taskId: task.id, eventType: 'OVERDUE', deadlineAt: start, occurredAt: start, detectedAt: clock(), actorType: 'SYSTEM', commandKey: 'isolated-overdue', requestId: randomUUID() } });
  const one = (await http<HistoryData>(`/admin/tasks/${task.id}/history?pageSize=2`)).data; const two = (await http<HistoryData>(`/admin/tasks/${task.id}/history?pageSize=2&page=2`)).data;
  const combined = [...one.items, ...two.items]; expect(one.total).toBe(4); expect(two.total).toBe(4); expect(new Set(combined.map(row => row.id)).size).toBe(4);
  expect(combined[0]).toMatchObject({ kind: 'TASK_CHANGE', action: 'RELEASED' }); expect(combined[1]).toMatchObject({ id: event.id, kind: 'DEADLINE_EVENT' });
  expect(JSON.stringify(combined)).not.toMatch(/requestId|actorEmployeeId|username|task\.claim|password/);
});
it('领取与释放保留轮次/规则/期限，mine仅当前本人；准确旧版本重放不重复历史审计', async () => {
  const task = await makeTask(); await prisma.task.update({ where: { id: task.id }, data: { dueAt: clock(), reassignNeeded: true } }); const original = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
  expect((await claim(task)).data).toMatchObject({ changed: true, task: { version: 1, round: 1, status: 'CLAIMED', reassignNeeded: false, assignee: { id: warehouse.identity.subjectId } } });
  const afterClaim = await state(); expect((await claim(task)).data.changed).toBe(false); expect(await state()).toEqual(afterClaim);
  expect((await http<ListData>('/admin/tasks')).data.items.map(row => row.id)).toEqual([task.id]); expect((await http<ListData>('/admin/tasks', { person: manager })).data.total).toBe(0);
  expect((await release(task)).data).toMatchObject({ changed: true, task: { status: 'OPEN', assignee: null, version: 2, round: 1 } });
  const afterRelease = await state(); expect((await release(task)).data.changed).toBe(false); expect(await state()).toEqual(afterRelease);
  const current = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
  expect(current).toMatchObject({ startedAt: original.startedAt, dueAt: original.dueAt, originalDueAt: original.originalDueAt, ruleSnapshot: original.ruleSnapshot, settingsVersionId: original.settingsVersionId });
  expect(await prisma.taskStageCursor.findFirstOrThrow()).toMatchObject({ lastRound: 1 }); expect(await prisma.taskHistory.count()).toBe(3); expect(await prisma.auditLog.count()).toBe(3);
});
it('释放或再次领取后的旧请求不能ABA重放，同版本不同释放原因也不能伪成功', async () => {
  const task = await makeTask(); await claim(task); await release(task);
  expect((await release(task, warehouse, 1, '另一原因', 409)).code).toBe('VERSION_CONFLICT');
  expect((await claim(task, warehouse, 0, 409)).code).toBe('VERSION_CONFLICT'); await claim(task, warehouse, 2);
  expect((await claim(task, warehouse, 0, 409)).code).toBe('VERSION_CONFLICT'); expect((await release(task, warehouse, 1, '交班前已确认安全交接', 409)).code).toBe('VERSION_CONFLICT');
});
it('他人领取与非经办释放明确409，管理员也必须显式领取', async () => {
  const task = await makeTask(); await claim(task); expect((await claim(task, manager, 0, 409)).code).toBe('TASK_ALREADY_CLAIMED');
  expect((await release(task, manager, 1, '管理员也不能越过经办', 409)).code).toBe('TASK_NOT_ASSIGNEE');
});
it.each(['SUSPENDED', 'COMPLETED', 'CANCELLED'] as const)('%s不能领取或借释放恢复', async status => {
  const task = await makeTask(); await prisma.task.update({ where: { id: task.id }, data: { status, ...(status === 'SUSPENDED' ? {} : { closedAt: clock() }) } });
  expect((await claim(task, warehouse, 0, 409)).code).toBe('TASK_NOT_OPEN'); expect((await release(task, warehouse, 0, '不能恢复', 409)).code).toBe('TASK_NOT_ASSIGNEE');
});
it('交运/领域状态不能安全交接时拒绝释放，不改任务/轮次/截止/业务', async () => {
  const task = await makeTask(); await claim(task); await prisma.$executeRaw`UPDATE task_entry_fixture SET safe_release=false WHERE id=${task.businessId}::uuid`;
  const before = await state(); expect((await release(task, warehouse, 1, '尚不能交班', 409)).code).toBe('TASK_RELEASE_BLOCKED'); expect(await state()).toEqual(before);
  expect((await http<DetailData>(`/admin/tasks/${task.id}`)).data.allowedActions).toEqual([]);
});
it.each(['task.claim', 'task.release'] as const)('%s实际落审计后故障，领域/任务/历史/审计全部回滚', async action => {
  const task = await makeTask(); if (action === 'task.release') await claim(task); const before = await state(); audit.failAction = action;
  if (action === 'task.claim') await claim(task, warehouse, 0, 500); else await release(task, warehouse, 1, '隔离故障回滚', 500);
  expect(audit.observed).toBe(true); expect(await state()).toEqual(before);
});
it('20名合资格员工、20个独立数据库连接真实争领，仅一成功/一条领取历史', async () => {
  const task = await makeTask(); const people: Person[] = []; const clients: PrismaService[] = [];
  for (let index = 0; index < 20; index++) { people.push(await person('MERCH_WAREHOUSE', `access_race_${index}`)); const client = new PrismaService(config); await client.onModuleInit(); clients.push(client); }
  const pid = Number((await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid); await holder.query('BEGIN'); await holder.query('SELECT id FROM task_entry_fixture WHERE id=$1 FOR UPDATE', [task.businessId]);
  // 每名员工各用独立Prisma/pg连接，服务共享真实身份/锁/审计能力；观察阻塞后才放行。
  const pending = people.map((who, index) => new TaskCommandService(clients[index]!, app.get(TaskAccessService), app.get(TaskLockService), audit, { now: clock }, adapters, new PermissionService())
    .claim(who.identity, who.token, task.id, { expectedVersion: 0 }, randomUUID()));
  const results = Promise.allSettled(pending);
  try {
    try { await waitBlocked(pid, 20); } finally { await holder.query('COMMIT'); }
    const settled = await results; expect(settled.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter(row => row.status === 'rejected').map(row => row.reason.code)).toEqual(Array(19).fill('TASK_ALREADY_CLAIMED'));
    expect(await prisma.taskHistory.count({ where: { action: 'CLAIMED' } })).toBe(1); expect(await prisma.auditLog.count({ where: { action: 'task.claim' } })).toBe(1);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).version).toBe(1);
  } finally { await results; await Promise.all(clients.map(client => client.$disconnect())); }
}, 20_000);
it('等待员工锁期间撤销会话后复核拒绝，未提交任何任务动作', async () => {
  const task = await makeTask(); const before = await state(); const pid = Number((await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
  await holder.query('BEGIN'); await holder.query('SELECT id FROM employee WHERE id=$1 FOR UPDATE', [warehouse.identity.subjectId]);
  const pending = claim(task, warehouse, 0, 401);
  try { await waitBlocked(pid); await holder.query("UPDATE auth_session SET revoked_at=GREATEST(created_at,clock_timestamp()),revoke_reason='LOGOUT' WHERE id=$1", [warehouse.identity.sessionId]); }
  finally { await holder.query('COMMIT'); }
  expect((await pending).code).toBe('SESSION_REVOKED'); expect(await state()).toEqual(before);
});
it('业务检查等待期间凭证到期，写入前复核拒绝并回滚领域进度', async () => {
  const task = await makeTask(); const before = await state(); adapters.onClaim = async () => { now += 7200_000; };
  expect((await claim(task, warehouse, 0, 401)).code).toBe('TOKEN_EXPIRED'); expect(await state()).toEqual(before);
});
it('锁计划归属变化整笔回滚后重定位，整体最多三次，不在下游锁后补取顾客', async () => {
  const task = await makeTask(); const other = (await prisma.customer.create({ data: { phone: '19900000012', passwordHash, nickname: '隔离迁移顾客' } })).id;
  const gate = barrier(); let calls = 0; adapters.onPlan = async () => { if (++calls === 1) { gate.signal(); await gate.held; } };
  const pending = claim(task); await gate.ready; try { await peer.$executeRaw`UPDATE task_entry_fixture SET customer_id=${other}::uuid WHERE id=${task.businessId}::uuid`; } finally { gate.release(); }
  expect((await pending).data.changed).toBe(true); expect(calls).toBe(4); expect(await prisma.taskHistory.count({ where: { action: 'CLAIMED' } })).toBe(1);
});
it.each(['?page=0', '?pageSize=101', '?view=all', '?overdue=0', '?overdue=true&overdue=false', '?stage=toString', '?status=NOPE', '?businessId=invalid', '?secret=leak'])('严格查询拒绝%s', async query => {
  expect((await http(`/admin/tasks${query}`, { status: 400 })).code).toBe('VALIDATION_FAILED');
});
it.each([{ expectedVersion: '0' }, { expectedVersion: true }, { expectedVersion: 1.2 }, { expectedVersion: -1 }, { expectedVersion: 2147483648 }, { expectedVersion: 0, assigneeId: randomUUID() }, {}])('领取HTTP严格拒绝%s', async body => {
  const task = await makeTask(); expect((await http(`/admin/tasks/${task.id}/claim`, { body, status: 400 })).code).toBe('VALIDATION_FAILED'); expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).version).toBe(0);
});
it('释放原因必填、规范化且按Unicode长度限制，不能夹带状态或经办', async () => {
  const task = await makeTask(); await claim(task);
  for (const body of [{ expectedVersion: 1 }, { expectedVersion: 1, reason: ' ' }, { expectedVersion: 1, reason: '😀'.repeat(501) }, { expectedVersion: 1, reason: '交班', status: 'COMPLETED' }])
    expect((await http(`/admin/tasks/${task.id}/release`, { body, status: 400 })).code).toBe('VALIDATION_FAILED');
  expect((await release(task, warehouse, 1, ` ${'😀'.repeat(500)} `)).data.changed).toBe(true);
});
