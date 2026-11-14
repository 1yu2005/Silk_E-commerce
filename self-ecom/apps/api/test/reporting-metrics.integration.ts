// 手算O1～O6全部通过正式下单/支付/交运/收货/售后/退款命令产生；直接夹具仅用于成员注册日期与商品初始资料。
import 'reflect-metadata';
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect,it} from 'vitest';
import {ReportingController} from '../src/reporting/reporting.controller.js';
import {ReportingService} from '../src/reporting/reporting.service.js';
import {TrendQueryDto,HotProductsQueryDto} from '../src/reporting/reporting.dto.js';
import {PaginationDto} from '../src/common/http/pagination.dto.js';
import {AddressService} from '../src/customers/address.service.js';
import {CartService} from '../src/customers/cart.service.js';
import {CustomerService} from '../src/customers/customer.service.js';
import {OrderService} from '../src/orders/order.service.js';
import {OrderCommands} from '../src/orders/order-command.service.js';
import {FulfillmentService} from '../src/orders/fulfillment.service.js';
import {FulfillmentQueries} from '../src/orders/fulfillment-query.service.js';
import {StockIncidents} from '../src/orders/stock-incident.service.js';
import {AfterSaleService} from '../src/after-sales/after-sale.service.js';
import {RefundService} from '../src/after-sales/refund.service.js';
import {EmployeeExtraPermissionService} from '../src/employees/employee-extra-permission.service.js';
import {InventoryQueries} from '../src/inventory/inventory-query.service.js';
import {OfflineCaseService} from '../src/coordination/offline-case.service.js';
import type {CustomerContext} from '../src/customers/customer-access.service.js';
import {fixture,setupCoordinationFixtures,customer,employee,claim,orderBody,saleTask,saleBody,review,http,address,paid,apply,physical} from './coordination-fixtures.js';

for(const [method,dto] of [['trends',TrendQueryDto],['hot',HotProductsQueryDto],['lowStock',PaginationDto]] as const)Reflect.defineMetadata('design:paramtypes',[Object,Object,dto],ReportingController.prototype,method);
setupCoordinationFixtures({databasePrefix:'m414'});
const D=new Date('2026-11-15T04:00:00Z'); // 北京12:00，所有今日参与事件在此之前。
function at(day:number,hour=9){fixture.clock.value=new Date(Date.parse('2026-11-14T16:00:00Z')+day*86400000+hour*3600000);}
const reports=()=>fixture.app.get(ReportingService);
async function product(name:string){return fixture.db.product.create({data:{productCode:'M14-'+randomUUID(),name,status:'ON_SALE',createdById:fixture.admin.actor.subjectId,updatedById:fixture.admin.actor.subjectId}});}
async function sku(productId:string,priceCents:number,signature:string,available=100,warningThreshold=0){return fixture.db.sku.create({data:{productId,code:('M14-'+randomUUID()).toUpperCase(),combinationSignature:createHash('sha256').update(signature).digest('hex'),priceCents,costCents:100,balance:{create:{available,warningThreshold}}}});}
async function purchase(c:CustomerContext,s:{id:string},quantity:number,pay=true){
 const {app}=fixture,a=await app.get(AddressService).create(c,address),cart=await app.get(CartService).add(c,{skuId:s.id,quantity}),input={addressId:a.address.id,items:[{cartItemId:cart.item.id,skuId:s.id,quantity}]},service=app.get(OrderService),quote=await service.preview(c,input),o=await service.create(c,{...input,quoteId:quote.quoteId},randomUUID());
 if(pay)await app.get(OrderCommands).pay(c,o.orderId);return {id:o.orderId,c,sku:s};
}
async function ship(f:Awaited<ReturnType<typeof purchase>>){
 const {app,db,warehouse}=fixture;await claim(f.id);const items=await db.orderItem.findMany({where:{orderId:f.id}}),o=await db.order.findUniqueOrThrow({where:{id:f.id}}),service=app.get(FulfillmentService);
 await service.pack(warehouse,f.id,{...await orderBody(f.id),items:items.map(i=>({orderItemId:i.id,checkedQuantity:i.quantity})),goodsLocation:'统计隔离货架',expectedPhysicalVersion:o.stockPhysicalVersion});
 await service.prepare(warehouse,f.id,{...await orderBody(f.id),carrierName:'统计模拟承运',trackingNumber:'M14-'+randomUUID()});
 const q=await app.get(FulfillmentQueries).detail(warehouse,f.id),start=await service.start(warehouse,f.id,{...await orderBody(f.id),shipmentId:q.shipment!.id,packingCheckId:q.packingCheck!.id,expectedPhysicalVersion:q.physicalVersion});
 await service.confirm(warehouse,f.id,{...await orderBody(f.id),attemptId:start.attemptId!,expectedAttemptVersion:start.attemptVersion!,actualHandoverAt:fixture.clock.now().toISOString()});
}
async function receipt(f:Awaited<ReturnType<typeof purchase>>){return fixture.app.get(FulfillmentService).confirmReceipt(f.c,f.id);}
async function request(f:Awaited<ReturnType<typeof purchase>>){return fixture.app.get(AfterSaleService).apply(f.c,{orderId:f.id,type:'REFUND_ONLY',reasonCode:'QUALITY',description:'真实统计退款样本',evidenceFileIds:[],commandKey:randomUUID()});}
async function refundCompleted(f:Awaited<ReturnType<typeof purchase>>){const a=await request(f);await review(a.afterSaleId);await saleTask(a.afterSaleId,'REFUND_PROCESS');const body=await saleBody(a.afterSaleId,'REFUND_PROCESS'),service=fixture.app.get(RefundService),result=await service.execute(fixture.support,a.afterSaleId,body);expect(await service.execute(fixture.support,a.afterSaleId,body)).toMatchObject({replayed:true,refundId:result.refundId});return result;}
const sum=(rows:readonly Record<string,string>[],key:string)=>rows.reduce((n,r)=>n+BigInt(r[key]!),0n).toString();

it('O1～O6真实交易基准：今日负净额、7/30天、退款不倒扣支付件数、完成净消费与当前卡片',async()=>{
 const {app,db}=fixture,c1=await customer(),c2=await customer(),c3=await customer();
 // 成员创建日期是注册日期夹具；未直接修改任何订单、支付、退款、库存数量或销量。
 await db.customer.update({where:{id:c1.actor.subjectId},data:{createdAt:new Date('2026-01-01T00:00:00Z'),updatedAt:D}});
 await db.customer.update({where:{id:c2.actor.subjectId},data:{createdAt:new Date('2026-01-01T00:00:00Z'),updatedAt:D}});
 await db.customer.update({where:{id:c3.actor.subjectId},data:{createdAt:new Date('2026-11-14T16:05:00Z'),updatedAt:D}});
 const p1=await product('手算款式P1'),p2=await product('手算款式P2'),a1=await sku(p1.id,4600,'O1'),a2=await sku(p1.id,14200,'O2'),a6=await sku(p1.id,6200,'O6'),b3=await sku(p2.id,4200,'O3'),b5=await sku(p2.id,9600,'O5');
 at(-31);const o6=await purchase(c2,a6,1);await ship(o6);await receipt(o6);
 at(-7);const o1=await purchase(c1,a1,2);await ship(o1);at(-6);await receipt(o1);
 at(-2);const o5=await purchase(c2,b5,2);await ship(o5);at(-1);await receipt(o5);
 at(0,8);const o2=await purchase(c1,a2,1);await ship(o2);await receipt(o2);
 const o3=await purchase(c1,b3,1);await ship(o3);const a3=await request(o3);
 const o4=await purchase(c3,a2,1,false);await refundCompleted(o1);await refundCompleted(o5);
 const stockProduct=await product('预警账户'),b1=await sku(stockProduct.id,1000,'B1',10,10),b2=await sku(stockProduct.id,1000,'B2',11,10);
 fixture.clock.value=D;const overview=await reports().overview(fixture.admin),seven=await reports().trends(fixture.admin,7),thirty=await reports().trends(fixture.admin,30),hot=await reports().hotProducts(fixture.admin,10);
 expect(overview.today).toEqual({createdOrderCount:'3',newCustomerCount:'1',paidAmountCents:'20000',refundAmountCents:'30000',netReceiptsCents:'-10000'});
 expect(overview.current).toEqual({waitingShipmentOrderCount:'0',afterSalePausedOrderCount:'1',pendingReviewAfterSaleCount:'1',failedRefundCount:'0',lowStockSkuCount:'1'});
 expect(overview).toMatchObject({asOf:D.toISOString(),timeZone:'Asia/Shanghai',definitionVersion:'DASHBOARD_V1',from:'2026-11-14T16:00:00.000Z'});
 for(const [r,expected] of [[seven,['40000','30000','10000']],[thirty,['50000','30000','20000']]] as const){expect(r.items).toHaveLength(r.days);expect([sum(r.items,'paidAmountCents'),sum(r.items,'refundAmountCents'),sum(r.items,'netReceiptsCents')]).toEqual(expected);expect(new Set(r.items.map(x=>x.date)).size).toBe(r.days);expect(r.items.some(x=>x.paidAmountCents==='0'&&x.refundAmountCents==='0')).toBe(true);}
 expect(hot.items.map(r=>[r.productId,r.paidQuantity])).toEqual([p1.id,p2.id].sort().map(id=>[id,'3']));
 expect((await reports().hotProducts(fixture.admin,1)).items.map(r=>[r.productId,r.paidQuantity])).toEqual([[[p1.id,p2.id].sort()[0],'3']]);
 const sales=await db.product.findMany({where:{id:{in:[p1.id,p2.id]}},select:{id:true,paidSalesCount:true}});expect(sales.find(p=>p.id===p1.id)!.paidSalesCount).toBe(4n);expect(sales.find(p=>p.id===p2.id)!.paidSalesCount).toBe(3n);
 const customers=app.get(CustomerService),consumption=await Promise.all([c1,c2,c3].map(c=>customers.consumed(fixture.support,c.actor.subjectId)));
 expect(consumption.map(c=>c.amountCents)).toEqual(['15000','7000','0']);expect(consumption.every(c=>c.availability==='AVAILABLE')).toBe(true);
 const list=await customers.list(fixture.support,{page:1,pageSize:100});for(const c of [c1,c2,c3])expect(list.items.find(x=>x.id===c.actor.subjectId)!.consumption.amountCents).toBe(consumption[[c1,c2,c3].indexOf(c)]!.amountCents);
 // 下架/归档只改商品生命周期夹具，历史交易和库存数量保持原事实。
 await db.product.update({where:{id:p1.id},data:{status:'OFF_SALE',archivedAt:D}});expect((await reports().hotProducts(fixture.admin,10)).items.find(x=>x.productId===p1.id)).toMatchObject({paidQuantity:'3',archived:true,status:'OFF_SALE'});
 const low=await reports().lowStock(fixture.admin,{page:1,pageSize:100});expect(low.items.map(i=>i.skuId)).toEqual([b1.id]);expect(JSON.stringify(low)).not.toMatch(/reserved|costCents|password|phone/);
 const balance=await db.inventoryBalance.findUniqueOrThrow({where:{skuId:b1.id}});await app.get(InventoryQueries).threshold(fixture.warehouse,b1.id,{expectedVersion:balance.version,threshold:9,reason:'仅调整预警线核对等号'});expect((await reports().lowStock(fixture.admin,{page:1,pageSize:100})).total).toBe(0);
 const folder=resolve('../../docs/verification/evidence/M4-14/hand-calculated');mkdirSync(folder,{recursive:true});writeFileSync(folder+'/result.json',JSON.stringify({asOf:D,definitionVersion:'DASHBOARD_V1',registrationDateFixture:true,transactionFactsFromDomainCommands:true,orders:[o1,o2,o3,o4,o5,o6].map(f=>({orderId:f.id,customerId:f.c.actor.subjectId})),pendingAfterSaleId:a3.afterSaleId,products:[p1.id,p2.id],stockAccounts:[b1.id,b2.id],overview,seven,thirty,hot,consumption},null,2)+'\n');
},60000);

it('看板默认/个人授权及撤回即时生效；顾客/库存/审计权限独立，严格查询参数',async()=>{
 const {db,app}=fixture;fixture.clock.value=D;const staff=await employee('CUSTOMER_SERVICE'),warehouse=await employee('MERCH_WAREHOUSE'),c=await customer(),path='/admin/dashboard/overview';
 expect((await http('GET',path,warehouse)).status).toBe(200);expect((await http('GET',path,staff)).status).toBe(403);expect((await http('GET',path,c)).status).toBe(401);
 const extras=app.get(EmployeeExtraPermissionService);await extras.replace(fixture.admin.actor,fixture.admin.token,staff.actor.subjectId,{expectedVersion:0,permissions:['dashboard.read'],reason:'隔离看板额外授权'},randomUUID());
 expect((await http('GET',path,staff)).status).toBe(200);expect((await http('GET','/admin/audit-logs',staff)).status).toBe(403);expect((await http('GET','/admin/customers',warehouse)).status).toBe(403);
 await extras.replace(fixture.admin.actor,fixture.admin.token,staff.actor.subjectId,{expectedVersion:1,permissions:[],reason:'撤回本次额外看板权限'},randomUUID());expect((await http('GET',path,staff)).status).toBe(403);
 for(const p of ['/trends?days=8','/trends?days=7&timeZone=UTC','/hot-products?days=7','/hot-products?limit=21','/low-stock?pageSize=101','/low-stock?page=0'])expect((await http('GET','/admin/dashboard'+p,fixture.admin)).status,p).toBe(400);
 expect(await db.employee.count({where:{id:staff.actor.subjectId}})).toBe(1);
});

it('完成售后与失败退款仍计消费；成功重试只扣一次，冻结保留历史，线下金额不计交易',async()=>{
 const {app,db}=fixture;at(1);const p=await product('消费退款状态样本'),s=await sku(p.id,9200,'STATE'),c=await customer(),f=await purchase(c,s,1);await ship(f);await receipt(f);const service=app.get(CustomerService),before=await service.consumed(fixture.support,c.actor.subjectId);expect(before.amountCents).toBe('10000');
 const a=await request(f);await review(a.afterSaleId);expect((await service.consumed(fixture.support,c.actor.subjectId)).amountCents).toBe('10000');await saleTask(a.afterSaleId,'REFUND_PROCESS');fixture.simulator.mode='FAIL_ONCE';const refunds=app.get(RefundService),firstBody=await saleBody(a.afterSaleId,'REFUND_PROCESS'),first=await refunds.execute(fixture.support,a.afterSaleId,firstBody);expect(first.attemptOutcome).toBe('FAILED');
 expect((await service.consumed(fixture.support,c.actor.subjectId)).amountCents).toBe('10000');expect((await reports().overview(fixture.admin)).current.failedRefundCount).toBe('1');expect((await reports().overview(fixture.admin)).current.afterSalePausedOrderCount).toBe('1'); // 只保留基准O3，不计COMPLETED退款失败单。
 const current=await reports().overview(fixture.admin),o=await db.order.findUniqueOrThrow({where:{id:f.id}}),offline=app.get(OfflineCaseService),oc=await offline.create(fixture.support,{orderId:f.id,type:'EXTERNAL_COMPENSATION',subject:'线下金额隔离',description:'独占样本，未发生真实资金',publicSummary:'仅记录线下跟进',expectedOrderVersion:o.version,commandKey:randomUUID(),reason:'核对不入交易'});
 await claim(oc.offlineCaseId,'OFFLINE_FOLLOW',fixture.support,'OFFLINE_CASE');
 const offlineBody=async()=>({commandKey:randomUUID(),expectedCaseVersion:(await db.offlineCase.findUniqueOrThrow({where:{id:oc.offlineCaseId}})).version,expectedTaskVersion:(await db.task.findFirstOrThrow({where:{businessId:oc.offlineCaseId,stage:'OFFLINE_FOLLOW',status:'CLAIMED'}})).version,reason:'仅核对线下事实隔离'});
 await offline.begin(fixture.support,oc.offlineCaseId,await offlineBody());await offline.append(fixture.support,oc.offlineCaseId,{...await offlineBody(),kind:'EXTERNAL_RESULT',occurredAt:fixture.clock.now().toISOString(),channel:'PHONE',result:'隔离模拟外部结果，无真实付款',reportedAmountCents:98765,externalVerification:'DECLARED',evidenceFileIds:[]});expect((await reports().overview(fixture.admin)).today).toEqual(current.today);
 const body={...await saleBody(a.afterSaleId,'REFUND_PROCESS'),refundId:first.refundId,expectedRefundVersion:first.refundVersion},done=await refunds.execute(fixture.support,a.afterSaleId,body,true);expect(done.attemptOutcome).toBe('SUCCEEDED');expect((await service.consumed(fixture.support,c.actor.subjectId)).amountCents).toBe('0');expect(await refunds.execute(fixture.support,a.afterSaleId,body,true)).toMatchObject({replayed:true,attemptId:done.attemptId});expect((await reports().overview(fixture.admin)).current.failedRefundCount).toBe('0');
 const customerRow=await db.customer.findUniqueOrThrow({where:{id:c.actor.subjectId}});await service.change(fixture.admin,c.actor.subjectId,'LOGIN_FROZEN',{expectedVersion:customerRow.statusVersion,reason:'核对冻结不清历史'});expect((await service.consumed(fixture.support,c.actor.subjectId)).amountCents).toBe('0');expect(await db.payment.count({where:{orderId:f.id}})).toBe(1);expect(await db.refundAttempt.count({where:{refundId:first.refundId}})).toBe(2);
});

it('待发/售后暂停/待审可重叠，退款FAILED回待重核仍按退款业务计一次',async()=>{
 at(2);const f=await paid(),a=await apply(f);let view=await reports().overview(fixture.admin);expect(view.current.waitingShipmentOrderCount).toBe('1');expect(view.current.afterSalePausedOrderCount).toBe('2');expect(view.current.pendingReviewAfterSaleCount).toBe('2');
 await review(a.afterSaleId);const check=await physical(f,a.afterSaleId);await saleTask(a.afterSaleId,'REFUND_PROCESS');fixture.simulator.mode='FAIL_ONCE';const first=await fixture.app.get(RefundService).execute(fixture.support,a.afterSaleId,{...await saleBody(a.afterSaleId,'REFUND_PROCESS'),physicalCheckId:check.physicalCheckId});expect(first.refundStatus).toBe('FAILED');
 // 正式登记已付款备货损耗使核实失效；不直接修改实物版本或退款业务。
 const item=await fixture.db.orderItem.findFirstOrThrow({where:{orderId:f.id}});
 await fixture.app.get(StockIncidents).create(fixture.warehouse,{incidentKey:randomUUID(),skuId:f.sku.id,reason:'独占样本实际发现一件损耗',evidenceNote:'用于验证失败退款待重核仍保留',items:[{orderItemId:item.id,damagedQuantity:1}],evidenceFileIds:[]});
 await expect(fixture.app.get(RefundService).execute(fixture.support,a.afterSaleId,{...await saleBody(a.afterSaleId,'REFUND_PROCESS'),refundId:first.refundId,expectedRefundVersion:first.refundVersion},true)).rejects.toMatchObject({code:'PHYSICAL_CHECK_STALE'});
 expect(await fixture.db.afterSale.findUniqueOrThrow({where:{id:a.afterSaleId}})).toMatchObject({status:'WAIT_FULFILLMENT_CHECK'});view=await reports().overview(fixture.admin);expect(view.current.failedRefundCount).toBe('1');expect(await fixture.db.refundAttempt.count({where:{refundId:first.refundId}})).toBe(1);
});
