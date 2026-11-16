// 作用：验证真实订单和售后任务按业务筛选后的权限、动作和分页结果保持一致。
import 'reflect-metadata';
import { expect, it } from 'vitest';
import { apply, fixture, http, paid, physical, review, saleTask, setupCoordinationFixtures } from './coordination-fixtures.js';
import { TaskAccessService } from '../src/tasks/task-access.service.js';
setupCoordinationFixtures({ databasePrefix: 'm415' });

it('IT15-TASK-SCOPE：真实ORDER/AFTER_SALE适配器裁剪与全范围的HTTP数据等价', async () => {
  const { app, db, warehouse, support } = fixture;
  const order = await paid(), refundOrder = await paid(), sale = await apply(refundOrder);
  await review(sale.afterSaleId); await physical(refundOrder, sale.afterSaleId);
  const refund = await saleTask(sale.afterSaleId, 'REFUND_PROCESS');
  const shipping = await db.task.findFirstOrThrow({ where: { businessType: 'ORDER', businessId: order.id, stage: 'SHIPMENT_PROCESS', status: 'OPEN' } });
  const access = app.get(TaskAccessService), original = access.scope;
  const cases = [
    { context: warehouse, path: `/admin/tasks?view=pool&businessType=ORDER&stage=SHIPMENT_PROCESS&businessId=${order.id}&page=1&pageSize=20`, expected: shipping.id, action: 'claim' },
    { context: support, path: `/admin/tasks?view=mine&businessType=AFTER_SALE&stage=REFUND_PROCESS&businessId=${sale.afterSaleId}&page=1&pageSize=20`, expected: refund.id, action: 'release' },
    { context: warehouse, path: `/admin/tasks?view=pool&businessType=ORDER&businessId=${order.id}&page=1&pageSize=10`, expected: shipping.id, action: 'claim' },
  ];
  for (const item of cases) {
    let baseline: Awaited<ReturnType<typeof http>>;
    access.scope = function(tx, current) { return Reflect.apply(original, this, [tx, current]); };
    try { baseline = await http('GET', item.path, item.context); }
    finally { access.scope = original; }
    const selected = await http('GET', item.path, item.context);
    expect(baseline.status).toBe(200); expect(selected.status).toBe(200);
    expect(selected.json.data).toEqual(baseline.json.data);
    expect(selected.json.data).toMatchObject({ total: 1, items: [{ id: item.expected, allowedActions: [item.action] }] });
  }
}, 60000);
