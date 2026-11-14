// 作用：使用本轮独占真实PostgreSQL验证改址、正式售后移交、来源和回滚，保留所有断言。
import {randomUUID} from 'node:crypto';
import {AddressService} from '../src/customers/address.service.js';
import {CartService} from '../src/customers/cart.service.js';
import {OrderService} from '../src/orders/order.service.js';
import {OrderCommands} from '../src/orders/order-command.service.js';
import {expect,it} from 'vitest';
import {CoordinationService} from '../src/coordination/coordination.service.js';
import {CoordinationQueries} from '../src/coordination/coordination-query.service.js';
import {CommunicationService} from '../src/records/communication.service.js';
import {FulfillmentService} from '../src/orders/fulfillment.service.js';
import {FulfillmentQueries} from '../src/orders/fulfillment-query.service.js';
import {RefundService} from '../src/after-sales/refund.service.js';
import {OrderQueries} from '../src/orders/order-query.service.js';
import {fixture as f,setupCoordinationFixtures,paid,shipped,claim,orderBody,review,physical,saleBody,customer,address,http} from './coordination-fixtures.js';
setupCoordinationFixtures();
const service=()=>f.app.get(CoordinationService);
async function communication(id:string){return f.db.$transaction(tx=>f.app.get(CommunicationService).appendCommunication(tx,{identity:f.support.actor,token:f.support.token},{scopeType:'ORDER',scopeId:id,channel:'PHONE',occurredAt:f.clock.now(),result:'顾客明确同意整单退款重下，或继续使用原地址；按本次具体诉求记录',publicText:'已联系店铺核对本次诉求',requestId:randomUUID()}));}
async function create(id:string){const comm=await communication(id),body={...await orderBody(id),communicationId:comm.id};return {result:await service().createAddress(f.support,id,body),body,comm};}
async function verify(id:string,requestId:string){await claim(id,'PHYSICAL_VERIFY');const o=await f.db.order.findUniqueOrThrow({where:{id}}),a=await f.db.addressRequest.findUniqueOrThrow({where:{id:requestId}}),items=await f.db.orderItem.findMany({where:{orderId:id}});return service().verifyAddress(f.warehouse,requestId,{...await orderBody(id,'PHYSICAL_VERIFY'),expectedRequestVersion:a.version,expectedPhysicalVersion:o.stockPhysicalVersion,goodsLocation:'已停止作业，本轮实物货架',items:items.map(i=>({orderItemId:i.id,checkedQuantity:i.quantity}))});}
async function handoffBody(id:string,requestId:string,checkId:string){await claim(id,'CUSTOMER_CONTACT',f.support);const a=await f.db.addressRequest.findUniqueOrThrow({where:{id:requestId}}),comm=await communication(id);return {...await orderBody(id,'CUSTOMER_CONTACT'),expectedRequestVersion:a.version,communicationId:comm.id,customerConsent:'REFUND_FULL' as const,type:'REFUND_ONLY' as const,reasonCode:'NOT_WANTED',description:'顾客改址申请整单退款后另行下单',evidenceFileIds:[],physicalVerificationId:checkId};}

it('已付改址暂停、仓储独立核实、正式申请原子移交，不改地址或提前退款',async()=>{
 const o=await paid(),before=await f.db.order.findUniqueOrThrow({where:{id:o.id}}),balance=await f.db.inventoryBalance.findUniqueOrThrow({where:{skuId:o.sku.id}}),a=await create(o.id);
 expect(await f.db.orderBlock.count({where:{orderId:o.id,sourceType:'ADDRESS_REQUEST',active:true}})).toBe(1);
 await expect(service().verifyAddress(f.support,a.result.resultId,{...await orderBody(o.id,'PHYSICAL_VERIFY'),expectedRequestVersion:0,expectedPhysicalVersion:0,goodsLocation:'错误岗位',items:[]})).rejects.toMatchObject({code:'FORBIDDEN'});
 const check=await verify(o.id,a.result.resultId),body=await handoffBody(o.id,a.result.resultId,check.resultId),result=await service().handoffAfterSale(f.support,a.result.resultId,body);
 expect(result.resultType).toBe('AFTER_SALE');expect((await f.db.afterSale.findUniqueOrThrow({where:{id:result.resultId}})).status).toBe('PENDING_REVIEW');
 expect(await f.db.orderBlock.count({where:{orderId:o.id,sourceType:'ADDRESS_REQUEST',active:true}})).toBe(0);expect(await f.db.orderBlock.count({where:{orderId:o.id,sourceType:'AFTER_SALE',active:true}})).toBe(1);
 const after=await f.db.order.findUniqueOrThrow({where:{id:o.id}});for(const key of ['receiver','phone','province','city','district','detail'] as const)expect(after[key]).toBe(before[key]);
 expect(await f.db.refund.count({where:{orderId:o.id}})).toBe(0);expect(await f.db.inventoryBalance.findUniqueOrThrow({where:{skuId:o.sku.id}})).toEqual(balance);
 expect((await service().handoffAfterSale(f.support,a.result.resultId,body)).replayed).toBe(true);expect(await f.db.coordinationHandoff.count({where:{orderId:o.id}})).toBe(1);
 await review(result.resultId);await physical(o,result.resultId);await claim(result.resultId,'REFUND_PROCESS',f.support,'AFTER_SALE');
 const sale=await f.db.afterSale.findUniqueOrThrow({where:{id:result.resultId}});await f.app.get(RefundService).execute(f.support,result.resultId,{...await saleBody(result.resultId,'REFUND_PROCESS'),expectedPhysicalVersion:(await f.db.order.findUniqueOrThrow({where:{id:o.id}})).stockPhysicalVersion,physicalCheckId:sale.activeUnshippedCheckId!});
 expect((await f.db.order.findUniqueOrThrow({where:{id:o.id}})).status).toBe('REFUNDED');expect((await f.db.inventoryBalance.findUniqueOrThrow({where:{skuId:o.sku.id}})).available).toBe(10);await expect(create(o.id)).rejects.toMatchObject({code:'ADDRESS_ROUTE_NOT_ALLOWED'});
});
it('未领取、错误来源与旧版本拒绝；重复OPEN和同key异内容不造新诉求',async()=>{
 const o=await paid(),a=await create(o.id),comm=await communication(o.id);
 expect((await service().createAddress(f.support,o.id,a.body)).replayed).toBe(true);
 await expect(service().createAddress(f.support,o.id,{...a.body,reason:'不同载荷'})).rejects.toMatchObject({code:'COMMAND_PAYLOAD_CONFLICT'});
 await expect(service().createAddress(f.support,o.id,{...await orderBody(o.id),communicationId:comm.id})).rejects.toMatchObject({code:'ADDRESS_REQUEST_ALREADY_OPEN'});
 const other=await paid();await expect(service().createAddress(f.support,other.id,{...await orderBody(other.id),communicationId:comm.id})).rejects.toMatchObject({code:'COMMUNICATION_REQUIRED'});
 await expect(service().handoffAfterSale(f.support,a.result.resultId,{...await orderBody(o.id),communicationId:comm.id,customerConsent:'REFUND_FULL',type:'REFUND_ONLY',reasonCode:'OTHER',description:'无任务领取拒绝',evidenceFileIds:[],expectedRequestVersion:0})).rejects.toMatchObject({code:'TASK_NOT_ASSIGNEE'});
});
it('继续原地址仅结束本来源，另一发货异常保留且经办不自动恢复',async()=>{
 const o=await paid();await claim(o.id);const items=await f.db.orderItem.findMany({where:{orderId:o.id}}),fulfillment=f.app.get(FulfillmentService);
 const exception=await fulfillment.exception(f.warehouse,o.id,{...await orderBody(o.id),type:'OTHER',incidentKey:randomUUID(),evidenceNote:'另一独立缺货原因仍待核实',evidenceFileIds:[],goodsLocation:'本轮货架',orderItemIds:items.map(i=>i.id)});
 const a=await create(o.id),check=await verify(o.id,a.result.resultId);await claim(o.id,'CUSTOMER_CONTACT',f.support);const comm=await communication(o.id);
 const continueBody={...await orderBody(o.id,'CUSTOMER_CONTACT'),expectedRequestVersion:0,communicationId:comm.id,customerConsent:'CONTINUE_ORIGINAL' as const,physicalVerificationId:check.resultId};await service().continueOriginal(f.support,a.result.resultId,continueBody);
 expect(await f.db.orderBlock.count({where:{orderId:o.id,sourceType:'SHIPMENT_EXCEPTION',sourceId:exception.exceptionId,active:true}})).toBe(1);
 expect(await f.db.orderBlock.count({where:{orderId:o.id,sourceType:'ADDRESS_REQUEST',active:true}})).toBe(0);
 const contact=await f.db.task.findFirstOrThrow({where:{businessType:'ORDER',businessId:o.id,stage:'CUSTOMER_CONTACT',status:'CLAIMED'}});expect(await f.db.taskBusinessSource.count({where:{taskId:contact.id,sourceType:'SHIPMENT_EXCEPTION',status:'ACTIVE'}})).toBe(1);
 expect((await f.db.order.findUniqueOrThrow({where:{id:o.id}})).shipmentReclaimRequired).toBe(true);const next=await create(o.id);await expect(service().continueOriginal(f.support,next.result.resultId,continueBody)).rejects.toMatchObject({code:'COMMAND_PAYLOAD_CONFLICT'});
});
it('已交运改址转线下工单，原地址运单支付与库存保持',async()=>{
 const o=await shipped(),before=await f.db.order.findUniqueOrThrow({where:{id:o.id}}),shipment=await f.db.shipment.findUniqueOrThrow({where:{orderId:o.id}}),payment=await f.db.payment.findUniqueOrThrow({where:{orderId:o.id}}),balance=await f.db.inventoryBalance.findUniqueOrThrow({where:{skuId:o.sku.id}}),a=await create(o.id);await claim(o.id,'CUSTOMER_CONTACT',f.support);const comm=await communication(o.id);
 const result=await service().handoffOffline(f.support,a.result.resultId,{...await orderBody(o.id,'CUSTOMER_CONTACT'),expectedRequestVersion:0,communicationId:comm.id,caseType:'FORWARDING',publicSummary:'按顾客意愿联系承运商协商转寄，尚未确认实际转寄'});
 expect(result.resultType).toBe('OFFLINE_CASE');expect((await f.db.offlineCase.findUniqueOrThrow({where:{id:result.resultId}})).status).toBe('OPEN');
 expect(await f.db.shipment.findUniqueOrThrow({where:{orderId:o.id}})).toEqual(shipment);expect(await f.db.payment.findUniqueOrThrow({where:{orderId:o.id}})).toEqual(payment);expect(await f.db.inventoryBalance.findUniqueOrThrow({where:{skuId:o.sku.id}})).toEqual(balance);
 const after=await f.db.order.findUniqueOrThrow({where:{id:o.id}});expect(after.detail).toBe(before.detail);expect(after.status).toBe('SHIPPED');expect(await f.db.refund.count({where:{orderId:o.id}})).toBe(0);
});
it('交运中改址保留原Attempt并转核实，不得假定未交运',async()=>{
 const o=await paid();await claim(o.id);const items=await f.db.orderItem.findMany({where:{orderId:o.id}}),fulfillment=f.app.get(FulfillmentService);
 await fulfillment.pack(f.warehouse,o.id,{...await orderBody(o.id),expectedPhysicalVersion:0,goodsLocation:'独占货架',items:items.map(i=>({orderItemId:i.id,checkedQuantity:i.quantity}))});
 await fulfillment.prepare(f.warehouse,o.id,{...await orderBody(o.id),carrierName:'测试承运商',trackingNumber:'M13-'+randomUUID()});const view=await f.app.get(FulfillmentQueries).detail(f.warehouse,o.id),start=await fulfillment.start(f.warehouse,o.id,{...await orderBody(o.id),expectedPhysicalVersion:0,shipmentId:view.shipment!.id,packingCheckId:view.packingCheck!.id});
 const a=await create(o.id);expect((await f.db.handoverAttempt.findUniqueOrThrow({where:{id:start.attemptId}})).status).toBe('UNCERTAIN');await claim(o.id,'PHYSICAL_VERIFY');
 await expect(verify(o.id,a.result.resultId)).rejects.toMatchObject({code:'HANDOVER_VERIFICATION_REQUIRED'});expect(await f.db.handoverAttempt.count({where:{orderId:o.id}})).toBe(1);
});
it('协作审计故障全回滚，原key可真实重试',async()=>{
 const o=await paid(),comm=await communication(o.id),before=await f.db.order.findUniqueOrThrow({where:{id:o.id}}),body={...await orderBody(o.id),communicationId:comm.id};f.audit.fail='coordination.change';
 await expect(service().createAddress(f.support,o.id,body)).rejects.toThrow('板块13独占库审计故障');f.audit.fail=undefined;
 expect(await f.db.addressRequest.count({where:{orderId:o.id}})).toBe(0);expect(await f.db.orderBlock.count({where:{orderId:o.id}})).toBe(0);expect(await f.db.coordinationCommandResult.count({where:{orderId:o.id}})).toBe(0);expect(await f.db.order.findUniqueOrThrow({where:{id:o.id}})).toEqual(before);
 expect((await service().createAddress(f.support,o.id,body)).replayed).toBe(false);
});
it('同键并发仅一个请求、两类来源与一组任务，旧顾客及仓储投影不漏客服核实',async()=>{
 const o=await paid(),comm=await communication(o.id),body={...await orderBody(o.id),communicationId:comm.id};const results=await Promise.allSettled(Array.from({length:10},()=>service().createAddress(f.support,o.id,body)));
 expect(results.some(r=>r.status==='fulfilled')).toBe(true);for(const r of results)if(r.status==='rejected')expect(r.reason).toMatchObject({code:'REQUEST_IN_PROGRESS'});
 expect(await f.db.addressRequest.count({where:{orderId:o.id}})).toBe(1);expect(await f.db.task.count({where:{businessType:'ORDER',businessId:o.id,stage:'CUSTOMER_CONTACT',status:{in:['OPEN','CLAIMED','SUSPENDED']}}})).toBe(1);
 const queries=f.app.get(CoordinationQueries),warehouse=await queries.detail(f.warehouse,o.id);expect(warehouse?.communications).toEqual([]);expect(warehouse?.customerId).toBeNull();
 const outsider=await customer();await expect(queries.detail(outsider,o.id)).rejects.toMatchObject({code:'ORDER_NOT_FOUND'});
 const publicOrder=await f.app.get(OrderQueries).detail(o.c,o.id);expect(JSON.stringify(publicOrder)).not.toContain('verificationSummary');
});

it('未付改址不增付款或释放阻塞、不延原截止，顾客正式取消后重新跟进记录重下',async()=>{
 const c=await customer(),product=await f.db.product.create({data:{productCode:'M13-U-'+randomUUID(),name:'隔离未付服装',status:'ON_SALE',createdById:f.admin.actor.subjectId,updatedById:f.admin.actor.subjectId}}),sku=await f.db.sku.create({data:{code:('M13-U-'+randomUUID()).toUpperCase(),productId:product.id,combinationSignature:'DEFAULT',priceCents:9900,balance:{create:{available:10}}}}),a=await f.app.get(AddressService).create(c,address),cart=await f.app.get(CartService).add(c,{skuId:sku.id,quantity:2}),orders=f.app.get(OrderService),input={addressId:a.address.id,items:[{cartItemId:cart.item.id,skuId:sku.id,quantity:2}]},quote=await orders.preview(c,input),o=await orders.create(c,{...input,quoteId:quote.quoteId},randomUUID()),id=o.orderId,before=await f.db.order.findUniqueOrThrow({where:{id}}),created=await create(id);
 const current=await f.db.order.findUniqueOrThrow({where:{id}});expect(current.paymentDeadline).toEqual(before.paymentDeadline);expect(current.paymentBlocked).toBe(false);expect(current.releaseBlocked).toBe(false);expect(await f.db.orderBlock.count({where:{orderId:id}})).toBe(0);expect(await f.db.payment.count({where:{orderId:id}})).toBe(0);
 await claim(id,'CUSTOMER_CONTACT',f.support);await expect(service().resolveUnpaid(f.support,created.result.resultId,{...await orderBody(id,'CUSTOMER_CONTACT'),expectedRequestVersion:0,communicationId:created.comm.id})).rejects.toMatchObject({code:'ADDRESS_ROUTE_NOT_ALLOWED'});
 await f.app.get(OrderCommands).cancel(c,id);expect((await f.db.inventoryBalance.findUniqueOrThrow({where:{skuId:sku.id}})).available).toBe(10);
 await service().followup(f.support,id,{...await orderBody(id),sourceType:'ADDRESS_REQUEST',sourceId:created.result.resultId});await claim(id,'CUSTOMER_CONTACT',f.support);await service().resolveUnpaid(f.support,created.result.resultId,{...await orderBody(id,'CUSTOMER_CONTACT'),expectedRequestVersion:0,communicationId:created.comm.id});expect(await f.db.addressRequest.findUniqueOrThrow({where:{id:created.result.resultId}})).toMatchObject({status:'RESOLVED',resolutionKind:'CANCEL_REORDER'});expect((await f.db.order.findUniqueOrThrow({where:{id}})).detail).toBe(before.detail);
});
it('HTTP拒绝force/地址快照/金额/actor输入，顾客与仓储不能登记客服改址',async()=>{
 const o=await paid(),comm=await communication(o.id),b={...await orderBody(o.id),communicationId:comm.id};const {expectedTaskVersion:_task,...body}=b;void _task;
 for(const extra of [{force:true},{status:'REFUNDED'},{amountCents:1},{actor:o.c.actor.subjectId},{address}]){const r=await http('POST','/admin/orders/'+o.id+'/address-requests',f.support,{...body,...extra});expect(r.status).toBe(400);expect(r.json.code).toBe('VALIDATION_FAILED');}
 expect((await http('POST','/admin/orders/'+o.id+'/address-requests',f.warehouse,body)).status).toBe(403);expect((await http('POST','/admin/orders/'+o.id+'/address-requests',o.c,body)).status).toBe(401);expect(await f.db.addressRequest.count({where:{orderId:o.id}})).toBe(0);
});
it('改址持锁与交运确认竞争：先登记诉求保留同一未知Attempt，迟到确认不能越过核实',async()=>{
 const o=await paid();await claim(o.id);const items=await f.db.orderItem.findMany({where:{orderId:o.id}}),fulfillment=f.app.get(FulfillmentService);
 await fulfillment.pack(f.warehouse,o.id,{...await orderBody(o.id),expectedPhysicalVersion:0,goodsLocation:'真实在手',items:items.map(i=>({orderItemId:i.id,checkedQuantity:i.quantity}))});await fulfillment.prepare(f.warehouse,o.id,{...await orderBody(o.id),carrierName:'测试承运商',trackingNumber:'M13-C-'+randomUUID()});const view=await f.app.get(FulfillmentQueries).detail(f.warehouse,o.id),attempt=await fulfillment.start(f.warehouse,o.id,{...await orderBody(o.id),expectedPhysicalVersion:0,shipmentId:view.shipment!.id,packingCheckId:view.packingCheck!.id}),confirmBody={...await orderBody(o.id),attemptId:attempt.attemptId!,expectedAttemptVersion:attempt.attemptVersion!,actualHandoverAt:f.clock.now().toISOString()},comm=await communication(o.id),body={...await orderBody(o.id),communicationId:comm.id};
 let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;});f.audit.barrier={matches:p=>p.action==='coordination.change',entered,release:gate};const pending=service().createAddress(f.support,o.id,body);await ready;const confirming=fulfillment.confirm(f.warehouse,o.id,confirmBody);release();await pending;await expect(confirming).rejects.toMatchObject({code:'VERSION_CONFLICT'});expect(await f.db.handoverAttempt.findUniqueOrThrow({where:{id:attempt.attemptId!}})).toMatchObject({status:'UNCERTAIN'});expect(await f.db.handoverAttempt.count({where:{orderId:o.id}})).toBe(1);expect(await f.db.shipment.findUniqueOrThrow({where:{orderId:o.id}})).toMatchObject({actualHandoverAt:null});expect(await f.db.orderBlock.count({where:{orderId:o.id,active:true}})).toBe(2);
});
