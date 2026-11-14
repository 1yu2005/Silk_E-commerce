// 作用：在本轮专属PostgreSQL库验证任务真实锁、阶段幂等、轮次/期限快照和业务/历史/审计整体回滚。
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Prisma, SubjectType, Task } from '@prisma/client';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { assertSafeTestDatabase } from '../scripts/database-env.js';
import { runPrisma } from '../scripts/database.js';
import { AppModule } from '../src/app.module.js';
import { InventoryAdapters } from '../src/inventory/inventory.adapters.js';
import { AuditService, type AuditAction, type AuditPayload } from '../src/audit/audit.service.js';
import { AuthSessionService } from '../src/auth/auth-session.service.js';
import { CurrentIdentityService } from '../src/auth/current-identity.service.js';
import { JwtTokenService } from '../src/auth/jwt-token.service.js';
import { PasswordService } from '../src/auth/password.service.js';
import { Clock } from '../src/common/time/clock.js';
import { APP_CONFIG, loadConfiguration } from '../src/config/environment.js';
import { PermissionService } from '../src/permissions/permission.service.js';
import { seedPermissionCatalog } from '../src/permissions/permission-seed.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { TaskBusinessAdapters, type TaskBusinessReference, type TaskStageEntry } from '../src/tasks/task-business-adapters.js';
import { TaskEntryService, type TaskActorAccess, type TaskEntryContext } from '../src/tasks/task-entry.service.js';
import { createFixture, FixtureTaskAdapters, installFixtureTables, observeLocks, type FixtureBusiness, type LockObservation } from './fixtures/task-entry-business.js';

const safe = assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('任务进入测试仅限隔离环境');
const url = new URL(safe.testUrl); url.pathname = `/task_entry_${randomUUID().replaceAll('-', '')}_test`;
const target = assertSafeTestDatabase(safe.developmentUrl, url.toString());
if (!/^task_entry_[a-f0-9]{32}_test$/.test(target.testName)) throw new Error('隔离库名不合法');
const postgres = new URL(safe.testUrl); postgres.pathname = '/postgres';
const admin = new Client({ connectionString: postgres.toString() }); const holder = new Client({ connectionString: target.testUrl });
let created = false; let app: INestApplication; let prisma: PrismaService; let peer: PrismaService; let service: TaskEntryService;
const start = new Date('2026-11-13T02:00:00.000Z'); let now = start.getTime(); const clock = () => new Date(now);
const tokens = new JwtTokenService({ secret: 'task-entry-isolated-only-key-2026-'.repeat(2), ttlSeconds: 7200 }, clock);
const sessions = new AuthSessionService(tokens, clock); const adapters = new FixtureTaskAdapters();
class ControlledAudit extends AuditService {
  failAction: AuditAction | null = null; observed = false;
  override async appendAudit(tx: Prisma.TransactionClient, payload: AuditPayload) {
    await super.appendAudit(tx, payload);
    if (payload.action === this.failAction) {
      this.observed = await tx.auditLog.count({ where: { requestId: payload.requestId } }) > 0 && await tx.taskStageCursor.count() > 0;
      throw new Error('仅隔离测试：实际审计写入后故障');
    }
  }
}
const audit = new ControlledAudit(); let passwordHash = ''; let customerId = ''; let otherCustomerId = '';
let operatorId = ''; let peerId = ''; let operatorAccess: TaskActorAccess; let peerAccess: TaskActorAccess; let customerAccess: TaskActorAccess;
beforeAll(async () => {
  await admin.connect(); await admin.query(`CREATE DATABASE "${target.testName}" ENCODING 'UTF8' TEMPLATE template0`); created = true;
  runPrisma(['migrate', 'deploy'], { ...process.env, DATABASE_URL: target.testUrl });
  const config = loadConfiguration({ ...process.env, DATABASE_URL: target.testUrl, LOG_LEVEL: 'silent' });
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(APP_CONFIG).useValue(config)
    .overrideProvider(JwtTokenService).useValue(tokens).overrideProvider(AuthSessionService).useValue(sessions)
    .overrideProvider(CurrentIdentityService).useValue(new CurrentIdentityService(tokens, new PermissionService(), clock))
    .overrideProvider(Clock).useValue({ now: clock }).overrideProvider(AuditService).useValue(audit).overrideProvider(TaskBusinessAdapters).useValue(adapters).overrideProvider(InventoryAdapters).useValue({onModuleInit(){ /* 本文件用真实SQL父事实夹具统一替代业务适配器，库存正式注册由库存集成测试验证。 */ }}).compile();
  app = module.createNestApplication(); await app.init(); prisma = app.get(PrismaService); service = app.get(TaskEntryService);
  peer = new PrismaService(config); await peer.onModuleInit(); await holder.connect();
  await prisma.$transaction(installFixtureTables); await seedPermissionCatalog(prisma); passwordHash = await new PasswordService().hash('IsolatedEntry#2026');
}, 45_000);
async function access(subjectId: string, subjectType: SubjectType = 'EMPLOYEE'): Promise<TaskActorAccess> {
  const login = await prisma.$transaction(tx => sessions.createAfterPasswordVerified(tx, { subjectId, subjectType, expectedPasswordHash: passwordHash, expectedTokenVersion: 0 }));
  return { type: subjectType, subjectId, token: login.accessToken };
}
beforeEach(async () => {
  now = start.getTime(); audit.failAction = null; audit.observed = false; adapters.onPlan = undefined; adapters.onResolve = undefined;
  // 清理范围为本文件CREATE成功的随机库；不TRUNCATE开发库或共享shop_test。
  await prisma.deadlineEvent.deleteMany(); await prisma.taskHistory.deleteMany(); await prisma.task.deleteMany(); await prisma.taskStageCursor.deleteMany();
  await prisma.$executeRawUnsafe('DELETE FROM task_entry_fixture'); await prisma.$executeRawUnsafe('DELETE FROM task_entry_fixture_resource');
  await prisma.storeSettingHead.update({ where: { id: 1 }, data: { currentVersionId: null, version: 0 } }); await prisma.storeSettingVersion.deleteMany();
  await prisma.auditLog.deleteMany(); await prisma.authSession.deleteMany(); await prisma.employeeExtraPermission.deleteMany(); await prisma.employee.deleteMany(); await prisma.customer.deleteMany();
  const customer = await prisma.customer.create({ data: { phone: '19900000001', nickname: '隔离任务顾客', passwordHash } }); customerId = customer.id;
  otherCustomerId = (await prisma.customer.create({ data: { phone: '19900000002', nickname: '隔离对照顾客', passwordHash } })).id;
  operatorId = (await prisma.employee.create({ data: { username: 'entry_operator', displayName: '隔离任务管理员', role: 'SUPER_ADMIN', mustChangePassword: false, passwordHash } })).id;
  peerId = (await prisma.employee.create({ data: { username: 'entry_peer', displayName: '隔离任务对照员工', role: 'SUPER_ADMIN', mustChangePassword: false, passwordHash } })).id;
  operatorAccess = await access(operatorId); peerAccess = await access(peerId); customerAccess = await access(customerId, 'CUSTOMER');
});
afterAll(async () => {
  await holder.end(); await peer?.$disconnect(); await app?.close();
  try { if (created) { assertSafeTestDatabase(safe.developmentUrl, target.testUrl); await admin.query(`DROP DATABASE "${target.testName}"`); created = false;
    console.info('步骤5本轮独占测试库已删除，未清空共享测试库或开发库'); } }
  finally { await admin.end(); }
}, 20_000);

async function configure(patch: Record<string, number> = {}) {
  const version = await prisma.storeSettingVersion.count() + 1;
  const setting = await prisma.storeSettingVersion.create({ data: { versionNumber: version, createdByEmployeeId: operatorId, reason: '仅隔离测试配置',
    shippingFeeCents: 1000, freeShippingEnabled: true, freeShippingThresholdCents: 9900, returnReceiver: '隔离仓库', returnPhone: '01000000000',
    returnProvince: '测试省', returnCity: '测试市', returnDistrict: '测试区', returnDetail: '仅独占测试库', servicePhone: '01000000000', serviceHours: null,
    paymentMinutes: 30, autoReceiptDays: 10, afterSaleWindowDays: 7, reviewWorkdays: 2, supplementDays: 7, returnShipDays: 5, inspectionWorkdays: 3, refundWorkdays: 1, ...patch } });
  await prisma.storeSettingHead.update({ where: { id: 1 }, data: { currentVersionId: setting.id, version } }); return setting;
}
const reference = (root: FixtureBusiness): TaskBusinessReference => ({ businessType: root.businessType, businessId: root.id });
async function fixture(patch: Partial<FixtureBusiness> = {}) { return createFixture(prisma, customerId, patch); }
async function enter(root: FixtureBusiness, patch: Partial<TaskStageEntry> = {}, options: { actor?: TaskActorAccess; client?: PrismaService;
  before?: (tx: Prisma.TransactionClient, context: TaskEntryContext) => Promise<void>; trace?: LockObservation[]; requestId?: string } = {}) {
  return (options.client ?? prisma).$transaction(async raw => {
    const tx = options.trace ? observeLocks(raw, options.trace) : raw;
    return service.withContext(tx, options.actor ?? operatorAccess, [reference(root)], options.requestId ?? randomUUID(), async context => {
      await options.before?.(tx, context);
      return service.enterStage(context, { ...reference(root), stage: root.allowedStage as TaskStageEntry['stage'], entryKey: 'entry:first', reason: '真实领域触发隔离任务', ...patch });
    });
  }, { timeout: 5000 });
}
async function state() {
  return { tasks: await prisma.task.findMany({ orderBy: { id: 'asc' } }), cursors: await prisma.taskStageCursor.findMany({ orderBy: { id: 'asc' } }),
    history: await prisma.taskHistory.findMany({ orderBy: { id: 'asc' } }), events: await prisma.deadlineEvent.findMany({ orderBy: { id: 'asc' } }),
    audits: await prisma.auditLog.findMany({ orderBy: { id: 'asc' } }), roots: await prisma.$queryRaw`SELECT * FROM task_entry_fixture ORDER BY id` };
}
async function reenter(root: FixtureBusiness, task: Task, options: Parameters<typeof enter>[2] = {}) {
  await prisma.$executeRaw`UPDATE task_entry_fixture SET replace_active=true,expected_task_id=${task.id}::uuid,expected_version=${task.version},started_at=${clock()} WHERE id=${root.id}::uuid`;
  return enter(root, { entryKey: 'entry:second' }, options);
}
function barrier() { let release!: () => void; let signal!: () => void; const held = new Promise<void>(yes => { release = yes; }); const ready = new Promise<void>(yes => { signal = yes; }); return { release, signal, held, ready }; }
async function waitForBlocked(pid: number, count: number) {
  const until = performance.now() + 400;
  while (performance.now() < until) {
    const result = await admin.query(`WITH RECURSIVE blocked(pid) AS (
      SELECT pid FROM pg_stat_activity WHERE datname=$1 AND $2=ANY(pg_blocking_pids(pid)) UNION
      SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid=ANY(pg_blocking_pids(a.pid)) WHERE a.datname=$1
    ) SELECT count(*)::int AS count FROM blocked`, [target.testName, pid]);
    if (result.rows[0].count >= count) return;
    await new Promise(yes => setTimeout(yes, 5));
  }
  throw new Error('未观察到预期的真实PostgreSQL锁等待');
}

it('有SLA阶段未配置时拒绝，领域写入、游标及任务全部回滚', async () => {
  const root = await fixture(); const before = await state();
  await expect(enter(root, {}, { before: async tx => { await tx.$executeRaw`UPDATE task_entry_fixture SET progress=1 WHERE id=${root.id}::uuid`; } }))
    .rejects.toMatchObject({ code: 'STORE_NOT_CONFIGURED', status: 409 }); expect(await state()).toEqual(before);
});
it('无默认SLA阶段不依赖虚构设置，不接受调用方夹带截止、经办或候选权限', async () => {
  const root = await fixture({ businessType: 'ORDER', allowedStage: 'SHIPMENT_PROCESS' });
  const { task } = await enter(root, { dueAt: new Date(0), assigneeId: operatorId, requiredPermissions: ['forged'] } as Partial<TaskStageEntry>);
  expect(task).toMatchObject({ round: 1, version: 0, status: 'OPEN', assigneeId: null, dueAt: null, originalDueAt: null, settingsVersionId: null,
    requiredPermissions: ['order.fulfillment.read', 'shipment.claim', 'shipment.handover', 'shipment.pack'], ruleSnapshot: { source: 'NO_DEFAULT_SLA', unit: null, amount: null } });
  expect(await prisma.storeSettingVersion.count()).toBe(0);
});
it.each([
  ['AFTER_SALE_REVIEW', 'reviewWorkdays', 'WORKDAY', 2, '2026-11-17T02:00:00.000Z'],
  ['SUPPLEMENT_FOLLOW', 'supplementDays', 'NATURAL_DAY', 7, '2026-11-20T02:00:00.000Z'],
  ['RETURN_FOLLOW', 'returnShipDays', 'NATURAL_DAY', 5, '2026-11-18T02:00:00.000Z'],
  ['RETURN_INSPECT', 'inspectionWorkdays', 'WORKDAY', 3, '2026-11-18T02:00:00.000Z'],
  ['REFUND_PROCESS', 'refundWorkdays', 'WORKDAY', 1, '2026-11-16T02:00:00.000Z'],
] as const)('%s真实阶段固化%s期限、规则来源与北京时间算法', async (stage, field, unit, amount, due) => {
  const setting = await configure(); const root = await fixture({ allowedStage: stage }); const requestId = randomUUID();
  const { task, changed } = await enter(root, {}, { requestId }); expect(changed).toBe(true);
  expect(task).toMatchObject({ settingsVersionId: setting.id, startedAt: start, dueAt: new Date(due), originalDueAt: new Date(due), everOverdue: false,
    ruleSnapshot: { sourceField: field, unit, amount, settingsVersionNumber: 1, timeZone: 'Asia/Shanghai', algorithmVersion: 'shanghai-calendar-v1', stageCatalogVersion: 'M0-04.stages.v1' } });
  expect(await prisma.taskHistory.findMany()).toEqual([expect.objectContaining({ action: 'CREATED', actorType: 'EMPLOYEE', actorEmployeeId: operatorId, requestId, createdAt: start })]);
  expect(await prisma.auditLog.findMany()).toEqual([expect.objectContaining({ action: 'task.create', actorEmployeeId: operatorId, requestId, targetId: task.id })]);
});
it('系统和顾客驱动保留真实审计主体，顾客无需员工资格但必须属于真实业务', async () => {
  await configure(); const systemRoot = await fixture(); const customerRoot = await fixture();
  await enter(systemRoot, {}, { actor: { type: 'SYSTEM' } }); const result = await enter(customerRoot, {}, { actor: customerAccess });
  expect(await prisma.taskHistory.findFirstOrThrow({ where: { taskId: result.task.id } })).toMatchObject({ actorType: 'SYSTEM', actorEmployeeId: null });
  expect(await prisma.auditLog.findFirstOrThrow({ where: { targetId: result.task.id } })).toMatchObject({ actorType: 'CUSTOMER', actorCustomerId: customerId, actorEmployeeId: null });
  const foreign = await fixture({ customerId: otherCustomerId }); await expect(enter(foreign, {}, { actor: customerAccess })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(await prisma.task.count()).toBe(2);
});
it('生产缺失业务、缺失锁处理器和真实领域前提不满足均不创建任务', async () => {
  const missing = await fixture({ businessType: 'CUSTODY_ARRANGEMENT', allowedStage: 'CUSTODY_EXECUTE' });
  await expect(enter(missing)).rejects.toMatchObject({ code: 'BUSINESS_MODULE_NOT_READY' });
  const noLocker = await fixture({ extraLocks: [{ kind: 'CATEGORY_TREE', id: randomUUID() }] });
  await expect(enter(noLocker)).rejects.toMatchObject({ code: 'BUSINESS_MODULE_NOT_READY' });
  const blocked = await fixture({ blocked: true }); await expect(enter(blocked)).rejects.toMatchObject({ code: 'TASK_ENTRY_BLOCKED' });
  expect(await prisma.task.count()).toBe(0); expect(await prisma.taskStageCursor.count()).toBe(0);
});
it.each([{ entryKey: '' }, { entryKey: '😀'.repeat(151) }, { reason: ' ' }, { reason: '😀'.repeat(501) }])('动作键或原因非法%s不落库', async patch => {
  const root = await fixture(); await expect(enter(root, patch)).rejects.toMatchObject({ code: 'TASK_INPUT_INVALID' }); expect(await prisma.taskStageCursor.count()).toBe(0);
});
it('业务类型/阶段错配、伪造/过期上下文、跨业务使用和根客户端误传均拒绝', async () => {
  const root = await fixture({ businessType: 'ORDER', allowedStage: 'AFTER_SALE_REVIEW' }); await expect(enter(root)).rejects.toMatchObject({ code: 'TASK_STAGE_NOT_APPLICABLE' });
  const entry = { ...reference(root), stage: 'SHIPMENT_PROCESS' as const, entryKey: 'a', reason: '上下文测试' };
  await expect(service.enterStage({ requestId: randomUUID() }, entry)).rejects.toMatchObject({ code: 'TASK_CONTEXT_INVALID' });
  let expired!: TaskEntryContext; await prisma.$transaction(tx => service.withContext(tx, operatorAccess, [reference(root)], randomUUID(), async ctx => { expired = ctx; }));
  await expect(service.enterStage(expired, entry)).rejects.toMatchObject({ code: 'TASK_CONTEXT_INVALID' });
  await expect(prisma.$transaction(tx => service.withContext(tx, operatorAccess, [reference(root)], randomUUID(), ctx => service.enterStage(ctx, { ...entry, businessId: randomUUID() })))).rejects.toMatchObject({ code: 'TASK_CONTEXT_INVALID' });
  await expect(service.withContext(prisma, operatorAccess, [reference(root)], randomUUID(), async () => {})).rejects.toThrow('事务客户端');
});
it('同动作键重放即使原任务已完成也返回原轮，不因新设置、原因或新请求号重算', async () => {
  await configure(); const root = await fixture(); const first = (await enter(root)).task;
  await prisma.task.update({ where: { id: first.id }, data: { status: 'COMPLETED', closedAt: clock(), version: 1 } }); await configure({ reviewWorkdays: 5 });
  const before = await state(); const repeated = await enter(root, { reason: '重试原因不同' });
  expect(repeated.changed).toBe(false); expect(repeated.task).toMatchObject({ id: first.id, round: 1, status: 'COMPLETED', dueAt: first.dueAt, settingsVersionId: first.settingsVersionId });
  expect(await state()).toEqual(before);
});
it('新动作键不自动替换现有有效任务，拒绝后回滚调用方领域写入', async () => {
  await configure(); const root = await fixture(); await enter(root); const before = await state();
  await expect(enter(root, { entryKey: 'new-entry' }, { before: async tx => { await tx.$executeRaw`UPDATE task_entry_fixture SET progress=99 WHERE id=${root.id}::uuid`; } }))
    .rejects.toMatchObject({ code: 'TASK_STAGE_ACTIVE' }); expect(await state()).toEqual(before);
});
it.each(['OPEN', 'CLAIMED', 'SUSPENDED'] as const)('领域明确替换%s旧轮后，新轮清经办并固化最新设置；旧规则/原截止不回写', async status => {
  const v1 = await configure(); const root = await fixture(); const first = (await enter(root)).task;
  const old = await prisma.task.update({ where: { id: first.id }, data: { status, assigneeId: status === 'CLAIMED' ? peerId : null } });
  const v2 = await configure({ reviewWorkdays: 4 }); const trace: LockObservation[] = []; const next = (await reenter(root, old, { trace })).task;
  expect(next).toMatchObject({ round: 2, status: 'OPEN', assigneeId: null, settingsVersionId: v2.id, dueAt: new Date('2026-11-19T02:00:00.000Z') });
  expect(await prisma.task.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ status: 'CANCELLED', closedAt: start, assigneeId: null,
    settingsVersionId: v1.id, originalDueAt: old.originalDueAt, dueAt: old.dueAt, ruleSnapshot: old.ruleSnapshot, version: 1 });
  expect(await prisma.taskHistory.findFirstOrThrow({ where: { taskId: first.id, action: 'CANCELLED' } })).toMatchObject({ actorEmployeeId: operatorId,
    fromAssigneeId: status === 'CLAIMED' ? peerId : null, toAssigneeId: null });
  if (status === 'CLAIMED') expect(trace.filter(row => row.table === 'employee').flatMap(row => row.ids)).toEqual([operatorId, peerId].sort());
});
it('领域确认完成旧轮及版本冲突分别处理，不开放通用完成接口', async () => {
  await configure(); const root = await fixture({ outcome: 'COMPLETED' }); const first = (await enter(root)).task;
  await reenter(root, first); expect((await prisma.task.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('COMPLETED');
  const current = await prisma.task.findFirstOrThrow({ where: { status: 'OPEN' } });
  await prisma.$executeRaw`UPDATE task_entry_fixture SET expected_task_id=${current.id}::uuid,expected_version=999 WHERE id=${root.id}::uuid`;
  const before = await state(); await expect(enter(root, { entryKey: 'entry:third' })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' }); expect(await state()).toEqual(before);
});
it('旧截止等号时重入先记真实逾期，重放不重记且新轮不继承旧逾期标志', async () => {
  await configure(); const root = await fixture(); const first = (await enter(root)).task; now = first.dueAt!.getTime(); const requestId = randomUUID();
  // 推进数天仅模拟期限事实；员工必须在新时刻重新登录，不能绕过真实两小时凭证校验。
  operatorAccess = await access(operatorId);
  const next = (await reenter(root, first, { requestId })).task;
  expect(await prisma.deadlineEvent.findMany()).toEqual([expect.objectContaining({ taskId: first.id, eventType: 'OVERDUE', deadlineAt: first.dueAt, occurredAt: first.dueAt, detectedAt: clock(), requestId })]);
  expect(await prisma.task.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ everOverdue: true, firstOverdueAt: first.dueAt, dueAt: first.dueAt });
  expect(next).toMatchObject({ everOverdue: false, firstOverdueAt: null, round: 2 }); const before = await state(); await enter(root, { entryKey: 'entry:second' }); expect(await state()).toEqual(before);
});
it('已有同截止逾期事件时复用唯一事实，保留更早首次逾期，不重复审计', async () => {
  await configure(); const root = await fixture(); const first = (await enter(root)).task; now = first.dueAt!.getTime() + 1000;
  operatorAccess = await access(operatorId);
  const earlier = new Date(first.dueAt!.getTime() - 86400000);
  await prisma.task.update({ where: { id: first.id }, data: { everOverdue: true, firstOverdueAt: earlier } });
  await prisma.deadlineEvent.create({ data: { taskId: first.id, eventType: 'OVERDUE', deadlineAt: first.dueAt!, occurredAt: first.dueAt!, detectedAt: clock(), actorType: 'SYSTEM', commandKey: 'earlier-scan', requestId: randomUUID() } });
  await reenter(root, first); expect(await prisma.deadlineEvent.count()).toBe(1); expect(await prisma.auditLog.count({ where: { action: 'task.overdue.record' } })).toBe(0);
  expect((await prisma.task.findUniqueOrThrow({ where: { id: first.id } })).firstOverdueAt).toEqual(earlier);
});
it.each(['task.create', 'task.stage.cancel', 'task.overdue.record'] as const)('%s真实落审计后故障，业务、游标、旧/新任务、历史、事件、审计整体回滚', async action => {
  await configure(); const root = await fixture(); const first = (await enter(root)).task; now = first.dueAt!.getTime();
  operatorAccess = await access(operatorId);
  await prisma.$executeRaw`UPDATE task_entry_fixture SET replace_active=true,expected_task_id=${first.id}::uuid,expected_version=0,started_at=${clock()} WHERE id=${root.id}::uuid`;
  const before = await state(); audit.failAction = action;
  await expect(enter(root, { entryKey: 'entry:second' }, { before: async tx => { await tx.$executeRaw`UPDATE task_entry_fixture SET progress=1 WHERE id=${root.id}::uuid`; } })).rejects.toThrow('实际审计写入后故障');
  expect(audit.observed).toBe(true); expect(await state()).toEqual(before);
});
it.each([true, false])('两个独立连接真实争锁，同动作键=%s只提交一个有效任务和轮次', async sameKey => {
  await configure(); const root = await fixture(); const pid = Number((await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
  await holder.query('BEGIN'); await holder.query('SELECT id FROM task_entry_fixture WHERE id=$1 FOR UPDATE', [root.id]);
  const first = enter(root); const second = enter(root, { entryKey: sameKey ? 'entry:first' : 'entry:another' }, { actor: peerAccess, client: peer });
  const results = Promise.allSettled([first, second]);
  try { await waitForBlocked(pid, 2); } finally { await holder.query('COMMIT'); }
  const settled = await results; const successes = settled.filter(result => result.status === 'fulfilled');
  expect(successes).toHaveLength(sameKey ? 2 : 1);
  if (sameKey) expect(successes.map(result => result.value.changed).sort()).toEqual([false, true]);
  else expect(settled.find(result => result.status === 'rejected')?.reason).toMatchObject({ code: 'TASK_STAGE_ACTIVE' });
  expect(await prisma.task.count()).toBe(1); expect(await prisma.taskHistory.count()).toBe(1); expect(await prisma.auditLog.count()).toBe(1);
  expect((await prisma.taskStageCursor.findFirstOrThrow()).lastRound).toBe(1);
});
it('多个业务先合并全部顾客/订单/共享SKU锁，去重后进入阶段，不能逐单反向加上游锁', async () => {
  const sku = randomUUID(); await prisma.$executeRaw`INSERT INTO task_entry_fixture_resource(id,kind) VALUES(${sku}::uuid,'SKU_STOCK')`;
  const one = await fixture({ businessType: 'ORDER', allowedStage: 'SHIPMENT_PROCESS', extraLocks: [{ kind: 'SKU_STOCK', id: sku }] });
  const two = await fixture({ businessType: 'ORDER', customerId: otherCustomerId, allowedStage: 'SHIPMENT_PROCESS', extraLocks: [{ kind: 'SKU_STOCK', id: sku }] });
  const trace: LockObservation[] = [];
  await prisma.$transaction(raw => service.withContext(observeLocks(raw, trace), operatorAccess, [reference(two), reference(one)], randomUUID(), async context => {
    for (const root of [two, one]) await service.enterStage(context, { ...reference(root), stage: 'SHIPMENT_PROCESS', entryKey: 'batch', reason: '隔离批量进入' });
  }));
  expect(trace.slice(0, 3).map(row => row.table)).toEqual(['employee', 'customer', 'customer']);
  expect(trace.filter(row => row.table === 'task_entry_fixture').flatMap(row => row.ids)).toEqual([one.id, two.id].sort());
  expect(trace.filter(row => row.table === 'task_entry_fixture_resource')).toHaveLength(1);
  const skuIndex = trace.findIndex(row => row.table === 'task_entry_fixture_resource'); expect(trace.slice(skuIndex + 1).every(row => !['employee', 'customer', 'task_entry_fixture'].includes(row.table))).toBe(true);
  expect(await prisma.task.count()).toBe(2); console.info('合并锁序证据', JSON.stringify(trace.map(row => row.table)));
});
it('预定位后上游锁集合变化则整体退出，不在持订单锁后补取新顾客锁', async () => {
  const root = await fixture({ businessType: 'ORDER', allowedStage: 'SHIPMENT_PROCESS' }); const gate = barrier(); let calls = 0;
  adapters.onPlan = async () => { if (++calls === 1) { gate.signal(); await gate.held; } };
  const trace: LockObservation[] = []; const pending = enter(root, {}, { trace }); const result = pending.then(value => ({ value }), error => ({ error }));
  await gate.ready;
  try { await peer.$executeRaw`UPDATE task_entry_fixture SET customer_id=${otherCustomerId}::uuid WHERE id=${root.id}::uuid`; } finally { gate.release(); }
  expect(await result).toMatchObject({ error: { code: 'TASK_LOCK_PLAN_CHANGED' } });
  expect(trace.filter(row => row.table === 'customer').flatMap(row => row.ids)).toEqual([customerId]); expect(await prisma.task.count()).toBe(0);
});
it('等待游标期间凭证到期，最终身份复核拒绝并回滚领域写入', async () => {
  await configure(); const root = await fixture(); const first = (await enter(root)).task;
  await prisma.task.update({ where: { id: first.id }, data: { status: 'COMPLETED', closedAt: clock() } });
  const before = await state(); const pid = Number((await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
  await holder.query('BEGIN'); await holder.query('SELECT id FROM task_stage_cursor WHERE id=$1 FOR UPDATE', [first.cursorId]);
  const pending = enter(root, { entryKey: 'entry:after-expiry' }, { before: async tx => { await tx.$executeRaw`UPDATE task_entry_fixture SET progress=1 WHERE id=${root.id}::uuid`; } });
  const result = pending.then(value => ({ value }), error => ({ error }));
  try { await waitForBlocked(pid, 1); now += 7200_000; } finally { await holder.query('COMMIT'); }
  expect(await result).toMatchObject({ error: { code: 'TOKEN_EXPIRED' } }); expect(await state()).toEqual(before);
});
it.each(['mustChangePassword', 'disabled', 'role', 'foreign-token'] as const)('持锁复核%s拒绝旧身份进入', async mode => {
  await configure(); const root = await fixture();
  if (mode === 'mustChangePassword') await prisma.employee.update({ where: { id: operatorId }, data: { mustChangePassword: true } });
  if (mode === 'disabled') await prisma.employee.update({ where: { id: operatorId }, data: { status: 'DISABLED' } });
  if (mode === 'role') await prisma.employee.update({ where: { id: operatorId }, data: { role: 'MERCH_WAREHOUSE' } });
  const actor = mode === 'foreign-token' ? { ...peerAccess, subjectId: operatorId } as TaskActorAccess : operatorAccess;
  await expect(enter(root, {}, { actor })).rejects.toMatchObject({ code: mode === 'mustChangePassword' ? 'PASSWORD_CHANGE_REQUIRED' : mode === 'disabled' ? 'ACCOUNT_UNAVAILABLE' : mode === 'role' ? 'FORBIDDEN' : 'TOKEN_INVALID' });
  expect(await prisma.task.count()).toBe(0); expect(await prisma.taskStageCursor.count()).toBe(0);
});
