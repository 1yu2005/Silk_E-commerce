// 作用：异常详情按真实权限回答实物、经办、后续、期限、库存和退款六个问题。
import {Inject,Injectable} from '@nestjs/common';
import {AfterSaleService} from '../after-sales/after-sale.service.js';
import {orderRef,terminalStatuses} from '../after-sales/after-sale.rules.js';
import {TaskEntryService} from '../tasks/task-entry.service.js';
import {isTaskEligible} from '../tasks/task-access.service.js';
import {ownedOrder,requireOrderPermission} from '../orders/order-access.service.js';
import {Clock} from '../common/time/clock.js';
import type {CustomerContext} from '../customers/customer-access.service.js';
import {publicOfflineForOrder} from './offline-case.public.js';
@Injectable()
export class CoordinationQueries {
 constructor(@Inject(AfterSaleService)private readonly sales:AfterSaleService,@Inject(TaskEntryService)private readonly entry:TaskEntryService,@Inject(Clock)private readonly clock:Clock){}
 detail(ctx:CustomerContext,id:string){return this.sales.run(tx=>this.entry.withContext(tx,{type:ctx.actor.subjectType,subjectId:ctx.actor.subjectId,token:ctx.token},[orderRef(id)],ctx.requestId,c=>this.entry.inContext(c,orderRef(id),async s=>{
  const o=await ownedOrder(tx,id,s.actor),customer=await tx.customer.findUniqueOrThrow({where:{id:o.customerId}});
  if(s.actor.subjectType==='CUSTOMER')return {orderId:o.id,orderNo:o.number,orderStatus:o.status,requests:(await tx.addressRequest.findMany({where:{orderId:id},orderBy:{createdAt:'desc'},take:50})).map(a=>({id:a.id,status:a.status,resolutionKind:a.resolutionKind,createdAt:a.createdAt})),offlineCases:await publicOfflineForOrder(tx,id,o.customerId),serverTime:this.clock.now()};
  const a=s.actor;if(a.subjectType!=='EMPLOYEE')return null;
  const service=a.effectivePermissions.includes('order.service.read');if(!service)requireOrderPermission(a,'order.fulfillment.read');
  const sales=await tx.afterSale.findMany({where:{orderId:id},orderBy:{createdAt:'desc'},take:50}),cases=service&&a.effectivePermissions.includes('offline-case.manage')?await tx.offlineCase.findMany({where:{orderId:id},orderBy:{createdAt:'desc'},take:50}):[];
  const custody=await tx.custodyArrangement.findMany({where:{afterSaleId:{in:sales.map(s=>s.id)}},orderBy:{id:'asc'},take:100});
  const tasks=await tx.task.findMany({where:{OR:[orderRef(id),{businessType:'AFTER_SALE',businessId:{in:sales.map(s=>s.id)}},{businessType:'OFFLINE_CASE',businessId:{in:cases.map(s=>s.id)}},{businessType:'CUSTODY_ARRANGEMENT',businessId:{in:custody.map(s=>s.id)}}],status:{in:['OPEN','CLAIMED','SUSPENDED']}},orderBy:[{createdAt:'asc'},{id:'asc'}],take:100});
  const sources=await tx.taskBusinessSource.findMany({where:{taskId:{in:tasks.map(t=>t.id)},status:'ACTIVE'},orderBy:{id:'asc'}});
  const exceptions=await tx.shipmentException.findMany({where:{orderId:id},orderBy:{createdAt:'desc'},take:50}),handoffs=await tx.coordinationHandoff.findMany({where:{orderId:id}});
  const decisions=await tx.shipmentExceptionDecision.findMany({where:{exceptionId:{in:exceptions.map(e=>e.id)},kind:{startsWith:'CUSTOMER_'}},orderBy:[{createdAt:'desc'},{id:'desc'}]});
  const requests=await tx.addressRequest.findMany({where:{orderId:id},orderBy:{createdAt:'desc'},take:50}),verified=await tx.addressRequestEvent.findMany({where:{requestId:{in:requests.map(r=>r.id)},kind:'PHYSICAL_VERIFIED'},orderBy:[{createdAt:'desc'},{id:'desc'}]});
  const payment=service?await tx.payment.findUnique({where:{orderId:id}}):null,refund=service?await tx.refund.findUnique({where:{orderId:id}}):null;
  const packing=await tx.packingCheck.findFirst({where:{orderId:id},orderBy:[{createdAt:'desc'},{id:'desc'}]});
  const ledger=a.effectivePermissions.includes('inventory.read')?await tx.inventoryLedger.findMany({where:{OR:[{businessType:'ORDER',businessId:id},{businessType:'AFTER_SALE',businessId:{in:sales.map(v=>v.id)}}]},orderBy:[{createdAt:'desc'},{id:'desc'}],take:50}):[];
  const balances=await tx.inventoryBalance.findMany({where:{skuId:{in:(await tx.orderItem.findMany({where:{orderId:id},select:{skuId:true}})).map(i=>i.skuId)}}});
  return {orderId:o.id,orderNo:o.number,orderStatus:o.status,orderVersion:o.version,fulfillmentStage:o.fulfillmentStage,physicalVersion:o.stockPhysicalVersion,actualHandoverAt:o.actualHandoverAt,autoReceiptDueAt:o.autoReceiptDueAt,
   customerId:service?o.customerId:null,customerStatus:service?customer.status:null,customerStatusVersion:service?customer.statusVersion:null,
   lastPhysicalCheck:packing?{id:packing.id,goodsLocation:packing.goodsLocation,checkedPhysicalVersion:packing.checkedPhysicalVersion,createdAt:packing.createdAt,current:!o.actualHandoverAt&&!['HANDOVER_IN_PROGRESS','HANDOVER_UNCERTAIN'].includes(o.fulfillmentStage)&&packing.checkedPhysicalVersion===o.stockPhysicalVersion}:null,
   inventoryLedger:ledger.map(l=>({id:l.id,actionId:l.actionId,skuId:l.skuId,eventType:l.eventType,beforeA:l.beforeA,beforeR:l.beforeR,deltaA:l.deltaA,deltaR:l.deltaR,afterA:l.afterA,afterR:l.afterR,createdAt:l.createdAt})),
   blocks:(await tx.orderBlock.findMany({where:{orderId:id,active:true},orderBy:{createdAt:'asc'}})).map(b=>({id:b.id,sourceType:b.sourceType,sourceId:b.sourceId,blocksShipment:b.blocksShipment,blocksReceipt:b.blocksReceipt})),
   tasks:tasks.map(t=>({id:t.id,businessType:t.businessType,businessId:t.businessId,stage:t.stage,status:t.status,round:t.round,version:t.version,assigneeId:t.assigneeId,dueAt:t.dueAt,originalDueAt:t.originalDueAt,firstOverdueAt:t.firstOverdueAt,reassignNeeded:t.reassignNeeded,canClaim:t.status==='OPEN'&&isTaskEligible(a,t),sources:sources.filter(r=>r.taskId===t.id).map(r=>({sourceType:r.sourceType,sourceId:r.sourceId}))})),
   requests:requests.map(r=>({id:r.id,status:r.status,version:r.version,reason:service?r.reason:null,proposedAddressSnapshot:service?r.proposedAddressSnapshot:null,communicationId:service?r.communicationId:null,resolutionKind:r.resolutionKind,handoffAfterSaleId:r.handoffAfterSaleId,handoffOfflineCaseId:r.handoffOfflineCaseId,physicalVerificationId:(verified.find(e=>e.requestId===r.id)?.afterData as {packingCheckId?:string}|null)?.packingCheckId??null,createdAt:r.createdAt})),
   exceptions:exceptions.map(e=>({id:e.id,type:e.type,status:e.status,version:e.version,goodsLocation:e.goodsLocation,physicalVersion:e.currentVerifiedPhysicalVersion,customerChoice:service?decisions.find(d=>d.exceptionId===e.id)?.kind??null:null,handedAfterSaleIds:handoffs.filter(h=>h.sourceType==='SHIPMENT_EXCEPTION'&&h.sourceId===e.id).map(h=>h.afterSaleId)})),
   afterSales:sales.map(v=>({id:v.id,number:v.number,status:v.status,version:v.version,returnPhysicalVersion:v.returnPhysicalVersion,active:!terminalStatuses.includes(v.status)})),
   custody:custody.map(v=>({id:v.id,afterSaleId:v.afterSaleId,description:v.description,quantity:v.quantity,disposition:v.disposition,location:v.location,plannedAction:v.plannedAction,status:v.status,version:v.version,followOfflineCaseId:v.followOfflineCaseId})),
   offlineCases:cases.map(v=>({id:v.id,caseNo:v.caseNo,type:v.type,status:v.status,version:v.version,subject:v.subject,publicSummary:v.publicSummary})),
   payment:payment?{number:payment.number,status:payment.status,amountCents:payment.amountCents,paidAt:payment.paidAt}:null,
   refund:refund?{id:refund.id,number:refund.refundNo,status:refund.status,amountCents:refund.amountCents,succeededAt:refund.succeededAt,attemptCount:await tx.refundAttempt.count({where:{refundId:refund.id}})}:null,
   balances:a.effectivePermissions.includes('inventory.read')?balances.map(b=>({skuId:b.skuId,available:b.available,reserved:b.reserved})):[],
   stockIncidents:(await tx.stockIncident.findMany({where:{items:{some:{orderItem:{orderId:id}}}},orderBy:{createdAt:'desc'},take:50})).map(i=>({id:i.id,status:i.status,reason:i.reason,version:i.version})),
   communications:service?(await tx.communication.findMany({where:{scopeType:'ORDER',scopeId:id},orderBy:[{createdAt:'desc'},{id:'desc'}],take:20})).map(v=>({id:v.id,result:v.result,publicText:v.publicText,createdAt:v.createdAt})):[],
   proxyContexts:service&&a.effectivePermissions.includes('customer.frozen.proxy')?(await tx.proxyContext.findMany({where:{orderId:id,verifiedById:a.subjectId},orderBy:{createdAt:'desc'},take:20})).map(v=>({id:v.id,action:v.action,status:v.status,expiresAt:v.expiresAt})):[],
   serverTime:this.clock.now(),inventoryNotice:'协作记录本身不改变库存；以原库存Action/流水为准',refundNotice:'售后申请、意愿和线下记录均不代表系统退款成功'};
 })));}
}
