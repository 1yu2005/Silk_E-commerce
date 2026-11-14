// 作用：唯一全额模拟退款；原键恢复、业务失败和前置拒绝均以数据库提交事实为准。
import {Inject,Injectable} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import type {AfterSale,Prisma,RefundAttempt,Task} from '@prisma/client';
import {commandFingerprint} from '../common/command-fingerprint.js';
import type {CustomerContext} from '../customers/customer-access.service.js';
import {InventoryAutomatic} from '../inventory/inventory-automatic.service.js';
import {OrderTimerService} from '../tasks/order-timer.service.js';
import {AuditService} from '../audit/audit.service.js';
import {StateHistoryService} from '../records/state-history.service.js';
import type {TaskEntryContext,TaskTransactionScope} from '../tasks/task-entry.service.js';
import {pendingHandover} from '../orders/fulfillment.rules.js';
import {currentDamage} from '../orders/order-stock.js';
import {isTaskEligible} from '../tasks/task-access.service.js';
import {SettlementSupport} from './settlement-support.service.js';
import {UnshippedPhysicalService} from './unshipped-physical.service.js';
import {ownedSale,salePermission} from './after-sale.access.js';
import {orderRef,saleRef} from './after-sale.rules.js';
import {SettlementError,activeTasks,sameIds} from './settlement.rules.js';
import type {RefundDto,RefundRetryDto} from './settlement.dto.js';

/** 生产实现始终成功；测试仅通过Nest依赖注入替换，既无HTTP控制也不读取环境失败开关。 */
@Injectable()
export class RefundSimulator{
 execute(_facts:{refundId:string;afterSaleId:string;committedAttempts:number}):Promise<'SUCCEEDED'|'FAILED'>{void _facts;return Promise.resolve('SUCCEEDED');}
}
@Injectable()
export class RefundService{
 constructor(@Inject(SettlementSupport)private readonly k:SettlementSupport,@Inject(InventoryAutomatic)private readonly stock:InventoryAutomatic,
 @Inject(RefundSimulator)private readonly simulator:RefundSimulator,@Inject(UnshippedPhysicalService)private readonly physical:UnshippedPhysicalService,
 @Inject(OrderTimerService)private readonly timer:OrderTimerService,@Inject(StateHistoryService)private readonly history:StateHistoryService,@Inject(AuditService)private readonly audit:AuditService){}
 async execute(ctx:CustomerContext,id:string,b:RefundDto|RefundRetryDto,retry=false){
  const fingerprint=commandFingerprint({command:retry?'after-sale.refund.retry':'after-sale.refund',version:1,actor:{type:ctx.actor.subjectType,id:ctx.actor.subjectId},payload:JSON.parse(JSON.stringify({afterSaleId:id,...b}))});
  const result=await this.k.sales.run(async tx=>{
   const loc=await tx.afterSale.findUnique({where:{id},select:{orderId:true}});if(!loc)throw new SettlementError('REFUND_PRECONDITION_FAILED');
   return this.k.entry.withContext(tx,{type:ctx.actor.subjectType,subjectId:ctx.actor.subjectId,token:ctx.token},[orderRef(loc.orderId),saleRef(id)],ctx.requestId,c=>this.k.entry.inContext(c,saleRef(id),async s=>{
    let a=await ownedSale(tx,id,s.actor);const actor=salePermission(s.actor,'after-sale.refund.execute');salePermission(actor,'after-sale.service.read');
    if(retry)salePermission(actor,'after-sale.refund.retry');
    const rejection=await tx.refundPreconditionRejection.findUnique({where:{afterSaleId_commandKey:{afterSaleId:id,commandKey:b.commandKey}}});
    if(rejection){if(rejection.fingerprint!==fingerprint)throw new SettlementError('COMMAND_PAYLOAD_CONFLICT');return {rejection:'PHYSICAL_CHECK_STALE' as const};}
    let refund=await tx.refund.findUnique({where:{afterSaleId:id}});
    const prior=refund?await tx.refundAttempt.findUnique({where:{refundId_commandKey:{refundId:refund.id,commandKey:b.commandKey}}}):null;
    if(prior){if(prior.fingerprint!==fingerprint)throw new SettlementError('COMMAND_PAYLOAD_CONFLICT');return this.result(tx,a,prior,true);}
    if(refund?.status==='SUCCEEDED')throw new SettlementError('REFUND_ALREADY_SUCCEEDED');
    const o=await tx.order.findUniqueOrThrow({where:{id:a.orderId}}),pending=await pendingHandover(tx,o.id);
    if(a.type==='REFUND_ONLY'&&!o.actualHandoverAt||b.physicalCheckId){
     const check=a.activeUnshippedCheckId?await tx.unshippedPhysicalCheck.findUnique({where:{id:a.activeUnshippedCheckId}}):null;
     if(!check||check.id!==b.physicalCheckId||check.afterSaleId!==id||check.orderId!==o.id||check.status!=='VALID'||check.physicalVersion!==o.stockPhysicalVersion||b.expectedPhysicalVersion!==o.stockPhysicalVersion||o.actualHandoverAt||pending){
      await this.physical.invalidate(tx,o.id,ctx.requestId);
      await tx.refundPreconditionRejection.create({data:{afterSaleId:id,commandKey:b.commandKey,fingerprint,code:'PHYSICAL_CHECK_STALE',publicResult:{code:'PHYSICAL_CHECK_STALE'},createdAt:this.k.clock.now()}});
      await this.k.sales.auditChange(s,a,'refund-precondition-rejected',b.commandKey,a.status);
      return {rejection:'PHYSICAL_CHECK_STALE' as const};
     }
     const ls=await currentDamage(tx,o.id),cl=await tx.unshippedPhysicalCheckItem.findMany({where:{checkId:check.id}});
     if(!sameIds(ls.map(l=>l.id),cl.map(l=>l.orderItemId))||ls.some(l=>{const x=cl.find(x=>x.orderItemId===l.id)!;return l.unknown||x.purchasedQty!==l.quantity||x.damagedQty!==l.damaged||x.sellableQty+x.damagedQty!==l.quantity;}))throw new SettlementError('PHYSICAL_CHECK_INCOMPLETE');
    }
    a=await tx.afterSale.findUniqueOrThrow({where:{id}});
    if(a.version!==b.expectedAfterSaleVersion)throw new SettlementError('VERSION_CONFLICT');
    if(a.status!==(retry?'REFUND_FAILED':'WAIT_REFUND')||pending||!['WAIT_SHIPMENT','SHIPPED','COMPLETED'].includes(o.status))throw new SettlementError('REFUND_PRECONDITION_FAILED');
    const t=await this.k.task(s,id,'REFUND_PROCESS',b.expectedTaskVersion);
    if(retry){const rb=b as RefundRetryDto;if(!refund||refund.id!==rb.refundId||refund.version!==rb.expectedRefundVersion||refund.status!=='FAILED')throw new SettlementError('VERSION_CONFLICT');}else if(refund)throw new SettlementError('REFUND_PRECONDITION_FAILED');
    if(a.type==='RETURN_REFUND'){
     const fi=a.finalInspectionId?await tx.finalInspection.findUnique({where:{id:a.finalInspectionId}}):null;
     if(!fi||fi.id!==b.expectedFinalInspectionId||fi.afterSaleId!==id||!fi.inventoryActionId||a.activeUnshippedCheckId)throw new SettlementError('REFUND_PRECONDITION_FAILED');
    }else if(o.actualHandoverAt){if(!await tx.afterSaleDecision.count({where:{afterSaleId:id,kind:{in:['APPROVE_REFUND_ONLY','NO_RETURN_REFUND_CONFIRM']},toStatus:'WAIT_REFUND'}}))throw new SettlementError('REFUND_PRECONDITION_FAILED');}
    const p=await tx.payment.findUnique({where:{id:a.paymentId}});if(!p||p.status!=='SUCCEEDED'||p.orderId!==o.id||p.amountCents!==a.requestedRefundAmount)throw new SettlementError('REFUND_PRECONDITION_FAILED');
    const now=this.k.clock.now();if(!refund)refund=await tx.refund.create({data:{refundNo:'RF'+now.getTime().toString(36).toUpperCase()+randomUUID().replaceAll('-','').slice(0,14).toUpperCase(),paymentId:p.id,orderId:o.id,afterSaleId:id,amountCents:p.amountCents,currency:p.currency,channel:'SIMULATED',status:'REFUNDING',createdAt:now,updatedAt:now}});
    const attempts=await tx.refundAttempt.count({where:{refundId:refund.id}}),outcome=await this.simulator.execute({refundId:refund.id,afterSaleId:id,committedAttempts:attempts});
    const at=await tx.refundAttempt.create({data:{refundId:refund.id,attemptNo:attempts+1,commandKey:b.commandKey,fingerprint,outcome,actorEmployeeId:actor.subjectId,taskId:t.id,physicalCheckId:o.actualHandoverAt?null:a.activeUnshippedCheckId,finalInspectionId:a.finalInspectionId,failureCode:outcome==='FAILED'?'SIMULATED_TEMPORARY_FAILURE':null,publicExplanation:outcome==='FAILED'?'模拟退款暂时失败，客服将继续重试':'整单全额模拟退款成功，不发生真实资金流转',startedAt:now,finishedAt:this.k.clock.now(),requestId:ctx.requestId}});
    await tx.refund.update({where:{id:refund.id},data:{status:outcome,version:{increment:1},succeededAt:outcome==='SUCCEEDED'?this.k.clock.now():null,successfulAttemptId:outcome==='SUCCEEDED'?at.id:null,updatedAt:this.k.clock.now()}});
    if(outcome==='FAILED'){
     await this.k.sales.update(tx,a,{status:'REFUND_FAILED',refundId:refund.id,lastPublicExplanation:at.publicExplanation});await this.retryQualification(s,t,b.commandKey);
    }else{
     if(a.type==='REFUND_ONLY'&&!o.actualHandoverAt){await this.stock.execute(tx,'UNSHIPPED_REFUND_RESTOCK',refund.id,c,ctx.requestId);await tx.unshippedPhysicalCheck.update({where:{id:a.activeUnshippedCheckId!},data:{status:'CONSUMED',consumedRefundId:refund.id}});await this.settleDamage(s,o.id,b.commandKey);}
     await tx.order.update({where:{id:o.id},data:{status:'REFUNDED',version:{increment:1},updatedAt:this.k.clock.now()}});
     await this.k.sales.update(tx,a,{status:'SUCCEEDED',refundId:refund.id,closedAt:this.k.clock.now(),lastPublicExplanation:at.publicExplanation});
     // 先终止计时，再释放本售后阻塞，保证不会发生一次虚假的收货恢复。
     await this.timer.finishOrderTimer(c,o.id,'REFUNDED',{commandKey:'refund:'+b.commandKey,reason:'全额模拟退款成功，永久终止履约计时'});
     await this.k.sales.cancelOrderSources(s,c,a,b.commandKey);await this.timer.releaseBlock(c,o.id,{sourceType:'AFTER_SALE',sourceId:id},{commandKey:'refund-release:'+b.commandKey,reason:'仅结束本售后来源，不清其它调查事实'});
     await this.k.transition(c,t,b.commandKey,'全额模拟退款成功');
     await this.finishTasks(s,c,a,b.commandKey);
     await this.history.appendStateHistory(tx,{type:'EMPLOYEE',id:actor.subjectId},{aggregateType:'ORDER',aggregateId:o.id,dimension:'status',fromState:o.status,toState:'REFUNDED',commandKey:b.commandKey,reason:'整单全额模拟退款成功',requestId:ctx.requestId,publicText:at.publicExplanation});
    }
    await this.k.sales.auditChange(s,a,retry?'refund-retry':'refund',b.commandKey,a.status,at.publicExplanation);await s.revalidate();return this.result(tx,a,at,false);
   }));
  });
  if('rejection' in result)throw new SettlementError(result.rejection);return result;
 }
 private async result(tx:Prisma.TransactionClient,a:AfterSale,at:RefundAttempt,replayed:boolean){const sale=await tx.afterSale.findUniqueOrThrow({where:{id:a.id}}),r=await tx.refund.findUniqueOrThrow({where:{id:at.refundId}});return {afterSaleId:a.id,status:sale.status,version:sale.version,refundId:r.id,refundNo:r.refundNo,refundVersion:r.version,refundStatus:r.status,amountCents:r.amountCents,attemptId:at.id,attemptNo:at.attemptNo,attemptOutcome:at.outcome,failureCode:at.failureCode,publicExplanation:at.publicExplanation,retryAllowed:at.outcome==='FAILED'&&r.status==='FAILED',replayed};}
 private async retryQualification(s:TaskTransactionScope,t:Task,key:string){const required=[...new Set([...(Array.isArray(t.requiredPermissions)?t.requiredPermissions.filter((x):x is string=>typeof x==='string'):[]),'after-sale.refund.retry'])],eligible=s.actor.subjectType==='EMPLOYEE'&&isTaskEligible(s.actor,{...t,requiredPermissions:required});await s.tx.task.update({where:{id:t.id},data:{requiredPermissions:required,version:{increment:1},...(!eligible?{status:'OPEN',assigneeId:null,reassignNeeded:true}:{}),updatedAt:this.k.clock.now()}});if(!eligible){const actor=salePermission(s.actor,'after-sale.refund.execute');await s.tx.taskHistory.create({data:{taskId:t.id,action:'QUALIFICATION_LOST',actorType:'EMPLOYEE',actorEmployeeId:actor.subjectId,fromAssigneeId:t.assigneeId,toAssigneeId:null,beforeStatus:t.status,afterStatus:'OPEN',commandKey:'refund-failed:'+key,reason:'失败重试新增资格，原经办不满足，原轮原截止回池',requestId:s.requestId,createdAt:this.k.clock.now()}});await this.audit.appendAudit(s.tx,{actor:{type:'EMPLOYEE',id:actor.subjectId},action:'task.qualification.lost',targetId:t.id,requestId:s.requestId,reason:'失败重试需要额外资格',after:{taskStatus:'OPEN',assigneeId:null,round:t.round,taskVersion:t.version+1,reassignNeeded:true}});}}
 private async settleDamage(s:TaskTransactionScope,orderId:string,key:string){const items=await s.tx.stockIncidentItem.findMany({where:{orderItem:{orderId},verificationState:{not:'SETTLED'}}});for(const i of items){await s.tx.stockIncidentItem.update({where:{id:i.id},data:{verificationState:'SETTLED',version:{increment:1}}});await s.tx.stockIncidentHistory.create({data:{incidentId:i.incidentId,incidentItemId:i.id,action:'SETTLE',actorType:'EMPLOYEE',actorId:salePermission(s.actor,'after-sale.refund.execute').subjectId,reason:'退款成功结算备货归属，不重复扣库存',commandKey:key,requestId:s.requestId,after:{refunded:true}}});}}
 private async finishTasks(s:TaskTransactionScope,c:TaskEntryContext,a:AfterSale,key:string){
  // 退款成功使本售后的待决定争议失去前提；先结束其真实来源，再结束剩余阶段。
  const requests=await s.tx.disputeRequest.findMany({where:{afterSaleId:a.id},select:{id:true}});
  const sources=await s.tx.taskBusinessSource.findMany({where:{sourceType:'DISPUTE_REQUEST',sourceId:{in:requests.map(r=>r.id)},status:'ACTIVE'},orderBy:{id:'asc'}});
  for(const source of sources){const task=await s.tx.task.findFirstOrThrow({where:{id:source.taskId,...saleRef(a.id)}});await this.k.sources.cancel(c,{...saleRef(a.id),taskId:task.id,expectedVersion:task.version,sourceType:'DISPUTE_REQUEST',sourceId:source.sourceId,commandKey:'refund-dispute:'+key,reason:'全额模拟退款已成功，本售后争议提请结束并保留历史'});}
  await s.tx.disputeRequest.updateMany({where:{afterSaleId:a.id,status:'OPEN'},data:{status:'WITHDRAWN'}});
  const tasks=await s.tx.task.findMany({where:{OR:[{...saleRef(a.id),...activeTasks},{...orderRef(a.orderId),stage:'SHIPMENT_PROCESS',...activeTasks}]},orderBy:{id:'asc'}});for(const t of tasks)await this.k.transition(c,t,'refund-end:'+key,'交易已退款，结束剩余履约和售后阶段','CANCELLED');
 }
}
