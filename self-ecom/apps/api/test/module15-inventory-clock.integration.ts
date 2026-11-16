// A fixed business Clock must cover the official source, adjustment, task and stock chain.
// Production still binds Clock to SystemClock; this test does not expose a test HTTP write route.
import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {module15Harness,type Module15Harness} from './fixtures/module15-business.js';
import {InventoryAdjustments} from '../src/inventory/inventory-adjustment.service.js';
import {InventorySources} from '../src/inventory/inventory-source.service.js';
import {StockIncidents} from '../src/orders/stock-incident.service.js';

let h:Module15Harness;
beforeAll(async()=>{h=await module15Harness();},60000);
afterAll(async()=>{await h?.close();});

it('historical fixed Clock posts an official receipt before the later order and payment',async()=>{
 const receivedAt=h.clock.set('2026-09-01T01:00:00.000Z');
 const p=await h.product(3);
 const line=await h.db.inventoryAdjustmentLine.findFirstOrThrow({where:{skuId:p.skuId}});
 const adjustment=await h.db.inventoryAdjustment.findUniqueOrThrow({where:{id:line.adjustmentId}});
 const sourceLine=await h.db.inventorySourceLine.findUniqueOrThrow({where:{id:line.sourceLineId}});
 const source=await h.db.inventorySource.findUniqueOrThrow({where:{id:sourceLine.sourceId}});
 const batch=await h.db.inventoryReceiptBatch.findUniqueOrThrow({where:{rootAdjustmentLineId:line.id}});
 const action=await h.db.inventoryAction.findUniqueOrThrow({where:{adjustmentId:adjustment.id}});
 const ledger=await h.db.inventoryLedger.findFirstOrThrow({where:{actionId:action.id}});
 const task=await h.db.task.findFirstOrThrow({where:{businessType:'INVENTORY_ADJUSTMENT',businessId:adjustment.id}});
 const balance=await h.db.inventoryBalance.findUniqueOrThrow({where:{skuId:p.skuId}});
 for(const at of [source.createdAt,source.updatedAt,sourceLine.createdAt,sourceLine.updatedAt,adjustment.createdAt,adjustment.updatedAt,adjustment.postedAt,batch.createdAt,action.createdAt,ledger.createdAt,task.startedAt,balance.updatedAt])expect(at).toEqual(receivedAt);
 expect(adjustment.status).toBe('POSTED');expect(balance.available).toBe(3);expect(task.status).toBe('COMPLETED');
 const paidAt=h.clock.set('2026-09-02T01:00:00.000Z');
 const order=await h.paid(p,1);
 const payment=await h.db.payment.findFirstOrThrow({where:{orderId:order.id}});
 const actions=await h.db.inventoryAction.findMany({where:{businessId:{in:[order.id,payment.id]}},orderBy:{actionType:'asc'}});
 expect(actions.map(a=>a.actionType)).toEqual(['PAY','RESERVE']);
 for(const row of actions){expect(row.createdAt).toEqual(paidAt);const rows=await h.db.inventoryLedger.findMany({where:{actionId:row.id}});expect(rows).toHaveLength(1);expect(rows[0]!.createdAt).toEqual(paidAt);expect(row.createdAt.getTime()).toBeGreaterThan(ledger.createdAt.getTime());}
});

it('Clock also dates the check, unblock, re-entry and void transitions',async()=>{
 const at=h.clock.set('2026-09-03T01:00:00.000Z'),p=await h.product(3),inventory=h.app.get(InventoryAdjustments),sources=h.app.get(InventorySources);
 const pending=await h.receipt(p.skuId,4);
 const sourceLine=await h.db.inventorySourceLine.findUniqueOrThrow({where:{id:pending.sourceLineId}});
 await sources.verify(h.context(h.warehouse),sourceLine.id,{expectedVersion:sourceLine.version,verifiedQuantity:1,evidenceNote:'按实际核实本来源先只确认一件',reason:'触发真实来源不足核实'});
 await expect(inventory.post(h.context(h.warehouse),pending.id,pending.body)).rejects.toMatchObject({code:'SOURCE_QUANTITY_EXCEEDED'});
 const checking=await h.db.inventoryAdjustment.findUniqueOrThrow({where:{id:pending.id}});
 const block=await h.db.inventoryPurchaseBlock.findFirstOrThrow({where:{sourceType:'ADJUSTMENT',sourceId:pending.id,active:true}});
 expect(checking.updatedAt).toEqual(at);expect(block.createdAt).toEqual(at);
 const reconcile=await h.db.task.findFirstOrThrow({where:{businessType:'INVENTORY_ADJUSTMENT',businessId:pending.id,stage:'INVENTORY_RECONCILE',status:'OPEN'}});
 expect(reconcile.startedAt).toEqual(at);
 const resolvedAt=h.clock.set('2026-09-04T01:00:00.000Z');
 const current=await h.db.inventorySourceLine.findUniqueOrThrow({where:{id:sourceLine.id}});
 await sources.verify(h.context(h.warehouse),sourceLine.id,{expectedVersion:current.version,verifiedQuantity:4,evidenceNote:'重新逐件核实为四件',reason:'来源核实完成'});
 await inventory.claim(h.context(h.warehouse),pending.id,await h.inventoryVersions(pending.id));
 await inventory.resolve(h.context(h.warehouse),pending.id,{...await h.inventoryVersions(pending.id),evidenceNote:'完整核实来源四件',reason:'重新进入正式入账'});
 const resumed=await h.db.inventoryAdjustment.findUniqueOrThrow({where:{id:pending.id}}),postTask=await h.db.task.findFirstOrThrow({where:{businessType:'INVENTORY_ADJUSTMENT',businessId:pending.id,stage:'INVENTORY_POST',status:'OPEN'}});
 expect(resumed.updatedAt).toEqual(resolvedAt);expect(postTask.startedAt).toEqual(resolvedAt);expect((await h.db.inventoryPurchaseBlock.findUniqueOrThrow({where:{id:block.id}})).releasedAt).toEqual(resolvedAt);
 await inventory.claim(h.context(h.warehouse),pending.id,await h.inventoryVersions(pending.id));
 await inventory.post(h.context(h.warehouse),pending.id,await h.inventoryVersions(pending.id));
 const voided=await h.receipt(p.skuId,1,randomUUID());
 await inventory.void(h.context(h.warehouse),voided.id,{...voided.body,reason:'核实后作废本次待确认登记'});
 const row=await h.db.inventoryAdjustment.findUniqueOrThrow({where:{id:voided.id}});
 expect(row.voidedAt).toEqual(resolvedAt);expect(row.updatedAt).toEqual(resolvedAt);
});

it('stock incident create, verify, replenish and resolve preserve the business Clock for order timers',async()=>{
 const createdAt=h.clock.set('2026-09-05T01:00:00.000Z'),f=await h.paid(),incidents=h.app.get(StockIncidents);
 const line=await h.db.orderItem.findFirstOrThrow({where:{orderId:f.id}});
 const incident=await incidents.create(h.context(h.warehouse),{incidentKey:randomUUID(),skuId:f.skuId,reason:'核查真实备货异常',evidenceNote:'待逐件核实',items:[{orderItemId:line.id}],evidenceFileIds:[]});
 expect(await h.db.order.findUniqueOrThrow({where:{id:f.id}})).toMatchObject({updatedAt:createdAt,paymentBlocked:true,releaseBlocked:true});
 const task=await h.task(f.id,'STOCK_EXCEPTION_VERIFY');
 const verifiedAt=h.clock.set('2026-09-06T01:00:00.000Z');
 await incidents.verify(h.context(h.warehouse),incident.id,{expectedVersion:incident.version,expectedTaskVersion:task.version,commandKey:randomUUID(),reason:'核实一件实际受损',evidenceNote:'原实物逐件核实',items:[{orderItemId:line.id,damagedQuantity:1,conclusion:'DAMAGED'}]});
 expect(await h.db.order.findUniqueOrThrow({where:{id:f.id}})).toMatchObject({updatedAt:verifiedAt,paymentBlocked:true,releaseBlocked:false});
 const replenishedAt=h.clock.set('2026-09-07T01:00:00.000Z'),order=await h.db.order.findUniqueOrThrow({where:{id:f.id}}),item=await h.db.orderItem.findUniqueOrThrow({where:{id:line.id}});
 const verified=await h.db.stockIncident.findUniqueOrThrow({where:{id:incident.id}});
 await incidents.replenish(h.context(h.warehouse),incident.id,{orderItemId:line.id,quantity:1,expectedIncidentVersion:verified.version,expectedOrderVersion:order.version,expectedPhysicalVersion:item.physicalVersion,expectedTaskVersion:task.version,commandKey:randomUUID(),goodsLocation:'真实补齐货架',reason:'分配一件实际可售补齐',evidenceNote:'原损耗保持一件'});
 expect(await h.db.order.findUniqueOrThrow({where:{id:f.id}})).toMatchObject({updatedAt:replenishedAt,paymentBlocked:false,releaseBlocked:false});
 expect(await h.db.inventoryBalance.findUniqueOrThrow({where:{skuId:f.skuId}})).toMatchObject({available:7,reserved:0});
 const resolvedAt=h.clock.set('2026-09-08T01:00:00.000Z');
 const replenished=await h.db.stockIncident.findUniqueOrThrow({where:{id:incident.id}});
 await incidents.resolve(h.context(h.warehouse),incident.id,{expectedVersion:replenished.version,expectedTaskVersion:task.version,commandKey:randomUUID(),reason:'实际异常已闭环',evidenceNote:'核实补齐及解除自身来源'});
 expect(await h.db.order.findUniqueOrThrow({where:{id:f.id}})).toMatchObject({updatedAt:resolvedAt,paymentBlocked:false,releaseBlocked:false});
 expect(await h.db.stockIncidentItem.findFirstOrThrow({where:{incidentId:incident.id}})).toMatchObject({damagedQuantity:1,verificationState:'REPLENISHED'});
 expect(await h.db.inventoryBalance.findUniqueOrThrow({where:{skuId:f.skuId}})).toMatchObject({available:7,reserved:0,purchaseBlocked:false});
});
