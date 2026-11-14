// 作用：改址只是诉求；真实售后、来源移交、任务和阻塞同事务，订单收货快照始终保留。
import {Inject,Injectable} from '@nestjs/common';
import {Prisma,type AddressRequest,type Order} from '@prisma/client';
import {PrismaService} from '../prisma/prisma.service.js';
import type {CustomerContext} from '../customers/customer-access.service.js';
import {Clock} from '../common/time/clock.js';
import {commandFingerprint} from '../common/command-fingerprint.js';
import {AfterSaleService} from '../after-sales/after-sale.service.js';
import {orderRef} from '../after-sales/after-sale.rules.js';
import {TaskEntryService,type TaskEntryContext,type TaskTransactionScope} from '../tasks/task-entry.service.js';
import {TaskSourceService} from '../tasks/task-source.service.js';
import {OrderTimerService} from '../tasks/order-timer.service.js';
import {taskAuditActor} from '../tasks/task-lifecycle.service.js';
import {isTaskEligible} from '../tasks/task-access.service.js';
import type {TaskSourceReference} from '../tasks/task-source.contract.js';
import {AuditService} from '../audit/audit.service.js';
import {ownedOrder,requireOrderPermission} from '../orders/order-access.service.js';
import {checkWholeOrder,pendingHandover,sourceBelongs} from '../orders/fulfillment.rules.js';
import {FulfillmentService} from '../orders/fulfillment.service.js';
import {OfflineCaseService} from './offline-case.service.js';
import {ProxyInputService} from './proxy-input.service.js';
import {CoordinationError,activeCoordinationTasks} from './coordination.rules.js';
import type * as D from './coordination.dto.js';

@Injectable()
export class CoordinationService {
 constructor(@Inject(PrismaService)private readonly db:PrismaService,@Inject(Clock)private readonly clock:Clock,
 @Inject(AfterSaleService)private readonly sales:AfterSaleService,@Inject(TaskEntryService)private readonly entry:TaskEntryService,
 @Inject(TaskSourceService)private readonly sources:TaskSourceService,@Inject(OrderTimerService)private readonly timer:OrderTimerService,
 @Inject(FulfillmentService)private readonly fulfillment:FulfillmentService,@Inject(AuditService)private readonly audit:AuditService,
 @Inject(OfflineCaseService)private readonly offline:OfflineCaseService,@Inject(ProxyInputService)private readonly proxy:ProxyInputService){}
 private access(ctx:CustomerContext){return {type:ctx.actor.subjectType,subjectId:ctx.actor.subjectId,token:ctx.token};}
 private async present(tx:Prisma.TransactionClient,orderId:string,resultType:string,resultId:string,replayed:boolean){
  const o=await tx.order.findUniqueOrThrow({where:{id:orderId}}),a=resultType==='ADDRESS_REQUEST'?await tx.addressRequest.findUnique({where:{id:resultId}}):null;
  return {orderId,orderVersion:o.version,resultType,resultId,requestVersion:a?.version??null,replayed};
 }
 private command<T extends D.CoordinationCommandDto>(ctx:CustomerContext,orderId:string,action:string,b:T,targetId:string,work:(s:TaskTransactionScope,c:TaskEntryContext,o:Order)=>Promise<{type:string;id:string}>){
  const fingerprint=commandFingerprint({command:'coordination.'+action,version:1,actor:{type:ctx.actor.subjectType,id:ctx.actor.subjectId},payload:{orderId,targetId,command:JSON.parse(JSON.stringify(b))}});
  return this.sales.run(tx=>this.entry.withContext(tx,this.access(ctx),[orderRef(orderId)],ctx.requestId,c=>this.entry.inContext(c,orderRef(orderId),async s=>{
   requireOrderPermission(s.actor,action==='address-verify'?'order.fulfillment.read':'order.service.read');if(action!=='address-verify')requireOrderPermission(s.actor,'communication.service.write');const o=await ownedOrder(tx,orderId,s.actor);
   const previous=await tx.coordinationCommandResult.findUnique({where:{orderId_action_commandKey:{orderId,action,commandKey:b.commandKey}}});
   if(previous){if(previous.fingerprint!==fingerprint)throw new CoordinationError('COMMAND_PAYLOAD_CONFLICT');return this.present(tx,orderId,previous.resultType,previous.resultId,true);}
   if(o.version!==b.expectedOrderVersion)throw new CoordinationError('VERSION_CONFLICT');
   const result=await work(s,c,o);await s.revalidate();
   await tx.coordinationCommandResult.create({data:{orderId,action,commandKey:b.commandKey,fingerprint,resultType:result.type,resultId:result.id,createdAt:this.clock.now()}});
   return this.present(tx,orderId,result.type,result.id,false);
  })));
 }
 private async communication(s:TaskTransactionScope,orderId:string,id:string){
  const c=await s.tx.communication.findFirst({where:{id,scopeType:'ORDER',scopeId:orderId}});
  if(!c||!c.result.trim()||await s.tx.communication.count({where:{correctsId:id}}))throw new CoordinationError('COMMUNICATION_REQUIRED');return c;
 }
 private async task(s:TaskTransactionScope,orderId:string,stage:'CUSTOMER_CONTACT'|'PHYSICAL_VERIFY',version:number,source:TaskSourceReference){
  const t=await s.tx.task.findFirst({where:{...orderRef(orderId),stage,...activeCoordinationTasks}});
  if(s.actor.subjectType!=='EMPLOYEE'||!t||t.status!=='CLAIMED'||t.assigneeId!==s.actor.subjectId||!isTaskEligible(s.actor,t)||!await s.tx.taskBusinessSource.count({where:{taskId:t.id,...source,status:'ACTIVE'}}))throw new CoordinationError('TASK_NOT_ASSIGNEE');
  if(t.version!==version)throw new CoordinationError('VERSION_CONFLICT');return t;
 }
 private async record(s:TaskTransactionScope,a:AddressRequest,kind:string,reason:string,communicationId?:string,afterData?:Prisma.InputJsonObject){
  const employee=requireOrderPermission(s.actor,kind==='PHYSICAL_VERIFIED'?'order.fulfillment.read':'order.service.read');
  await s.tx.addressRequestEvent.create({data:{requestId:a.id,kind,reason,communicationId,actorEmployeeId:employee.subjectId,afterData,createdAt:this.clock.now()}});
  const current=await s.tx.addressRequest.findUniqueOrThrow({where:{id:a.id}});
  await this.audit.appendAudit(s.tx,{actor:taskAuditActor(s.actor),action:'coordination.change',targetId:a.id,reason,requestId:s.requestId,after:{orderId:a.orderId,businessId:a.id,businessType:'ORDER',coordinationAction:kind.toLowerCase().replaceAll('_','-'),coordinationStatus:current.status,coordinationVersion:current.version}});
 }
 private async request(tx:Prisma.TransactionClient,id:string,orderId:string,version:number|undefined){
  const a=await tx.addressRequest.findUnique({where:{id}});if(!a||a.orderId!==orderId)throw new CoordinationError('COORDINATION_NOT_FOUND');
  if(a.version!==version)throw new CoordinationError('VERSION_CONFLICT');if(a.status!=='OPEN')throw new CoordinationError('ADDRESS_REQUEST_NOT_OPEN');return a;
 }
 async orderForRequest(id:string){const row=await this.db.addressRequest.findUnique({where:{id},select:{orderId:true}});if(!row)throw new CoordinationError('COORDINATION_NOT_FOUND');return row.orderId;}
 createAddress(ctx:CustomerContext,orderId:string,b:D.CreateAddressRequestDto){return this.command(ctx,orderId,'address-create',b,orderId,async(s,c,o)=>{
  if(['CLOSED','REFUNDED'].includes(o.status))throw new CoordinationError('ADDRESS_ROUTE_NOT_ALLOWED');
  await this.communication(s,orderId,b.communicationId);if(await s.tx.addressRequest.count({where:{orderId,status:'OPEN'}}))throw new CoordinationError('ADDRESS_REQUEST_ALREADY_OPEN');
  const actor=requireOrderPermission(s.actor,'communication.service.write'),a=await s.tx.addressRequest.create({data:{orderId,customerId:o.customerId,reason:b.reason,communicationId:b.communicationId,proposedAddressSnapshot:b.proposedAddress?{...b.proposedAddress}:Prisma.DbNull,physicalVersionAtOpen:o.stockPhysicalVersion,createdById:actor.subjectId,createdAt:this.clock.now()}});
  if(o.paidAt&&!o.actualHandoverAt&&!['CLOSED','REFUNDED'].includes(o.status)){
   await this.timer.addBlock(c,orderId,{sourceType:'ADDRESS_REQUEST',sourceId:a.id},{commandKey:'address:'+b.commandKey,reason:b.reason});
   await this.fulfillment.afterSaleOpened(s,c,orderId,'address:'+b.commandKey);
   await this.sources.attach(c,{...orderRef(orderId),stage:'PHYSICAL_VERIFY',sourceType:'ADDRESS_REQUEST',sourceId:a.id,entryKey:'address:'+a.id,reason:'改址诉求暂停：核实已停止作业及货仍在手'});
  }
  await this.sources.attach(c,{...orderRef(orderId),stage:'CUSTOMER_CONTACT',sourceType:'ADDRESS_REQUEST',sourceId:a.id,entryKey:'address:'+a.id,reason:'联系顾客按原单事实协调改址路线'});
  await s.tx.order.update({where:{id:orderId},data:{version:{increment:1},updatedAt:this.clock.now()}});
  await this.record(s,a,'OPEN',b.reason,b.communicationId);return {type:'ADDRESS_REQUEST',id:a.id};
 });}
 verifyAddress(ctx:CustomerContext,id:string,b:D.VerifyAddressPhysicalDto){return this.orderForRequest(id).then(orderId=>this.command(ctx,orderId,'address-verify',b,id,async(s,c,o)=>{
  const a=await this.request(s.tx,id,orderId,b.expectedRequestVersion);requireOrderPermission(s.actor,'order.physical.check');
  const t=await this.task(s,orderId,'PHYSICAL_VERIFY',b.expectedTaskVersion,{sourceType:'ADDRESS_REQUEST',sourceId:id});
  if(o.actualHandoverAt||await pendingHandover(s.tx,orderId))throw new CoordinationError('HANDOVER_VERIFICATION_REQUIRED');
  if(o.stockPhysicalVersion!==b.expectedPhysicalVersion)throw new CoordinationError('PHYSICAL_CHECK_STALE');
  const items=checkWholeOrder(await s.tx.orderItem.findMany({where:{orderId}}),b.items),actor=requireOrderPermission(s.actor,'order.physical.check');
  const f=await s.tx.fulfillment.upsert({where:{orderId},create:{orderId},update:{}}),p=await s.tx.packingCheck.create({data:{orderId,fulfillmentId:f.id,checkedPhysicalVersion:o.stockPhysicalVersion,checkedItems:items,goodsLocation:b.goodsLocation,checkedById:actor.subjectId,commandKey:b.commandKey,createdAt:this.clock.now()}});
  await this.record(s,a,'PHYSICAL_VERIFIED',b.reason,undefined,{packingCheckId:p.id,physicalVersion:o.stockPhysicalVersion});
  await this.sources.resolve(c,{...orderRef(orderId),taskId:t.id,expectedVersion:t.version,sourceType:'ADDRESS_REQUEST',sourceId:id,commandKey:b.commandKey,reason:'已核实停止作业及货仍在手，本记录不代替售后逐行可售核实'});
  return {type:'PACKING_CHECK',id:p.id};
 }));}
 private async physical(tx:Prisma.TransactionClient,a:AddressRequest,o:Order,id?:string){
  const event=id?await tx.addressRequestEvent.findFirst({where:{requestId:a.id,kind:'PHYSICAL_VERIFIED',afterData:{path:['packingCheckId'],equals:id}},orderBy:{createdAt:'desc'}}):null;
  const p=id?await tx.packingCheck.findUnique({where:{id}}):null;
  if(!event||!p||p.orderId!==o.id||p.checkedPhysicalVersion!==o.stockPhysicalVersion||o.actualHandoverAt||await pendingHandover(tx,o.id))throw new CoordinationError('PHYSICAL_CHECK_STALE');return p;
 }
 private async endSources(s:TaskTransactionScope,c:TaskEntryContext,orderId:string,source:TaskSourceReference,key:string,onlyContact=false){
  const ts=await s.tx.task.findMany({where:{...orderRef(orderId),...activeCoordinationTasks,...(onlyContact?{stage:'CUSTOMER_CONTACT'}:{})},orderBy:{id:'asc'}});
  for(const t of ts)if(await s.tx.taskBusinessSource.count({where:{taskId:t.id,...source,status:'ACTIVE'}}))await this.sources.resolve(c,{...orderRef(orderId),taskId:t.id,expectedVersion:t.version,...source,commandKey:key,reason:'本协作来源已移交或结束，其它来源继续'});
 }
 private async releaseAddress(s:TaskTransactionScope,c:TaskEntryContext,a:AddressRequest,key:string){
  if(await s.tx.orderBlock.count({where:{orderId:a.orderId,sourceType:'ADDRESS_REQUEST',sourceId:a.id,active:true}}))await this.timer.releaseBlock(c,a.orderId,{sourceType:'ADDRESS_REQUEST',sourceId:a.id},{commandKey:'address-end:'+key,reason:'仅解除本改址来源'});
  await this.endSources(s,c,a.orderId,{sourceType:'ADDRESS_REQUEST',sourceId:a.id},key);
 }
 continueOriginal(ctx:CustomerContext,id:string,b:D.ContinueAddressDto){return this.orderForRequest(id).then(orderId=>this.command(ctx,orderId,'address-continue',b,id,async(s,c,o)=>{
  const a=await this.request(s.tx,id,orderId,b.expectedRequestVersion);await this.communication(s,orderId,b.communicationId);await this.task(s,orderId,'CUSTOMER_CONTACT',b.expectedTaskVersion,{sourceType:'ADDRESS_REQUEST',sourceId:id});
  if(b.customerConsent!=='CONTINUE_ORIGINAL')throw new CoordinationError('COMMUNICATION_REQUIRED');
  await this.physical(s.tx,a,o,b.physicalVerificationId);
  await s.tx.addressRequest.update({where:{id},data:{status:'CANCELLED',resolutionKind:'CONTINUE_ORIGINAL',resolvedAt:this.clock.now(),version:{increment:1}}});
  await this.releaseAddress(s,c,a,b.commandKey);await this.fulfillment.resumeShipping(s,c,orderId,b.commandKey,'顾客明确继续原地址，重新领取作业',true);
  await s.tx.order.update({where:{id:orderId},data:{version:{increment:1},updatedAt:this.clock.now()}});await this.record(s,a,'CONTINUE_ORIGINAL',b.reason,b.communicationId);return {type:'ADDRESS_REQUEST',id};
 }));}
 resolveUnpaid(ctx:CustomerContext,id:string,b:D.AddressCommandDto){return this.orderForRequest(id).then(orderId=>this.command(ctx,orderId,'address-cancel-reorder',b,id,async(s,c,o)=>{
  const a=await this.request(s.tx,id,orderId,b.expectedRequestVersion);await this.communication(s,orderId,b.communicationId);await this.task(s,orderId,'CUSTOMER_CONTACT',b.expectedTaskVersion,{sourceType:'ADDRESS_REQUEST',sourceId:id});
  if(o.status!=='CLOSED'||o.paidAt)throw new CoordinationError('ADDRESS_ROUTE_NOT_ALLOWED');
  await s.tx.addressRequest.update({where:{id},data:{status:'RESOLVED',resolutionKind:'CANCEL_REORDER',resolvedAt:this.clock.now(),version:{increment:1}}});await this.releaseAddress(s,c,a,b.commandKey);await this.record(s,a,'CANCEL_REORDER',b.reason,b.communicationId);return {type:'ADDRESS_REQUEST',id};
 }));}
 handoffOffline(ctx:CustomerContext,id:string,b:D.AddressOfflineDto){return this.orderForRequest(id).then(orderId=>this.command(ctx,orderId,'address-offline',b,id,async(s,c,o)=>{
  const a=await this.request(s.tx,id,orderId,b.expectedRequestVersion);await this.communication(s,orderId,b.communicationId);await this.task(s,orderId,'CUSTOMER_CONTACT',b.expectedTaskVersion,{sourceType:'ADDRESS_REQUEST',sourceId:id});
  requireOrderPermission(s.actor,'offline-case.manage');if(!o.actualHandoverAt||await pendingHandover(s.tx,orderId))throw new CoordinationError('HANDOVER_VERIFICATION_REQUIRED');
  const offline=await this.offline.createInContext(s,{orderId,type:'FORWARDING',addressRequestId:id,subject:'已交运改址线下转寄',description:b.reason,publicSummary:b.publicSummary,commandKey:b.commandKey,reason:b.reason},this.access(ctx));
  await s.tx.addressRequest.update({where:{id},data:{status:'HANDED_OFF',resolutionKind:'OFFLINE_FORWARD',handoffOfflineCaseId:offline.id,resolvedAt:this.clock.now(),version:{increment:1}}});await this.releaseAddress(s,c,a,b.commandKey);
  await this.record(s,a,'HANDOFF_OFFLINE',b.reason,b.communicationId);return {type:'OFFLINE_CASE',id:offline.id};
 }));}
 private applyBody(orderId:string,b:D.AssistedAfterSaleDto){return {orderId,type:b.type,reasonCode:b.reasonCode,description:b.description,evidenceFileIds:b.evidenceFileIds,commandKey:b.commandKey};}
 private async apply(s:TaskTransactionScope,ctx:CustomerContext,o:Order,b:D.AssistedAfterSaleDto){
  requireOrderPermission(s.actor,'after-sale.review');requireOrderPermission(s.actor,'after-sale.service.read');
  if(b.customerConsent!=='REFUND_FULL')throw new CoordinationError('COMMUNICATION_REQUIRED');await this.communication(s,o.id,b.communicationId);
  const customer=await s.tx.customer.findUniqueOrThrow({where:{id:o.customerId}}),body=this.applyBody(o.id,b);
  if(customer.status==='LOGIN_FROZEN'){
   if(!b.proxyContextId||b.expectedProxyTaskVersion===undefined)throw new CoordinationError('COMMUNICATION_REQUIRED');
   return this.proxy.executeApplyInTransaction(ctx,s.tx,b.proxyContextId,body,b.expectedProxyTaskVersion);
  }
  if(b.proxyContextId)throw new CoordinationError('VALIDATION_FAILED');
  return this.sales.applyInTransaction(ctx,s.tx,body,{representedCustomerId:o.customerId,sourceCommunicationId:b.communicationId,assistance:true});
 }
 fromException(ctx:CustomerContext,orderId:string,b:D.AssistedAfterSaleDto){return this.command(ctx,orderId,'exception-after-sale',b,orderId,async(s,c,o)=>{
  const ex=b.exceptionId?await s.tx.shipmentException.findFirst({where:{id:b.exceptionId,orderId,status:'OPEN'}}):null;
  if(!ex)throw new CoordinationError('COORDINATION_NOT_FOUND');if(ex.version!==b.expectedExceptionVersion)throw new CoordinationError('VERSION_CONFLICT');
  await this.task(s,orderId,'CUSTOMER_CONTACT',b.expectedTaskVersion,{sourceType:'SHIPMENT_EXCEPTION',sourceId:ex.id});
  const latest=await s.tx.shipmentExceptionDecision.findFirst({where:{exceptionId:ex.id,kind:{startsWith:'CUSTOMER_'}},orderBy:[{createdAt:'desc'},{id:'desc'}]});
  if(latest?.kind!=='CUSTOMER_REQUEST_REFUND')throw new CoordinationError('COMMUNICATION_REQUIRED');
  const result=await this.apply(s,ctx,o,b);await s.tx.coordinationHandoff.create({data:{orderId,sourceType:'SHIPMENT_EXCEPTION',sourceId:ex.id,semanticApplyKey:b.commandKey,afterSaleId:result.afterSaleId}});
  await this.endSources(s,c,orderId,{sourceType:'SHIPMENT_EXCEPTION',sourceId:ex.id},b.commandKey,true);
  await this.audit.appendAudit(s.tx,{actor:taskAuditActor(s.actor),action:'coordination.change',targetId:ex.id,reason:b.reason,requestId:s.requestId,after:{orderId,sourceId:result.afterSaleId,coordinationAction:'exception-handoff',coordinationStatus:'HANDED_OFF'}});return {type:'AFTER_SALE',id:result.afterSaleId};
 });}
 handoffAfterSale(ctx:CustomerContext,id:string,b:D.AssistedAfterSaleDto){return this.orderForRequest(id).then(orderId=>this.command(ctx,orderId,'address-after-sale',b,id,async(s,c,o)=>{
  const a=await this.request(s.tx,id,orderId,b.expectedRequestVersion);await this.task(s,orderId,'CUSTOMER_CONTACT',b.expectedTaskVersion,{sourceType:'ADDRESS_REQUEST',sourceId:id});
  if(b.type!=='REFUND_ONLY'||o.status!=='WAIT_SHIPMENT'||!o.paidAt)throw new CoordinationError('ADDRESS_ROUTE_NOT_ALLOWED');await this.physical(s.tx,a,o,b.physicalVerificationId);
  const result=await this.apply(s,ctx,o,b);await s.tx.coordinationHandoff.create({data:{orderId,sourceType:'ADDRESS_REQUEST',sourceId:id,semanticApplyKey:b.commandKey,afterSaleId:result.afterSaleId}});
  await s.tx.addressRequest.update({where:{id},data:{status:'HANDED_OFF',resolutionKind:'REFUND_REORDER',handoffAfterSaleId:result.afterSaleId,resolvedAt:this.clock.now(),version:{increment:1}}});
  await this.releaseAddress(s,c,a,b.commandKey);await this.record(s,a,'HANDOFF_AFTER_SALE',b.reason,b.communicationId);return {type:'AFTER_SALE',id:result.afterSaleId};
 }));}
 followup(ctx:CustomerContext,orderId:string,b:D.CoordinationFollowupDto){return this.command(ctx,orderId,'followup',b,orderId,async(s,c)=>{
  requireOrderPermission(s.actor,'shipment.customer-confirm');if(!await sourceBelongs(s.tx,orderId,b.sourceType,b.sourceId))throw new CoordinationError('COORDINATION_NOT_FOUND');
  const open=b.sourceType==='ADDRESS_REQUEST'?await s.tx.addressRequest.count({where:{id:b.sourceId,status:'OPEN'}}):b.sourceType==='SHIPMENT_EXCEPTION'?await s.tx.shipmentException.count({where:{id:b.sourceId,status:'OPEN'}}):await s.tx.stockIncident.count({where:{id:b.sourceId,status:'OPEN'}});
  if(!open)throw new CoordinationError('ADDRESS_ROUTE_NOT_ALLOWED');
  const current=await s.tx.task.findFirst({where:{...orderRef(orderId),stage:'CUSTOMER_CONTACT',...activeCoordinationTasks}});
  if(current&&await s.tx.taskBusinessSource.count({where:{taskId:current.id,sourceType:b.sourceType,sourceId:b.sourceId,status:'ACTIVE'}}))return {type:'TASK',id:current.id};
  const result=await this.sources.attach(c,{...orderRef(orderId),stage:'CUSTOMER_CONTACT',sourceType:b.sourceType,sourceId:b.sourceId,entryKey:'followup:'+b.commandKey,reason:b.reason});return {type:'TASK',id:result.task.id};
 });}
}
