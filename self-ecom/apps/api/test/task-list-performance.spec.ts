// 作用：约束任务范围不展开全业务ID，分页摘要与经办批量读取，保留完整权限及动作投影。
import { randomUUID } from 'node:crypto';
import { Prisma, type Task, type TaskBusinessType } from '@prisma/client';
import { expect, it, vi } from 'vitest';
import { TaskAccessService } from '../src/tasks/task-access.service.js';
import { TaskBusinessAdapters, type TaskBusinessAccess, type TaskEmployee } from '../src/tasks/task-business-adapters.js';
import type { CurrentIdentityService } from '../src/auth/current-identity.service.js';
import type { Clock } from '../src/common/time/clock.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { TaskQueryService } from '../src/tasks/task-query.service.js';
import { TaskQueryDto } from '../src/tasks/task.dto.js';

const actor = { subjectType: 'EMPLOYEE', subjectId: randomUUID(), role: 'SUPER_ADMIN', effectivePermissions: ['task.transfer'] } as TaskEmployee;
it('10万业务的读取范围使用真实领域谓词，参数量不随业务总量增长', async () => {
  const visibleBusinessIds = vi.fn(async () => Array.from({ length: 100000 }, () => randomUUID()));
  const access = { visibleBusinessIds, visibleScope: () => Prisma.sql`EXISTS (SELECT 1 FROM "order" o WHERE o.id=t.business_id)` } as unknown as TaskBusinessAccess;
  const adapters = { accessEntries: () => [['ORDER', access]] } as unknown as TaskBusinessAdapters;
  const scope = await new TaskAccessService(adapters, {} as CurrentIdentityService).scope({} as Prisma.TransactionClient, actor);
  expect(visibleBusinessIds).not.toHaveBeenCalled();
  expect(scope.values.length).toBeLessThan(64);
  expect(scope.text).toContain('EXISTS');
});

it('20到100行只增加行数，业务摘要及员工各一批；动作仍使用每行状态和资格', async () => {
  const view = { number: 'ORDER-1', label: '订单待发货', detailPath: '/orders/one', canClaim: true, canRelease: true, canReadHistoryReasons: true, canTransfer: true };
  const describe = vi.fn(async () => view), describeMany = vi.fn(async (_tx: unknown, _actor: unknown, tasks: readonly Task[]) => new Map(tasks.map(t => [t.id, view])));
  const adapters = { access: () => ({ describe, describeMany }), getHandoff: () => ({}), getDeadline: () => undefined } as unknown as TaskBusinessAdapters;
  const findMany = vi.fn(async () => [{ id: actor.subjectId, displayName: '隔离员工' }]);
  const tx = { employee: { findMany } } as unknown as Prisma.TransactionClient;
  const access = new TaskAccessService(adapters, {} as CurrentIdentityService);
  for (const size of [20, 100]) {
    const tasks = Array.from({ length: size }, (_, n) => ({ id: randomUUID(), businessType: 'ORDER', businessId: randomUUID(),
      stage: 'SHIPMENT_PROCESS', status: n % 2 ? 'CLAIMED' : 'OPEN', assigneeId: n % 2 ? actor.subjectId : null,
      requiredPermissions: ['order.fulfillment.read', 'shipment.claim', 'shipment.pack', 'shipment.handover'], version: 0,
      dueAt: null, everOverdue: false } as Task));
    const full = { ...actor, effectivePermissions: [...actor.effectivePermissions, 'order.fulfillment.read', 'shipment.claim', 'shipment.pack', 'shipment.handover'] };
    const items = await access.presentMany(tx, full, tasks, new Date());
    expect(items).toHaveLength(size);
    expect(items[0]!.allowedActions).toEqual(['claim', 'transfer']);
    expect(items[1]!.allowedActions).toEqual(['release', 'transfer']);
    expect(items[1]!.assignee?.id).toBe(actor.subjectId);
  }
  expect(describe).not.toHaveBeenCalled(); expect(describeMany).toHaveBeenCalledTimes(2); expect(findMany).toHaveBeenCalledTimes(2);
});

// 选中业务只调用该业务适配器；无筛选保持所有范围和旧ID端口的错误语义。
// 使用Reflect让测试补丁能先独立应用，RED来自实际行为而非旧签名的TS参数个数。
const selectedScope = (service: TaskAccessService, type?: TaskBusinessType) =>
  Reflect.apply(service.scope, service, [{} as Prisma.TransactionClient, actor, type]) as Promise<Prisma.Sql>;

it.each(['ORDER', 'AFTER_SALE'] as const)('%s筛选不构造或执行其他业务的读取范围', async selected => {
  const visibleScope = vi.fn(() => Prisma.sql`EXISTS (SELECT 1 FROM selected_business b WHERE b.id=t.business_id)`);
  const visibleBusinessIds = vi.fn(async () => { throw new Error('SQL谓词不得退回ID展开'); });
  const unrelatedScope = vi.fn(() => { throw new Error('无关SQL适配器不可执行'); });
  const unrelatedIds = vi.fn(async () => { throw new Error('无关旧ID适配器不可执行'); });
  const entries = [
    [selected === 'ORDER' ? 'AFTER_SALE' : 'ORDER', { visibleScope: unrelatedScope, visibleBusinessIds: unrelatedIds }],
    ['OFFLINE_CASE', { visibleBusinessIds: unrelatedIds }],
    [selected, { visibleScope, visibleBusinessIds }],
  ];
  const adapters = { accessEntries: () => entries } as unknown as TaskBusinessAdapters;
  const result = await selectedScope(new TaskAccessService(adapters, {} as CurrentIdentityService), selected);
  expect(visibleScope).toHaveBeenCalledExactlyOnceWith(actor);
  expect(visibleBusinessIds).not.toHaveBeenCalled(); expect(unrelatedScope).not.toHaveBeenCalled(); expect(unrelatedIds).not.toHaveBeenCalled();
  expect(result.text).toContain('EXISTS (SELECT 1 FROM selected_business'); expect(result.values).toEqual([selected]);
});

it('选中业务仍兼容去重后的visibleBusinessIds，无筛选调用全部已注册范围', async () => {
  const orderId = randomUUID(), saleId = randomUUID();
  const orderIds = vi.fn(async () => [orderId, orderId]), saleIds = vi.fn(async () => [saleId]);
  const adapters = { accessEntries: () => [['ORDER', { visibleBusinessIds: orderIds }], ['AFTER_SALE', { visibleBusinessIds: saleIds }]] } as unknown as TaskBusinessAdapters;
  const access = new TaskAccessService(adapters, {} as CurrentIdentityService);
  const selected = await selectedScope(access, 'ORDER');
  expect(selected.values).toEqual(['ORDER', orderId]); expect(orderIds).toHaveBeenCalledTimes(1); expect(saleIds).not.toHaveBeenCalled();
  const unfiltered = await selectedScope(access);
  expect(unfiltered.values).toEqual(['ORDER', orderId, 'AFTER_SALE', saleId]);
  expect(orderIds).toHaveBeenCalledTimes(2); expect(saleIds).toHaveBeenCalledTimes(1);
});

it('未注册的选中类型得到false，不能借其他业务适配器或管理员权限扩大范围', async () => {
  const visibleScope = vi.fn(() => Prisma.sql`true`), visibleBusinessIds = vi.fn(async () => [randomUUID()]);
  const adapters = { accessEntries: () => [['ORDER', { visibleScope, visibleBusinessIds }]] } as unknown as TaskBusinessAdapters;
  const result = await selectedScope(new TaskAccessService(adapters, {} as CurrentIdentityService), 'CUSTODY_ARRANGEMENT');
  expect(result.text).toContain('false'); expect(result.values).toEqual([]);
  expect(visibleScope).not.toHaveBeenCalled(); expect(visibleBusinessIds).not.toHaveBeenCalled();
});

it.each(['sql', 'legacy'] as const)('选中或无筛选时%s适配器的真实错误继续传播', async mode => {
  const failure = new Error('选中范围读取故障');
  const visibleScope = vi.fn((): Prisma.Sql => { throw failure; });
  const visibleBusinessIds = vi.fn(async (): Promise<string[]> => { throw failure; });
  const accessAdapter = mode === 'sql' ? { visibleScope, visibleBusinessIds } : { visibleBusinessIds };
  const adapters = { accessEntries: () => [['ORDER', accessAdapter]] } as unknown as TaskBusinessAdapters;
  const access = new TaskAccessService(adapters, {} as CurrentIdentityService);
  await expect(selectedScope(access, 'ORDER')).rejects.toBe(failure);
  await expect(selectedScope(access)).rejects.toBe(failure);
  expect(mode === 'sql' ? visibleScope : visibleBusinessIds).toHaveBeenCalledTimes(2);
});

it.each(['ORDER', 'AFTER_SALE', undefined] as const)('列表将筛选%s交给范围，并保留外层业务条件', async businessType => {
  const queryRaw = vi.fn<(strings: TemplateStringsArray, ...values: unknown[]) => Promise<{ total: bigint; ids: string[] }[]>>(async () => [{ total: 0n, ids: [] }]);
  const tx = { $queryRaw: queryRaw, task: { findMany: vi.fn(async () => []) } } as unknown as Prisma.TransactionClient;
  const prisma = { $transaction: async (work: (client: Prisma.TransactionClient) => Promise<unknown>) => work(tx) } as unknown as PrismaService;
  const scope = vi.fn(async () => Prisma.sql`false`);
  const access = { authenticate: vi.fn(async () => actor), scope, presentMany: vi.fn(async () => []) } as unknown as TaskAccessService;
  const service = new TaskQueryService(prisma, access, { now: () => new Date('2026-11-13T02:00:00Z') } as Clock);
  const query = Object.assign(new TaskQueryDto(), { view: 'pool', page: 1, pageSize: 20, businessType });
  expect(await service.list(actor, 'isolated-task-scope-token', query)).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
  expect(scope).toHaveBeenCalledExactlyOnceWith(tx, actor, businessType);
  const [strings, ...values] = queryRaw.mock.calls[0]!; const statement = Prisma.sql(strings, ...values);
  if (businessType) { expect(statement.text).toContain('t.business_type='); expect(statement.values).toContain(businessType); }
  else expect(statement.text).not.toContain('t.business_type=');
});

it('计数与页面ID只读取一次，批量取行后仍按页面ID顺序投影', async () => {
  const first = { id: randomUUID() } as Task, second = { id: randomUUID() } as Task;
  const orderedIds = [second.id, first.id];
  const queryRaw = vi.fn().mockResolvedValueOnce([{ total: 2n, ids: orderedIds }])
    .mockResolvedValueOnce(orderedIds.map(id => ({ id })));
  const findMany = vi.fn(async () => [first, second]);
  const tx = { $queryRaw: queryRaw, task: { findMany } } as unknown as Prisma.TransactionClient;
  const transaction = vi.fn(async (work: (client: Prisma.TransactionClient) => Promise<unknown>) => work(tx));
  const prisma = { $transaction: transaction } as unknown as PrismaService;
  const presentMany = vi.fn(async (_tx: Prisma.TransactionClient, _actor: TaskEmployee, tasks: readonly Task[]) => tasks.map(task => ({ id: task.id })));
  const access = { authenticate: vi.fn(async () => actor), scope: vi.fn(async () => Prisma.sql`true`), presentMany } as unknown as TaskAccessService;
  const service = new TaskQueryService(prisma, access, { now: () => new Date('2026-11-13T02:00:00Z') } as Clock);
  const query = Object.assign(new TaskQueryDto(), { view: 'mine', page: 1, pageSize: 20 });
  expect(await service.list(actor, 'isolated-task-page-token', query)).toEqual({ items: orderedIds.map(id => ({ id })), total: 2, page: 1, pageSize: 20 });
  expect(queryRaw).toHaveBeenCalledTimes(1);
  expect(findMany).toHaveBeenCalledExactlyOnceWith({ where: { id: { in: orderedIds } } });
  expect(presentMany).toHaveBeenCalledExactlyOnceWith(tx, actor, [second, first], new Date('2026-11-13T02:00:00Z'));
  expect(transaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 5000 });
});
