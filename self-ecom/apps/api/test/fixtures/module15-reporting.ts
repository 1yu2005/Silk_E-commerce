// O1–O6 use posted receipt stock and formal business commands; only customer registration dates are explicit statistics fixtures.
import { randomUUID } from 'node:crypto';
import { ProductCommands } from '../../src/catalog/product-command.service.js';
import { InventoryQueries } from '../../src/inventory/inventory-query.service.js';
import { OrderCommands } from '../../src/orders/order-command.service.js';
import { AfterSaleService } from '../../src/after-sales/after-sale.service.js';
import type { CustomerContext } from '../../src/customers/customer-access.service.js';
import type { Module15Harness } from './module15-business.js';

export async function module15ReportingFixture(h: Module15Harness) {
  if (await h.db.order.count()) throw new Error('O1–O6 require a fresh suite database without other transaction samples');
  const asOf = new Date('2026-11-15T04:00:00Z');
  const day = (offset: number, hour = 9) => h.clock.set(Date.parse('2026-11-14T16:00:00Z') + offset * 86400000 + hour * 3600000);
  const c1 = await h.customer(), c2 = await h.customer(), c3 = await h.customer();
  for (const c of [c1, c2]) await h.db.customer.update({ where: { id: c.actor.subjectId }, data: { createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: asOf } });
  await h.db.customer.update({ where: { id: c3.actor.subjectId }, data: { createdAt: new Date('2026-11-14T16:05:00Z'), updatedAt: asOf } });
  day(-31, 8);
  const p1 = await h.product(100), p2 = await h.product(100);
  const products = h.app.get(ProductCommands), orders = h.app.get(OrderCommands), sales = h.app.get(AfterSaleService);
  async function price(p: typeof p1, priceCents: number) {
    const current = await h.db.product.findUniqueOrThrow({ where: { id: p.id } });
    await products.prices(h.context(h.admin), p.id, { expectedVersion: current.version, skuIds: [p.skuId], priceCents, costCents: 100 });
  }
  async function purchase(c: CustomerContext, p: typeof p1, quantity: number, paid = true) {
    const q = await h.quote(p.skuId, quantity, c), result = await h.orders.create(h.context(c), q.input, q.key);
    const f = { id: result.orderId, c, skuId: p.skuId, productId: p.id, quantity };
    if (paid) await orders.pay(h.context(c), f.id);
    return f;
  }
  async function completed(f: Awaited<ReturnType<typeof purchase>>) {
    await h.shipped(f); await h.fulfillment.confirmReceipt(h.context(f.c), f.id);
  }
  async function refunded(f: Awaited<ReturnType<typeof purchase>>) {
    const result = await sales.apply(h.context(f.c), { orderId: f.id, type: 'REFUND_ONLY', reasonCode: 'QUALITY', description: 'O1–O6独占手算交易', evidenceFileIds: [], commandKey: randomUUID() });
    await h.task(result.afterSaleId, 'AFTER_SALE_REVIEW', h.support, 'AFTER_SALE');
    await sales.review(h.context(h.support), result.afterSaleId, { ...await h.saleBody(result.afterSaleId, 'AFTER_SALE_REVIEW'), decision: 'APPROVE', publicExplanation: '核对后同意整单全额模拟退款' });
    await h.task(result.afterSaleId, 'REFUND_PROCESS', h.support, 'AFTER_SALE');
    const body = await h.refundBody(result.afterSaleId), refund = await h.refunds.execute(h.context(h.support), result.afterSaleId, body);
    const replay = await h.refunds.execute(h.context(h.support), result.afterSaleId, body);
    if (refund.attemptOutcome !== 'SUCCEEDED' || replay.attemptId !== refund.attemptId || !replay.replayed) throw new Error('O1–O6 refund did not retain its one successful attempt');
    return { afterSaleId: result.afterSaleId, refundId: refund.refundId!, attemptId: refund.attemptId! };
  }

  // One stable SKU per product is sufficient: historical order prices remain immutable after later official price changes.
  day(-31); await price(p1, 6200); const o6 = await purchase(c2, p1, 1); await completed(o6);
  day(-7); await price(p1, 4600); const o1 = await purchase(c1, p1, 2); await h.shipped(o1);
  day(-6); await h.fulfillment.confirmReceipt(h.context(c1), o1.id);
  day(-2); await price(p2, 9600); const o5 = await purchase(c2, p2, 2); await h.shipped(o5);
  day(-1); await h.fulfillment.confirmReceipt(h.context(c2), o5.id);
  day(0, 8); await price(p1, 14200); const o2 = await purchase(c1, p1, 1); await completed(o2);
  await price(p2, 4200); const o3 = await purchase(c1, p2, 1); await h.shipped(o3);
  const pending = await sales.apply(h.context(c1), { orderId: o3.id, type: 'REFUND_ONLY', reasonCode: 'QUALITY', description: 'O3当前待审核，仅暂停收货，不退款', evidenceFileIds: [], commandKey: randomUUID() });
  const o4 = await purchase(c3, p1, 1, false), refundO1 = await refunded(o1), refundO5 = await refunded(o5);
  const low = await h.product(10), above = await h.product(11);
  for (const p of [low, above]) {
    const balance = await h.db.inventoryBalance.findUniqueOrThrow({ where: { skuId: p.skuId } });
    await h.app.get(InventoryQueries).threshold(h.context(h.warehouse), p.skuId, { expectedVersion: balance.version, threshold: 10, reason: 'O1–O6低库存等号边界' });
  }
  h.clock.set(asOf);
  return {
    asOf, customers: { C1: { id: c1.actor.subjectId, context: c1 }, C2: { id: c2.actor.subjectId, context: c2 }, C3: { id: c3.actor.subjectId, context: c3 } },
    products: { P1: p1, P2: p2, low, above }, orders: { O1: o1, O2: o2, O3: o3, O4: o4, O5: o5, O6: o6 },
    pendingAfterSaleId: pending.afterSaleId, refunds: { O1: refundO1, O5: refundO5 },
    expected: {
      today: { createdOrderCount: '3', newCustomerCount: '1', paidAmountCents: '20000', refundAmountCents: '30000', netReceiptsCents: '-10000' },
      current: { waitingShipmentOrderCount: '0', afterSalePausedOrderCount: '1', pendingReviewAfterSaleCount: '1', failedRefundCount: '0', lowStockSkuCount: '1' },
      seven: { paidAmountCents: '40000', refundAmountCents: '30000', netReceiptsCents: '10000' },
      thirty: { paidAmountCents: '50000', refundAmountCents: '30000', netReceiptsCents: '20000' },
      consumption: { C1: '15000', C2: '7000', C3: '0' }, hot: [{ productId: p1.id, paidQuantity: '3' }, { productId: p2.id, paidQuantity: '3' }].sort((a, b) => a.productId.localeCompare(b.productId)),
      paidSales: { P1: '4', P2: '3' }, lowStockSkuId: low.skuId,
    },
  };
}
