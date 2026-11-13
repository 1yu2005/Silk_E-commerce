// 作用：验证固定阶段与资格依赖、锁计划排序、默认拒绝及新增审计白名单，不以Mock代替数据库集成验证。
import { randomUUID } from 'node:crypto';
import { TaskStage, type Prisma } from '@prisma/client';
import { expect, it, vi } from 'vitest';
import { AuditService, type AuditPayload } from '../src/audit/audit.service.js';
import { permissionDefinitions, roleTemplates } from '../src/permissions/permission-catalog.js';
import { mergeTaskLocks, TaskBusinessAdapters } from '../src/tasks/task-business-adapters.js';
import { taskStageCatalog, taskStageDefinition } from '../src/tasks/task-stage.catalog.js';

it('目录精确覆盖数据库20阶段，只有五类阶段有默认SLA且单位和来源明确', () => {
  expect(Object.keys(taskStageCatalog).sort()).toEqual(Object.values(TaskStage).sort()); expect(Object.keys(taskStageCatalog)).toHaveLength(20);
  expect(Object.entries(taskStageCatalog).filter(([, row]) => row.deadline).map(([stage, row]) => [stage, row.deadline])).toEqual([
    ['AFTER_SALE_REVIEW', { field: 'reviewWorkdays', unit: 'WORKDAY' }], ['SUPPLEMENT_FOLLOW', { field: 'supplementDays', unit: 'NATURAL_DAY' }],
    ['RETURN_FOLLOW', { field: 'returnShipDays', unit: 'NATURAL_DAY' }], ['RETURN_INSPECT', { field: 'inspectionWorkdays', unit: 'WORKDAY' }], ['REFUND_PROCESS', { field: 'refundWorkdays', unit: 'WORKDAY' }],
  ]);
});
it.each(Object.keys(taskStageCatalog) as TaskStage[])('%s资格必须包含完整依赖，不给员工自动增权', stage => {
  const before = structuredClone(roleTemplates); const row = taskStageCatalog[stage];
  expect(new Set(row.requiredPermissions).size).toBe(row.requiredPermissions.length);
  for (const code of row.requiredPermissions) {
    const definition = permissionDefinitions.find(item => item.code === code); expect(definition).toBeDefined();
    for (const dependency of definition!.dependencies) expect(row.requiredPermissions).toContain(dependency);
  }
  expect(roleTemplates).toEqual(before);
});
it('完整发货、交运核实及管理员阶段资格精确，目录深层只读', () => {
  expect(taskStageCatalog.SHIPMENT_PROCESS.requiredPermissions).toEqual(['order.fulfillment.read', 'shipment.claim', 'shipment.handover', 'shipment.pack']);
  expect(taskStageCatalog.HANDOVER_VERIFY.requiredPermissions).not.toContain('shipment.pack');
  expect(taskStageCatalog.ADMIN_STOCK_REVIEW.requiredPermissions).toEqual(['task.transfer']);
  expect(taskStageCatalog.ADMIN_DISPUTE.requiredPermissions).toEqual(['after-sale.dispute.decide']);
  expect(() => (taskStageCatalog.SHIPMENT_PROCESS.requiredPermissions as string[]).push('bogus')).toThrow();
  expect(() => Object.assign(taskStageCatalog.AFTER_SALE_REVIEW.deadline!, { unit: 'MINUTE' })).toThrow();
});
it('阶段和业务类型不匹配或原型键不能冒充合法目录', () => {
  expect(() => taskStageDefinition('SHIPMENT_PROCESS', 'AFTER_SALE')).toThrow();
  expect(() => taskStageDefinition('toString' as TaskStage, 'ORDER')).toThrow();
  expect(taskStageDefinition('ADMIN_DISPUTE', 'OFFLINE_CASE')).toBe(taskStageCatalog.ADMIN_DISPUTE);
});
it('完整锁计划先按层级后按规范UUID升序排序、去重及冻结，不能按每个订单分别锁库存', () => {
  const low = '00000000-0000-0000-0000-000000000001'; const high = 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF';
  const plan = mergeTaskLocks([[{ kind: 'SKU_STOCK', id: low }, { kind: 'ORDER', id: high }],
    [{ kind: 'CUSTOMER', id: high }, { kind: 'ORDER', id: low }, { kind: 'ORDER', id: high.toLowerCase() }]]);
  expect(plan).toEqual([{ kind: 'CUSTOMER', id: high.toLowerCase() }, { kind: 'ORDER', id: low }, { kind: 'ORDER', id: high.toLowerCase() }, { kind: 'SKU_STOCK', id: low }]);
  expect(Object.isFrozen(plan)).toBe(true); expect(Object.isFrozen(plan[0])).toBe(true);
});
it('生产注册表无默认业务和锁处理器，缺失/重复/无效注册明确失败', () => {
  const adapters = new TaskBusinessAdapters(); expect(() => adapters.require('ORDER')).toThrow('任务对应业务尚未接入');
  const adapter = { planLocks: vi.fn(), authorize: vi.fn(), resolveEntry: vi.fn() };
  adapters.registerBusiness('ORDER', adapter); expect(adapters.require('ORDER')).toBe(adapter); expect(() => adapters.registerBusiness('ORDER', adapter)).toThrow();
  adapters.registerLocker('ORDER', async () => {}); expect(() => adapters.registerLocker('ORDER', async () => {})).toThrow();
  expect(() => adapters.registerLocker('CUSTOMER', async () => {})).toThrow();
});
function auditFixture(action: AuditPayload['action'] = 'task.create') {
  const create = vi.fn().mockResolvedValue({}); const tx = { auditLog: { create } } as unknown as Prisma.TransactionClient;
  const payload: AuditPayload = { actor: { type: 'SYSTEM' }, action, targetId: randomUUID(), requestId: randomUUID(), reason: '隔离阶段进入',
    after: { businessType: 'ORDER', businessId: randomUUID(), stage: 'SHIPMENT_PROCESS', round: 1, taskStatus: 'OPEN', dueAt: null, settingsVersionId: null } };
  return { create, tx, payload, service: new AuditService() };
}
it.each(['EMPLOYEE', 'CUSTOMER', 'SYSTEM'] as const)('任务审计保留真实%s主体，只记录白名单标识', async type => {
  const f = auditFixture(); await f.service.appendAudit(f.tx, { ...f.payload, actor: type === 'SYSTEM' ? { type } : { type, id: randomUUID() } });
  expect(f.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorType: type, targetType: 'Task', action: 'task.create' }) });
});
it.each([{ taskStatus: 'ACTIVE' }, { stage: 'toString' }, { businessType: 'UNKNOWN' }, { businessId: '1' }, { round: 0 }, { round: 2147483648 },
  { dueAt: '2026-02-30T00:00:00.000Z' }, { dueAt: 'not-date' }, { settingsVersionId: '1' }, { requiredPermissions: ['secret'] }, { token: 'secret' }])('任务审计拒绝非法或多余差异%s', async patch => {
  const f = auditFixture(); await expect(f.service.appendAudit(f.tx, { ...f.payload, after: { ...f.payload.after, ...patch } })).rejects.toThrow(); expect(f.create).not.toHaveBeenCalled();
});
it('新增任务SYSTEM能力不放宽旧员工/设置动作，旧员工状态仍拒绝任务状态', async () => {
  const f = auditFixture();
  await expect(f.service.appendAudit(f.tx, { ...f.payload, action: 'employee.profile.update', after: { displayName: '测试' } })).rejects.toThrow();
  await expect(f.service.appendAudit(f.tx, { ...f.payload, actor: { type: 'EMPLOYEE', id: randomUUID() }, action: 'employee.enable', after: { status: 'OPEN' } })).rejects.toThrow();
  expect(f.create).not.toHaveBeenCalled();
});
