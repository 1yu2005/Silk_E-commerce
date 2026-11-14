import {Inject,Injectable} from '@nestjs/common';
import type {AfterSale,Prisma,Task,TaskStage} from '@prisma/client';
import {TaskEntryService,type TaskEntryContext,type TaskTransactionScope} from '../tasks/task-entry.service.js';
import {TaskLifecycleService} from '../tasks/task-lifecycle.service.js';
import {TaskSourceService} from '../tasks/task-source.service.js';
import {isTaskEligible} from '../tasks/task-access.service.js';
import {FileBindingService} from '../files/file-binding.service.js';
import type {CustomerContext} from '../customers/customer-access.service.js';
import {Clock} from '../common/time/clock.js';
import {calculateDeadline} from '../common/time/deadline.js';
import {AuditService} from '../audit/audit.service.js';
import {TaskDeadlineEventsService} from '../tasks/task-deadline-events.service.js';
import {lockedContextTask,taskAuditActor} from '../tasks/task-lifecycle.service.js';
import {AfterSaleService} from './after-sale.service.js';
import {orderRef,saleRef} from './after-sale.rules.js';
import {activeTasks,SettlementError,sameIds} from './settlement.rules.js';
@Injectable()
export class SettlementSupport{
 constructor(@Inject(AfterSaleService)readonly sales:AfterSaleService,@Inject(TaskEntryService)readonly entry:TaskEntryService,@Inject(TaskLifecycleService)readonly lifecycle:TaskLifecycleService,@Inject(TaskSourceService)readonly sources:TaskSourceService,@Inject(FileBindingService)readonly files:FileBindingService,@Inject(Clock)readonly clock:Clock,@Inject(AuditService)private readonly audit:AuditService,@Inject(TaskDeadlineEventsService)private readonly deadlines:TaskDeadlineEventsService){}
 async task(s:TaskTransactionScope,id:string,stage:TaskStage,version:number,order=false){const t=await s.tx.task.findFirst({where:{...(order?orderRef(id):saleRef(id)),stage,...activeTasks}});if(s.actor.subjectType!=='EMPLOYEE'||!t||t.status!=='CLAIMED'||t.assigneeId!==s.actor.subjectId||!isTaskEligible(s.actor,t))throw new SettlementError('TASK_NOT_ASSIGNEE');if(t.version!==version)throw new SettlementError('VERSION_CONFLICT');return t;}
 async transition(c:TaskEntryContext,t:Task,key:string,reason:string,action:'COMPLETED'|'CANCELLED'|'SUSPENDED'|'RESUMED'='COMPLETED'){return this.lifecycle.transition(c,{businessType:t.businessType,businessId:t.businessId,taskId:t.id,expectedVersion:t.version,action,commandKey:key,reason});}
 async cancelStage(c:TaskEntryContext,tx:Prisma.TransactionClient,id:string,stage:TaskStage,key:string,reason:string){let t=await tx.task.findFirst({where:{...saleRef(id),stage,...activeTasks}});if(!t)return;for(const source of await tx.taskBusinessSource.findMany({where:{taskId:t.id,status:'ACTIVE'}})){await this.sources.cancel(c,{...saleRef(id),taskId:t.id,expectedVersion:t.version,sourceType:'RETURN_PARCEL',sourceId:source.sourceId,commandKey:key,reason});t=await tx.task.findUniqueOrThrow({where:{id:t.id}});}if(['OPEN','CLAIMED','SUSPENDED'].includes(t.status))await this.transition(c,t,key,reason,'CANCELLED');}
 async bind(s:TaskTransactionScope,ctx:CustomerContext,ownerType:'RETURN_RECEIPT'|'RETURN_INSPECTION'|'FULFILLMENT_CHECK',ownerId:string,ids:string[],key:string){if(!ids.length)return;if(s.actor.subjectType==='SYSTEM')throw new SettlementError('VALIDATION_FAILED');await this.files.bindFiles(s.tx,{identity:s.actor,token:ctx.token},{ownerType,ownerId,slot:'evidence',audience:'INTERNAL',fileIds:ids,commandKey:key});}
 async aggregate(tx:Prisma.TransactionClient,a:AfterSale,refs?:string[]){const items=await tx.orderItem.findMany({where:{orderId:a.orderId},orderBy:{id:'asc'}}),receipts=await tx.returnReceipt.findMany({where:{afterSaleId:a.id},orderBy:{id:'asc'}});const revisions=await tx.returnInspectionRevision.findMany({where:{id:{in:receipts.flatMap(r=>r.currentInspectionRevisionId?[r.currentInspectionRevisionId]:[])}}});if(refs&&!sameIds(refs,revisions.map(r=>r.id)))throw new SettlementError('VERSION_CONFLICT');const lines=await tx.returnInspectionLine.findMany({where:{revisionId:{in:revisions.map(r=>r.id)}}});const totals=items.map(i=>{const ls=lines.filter(l=>l.orderItemId===i.id);const received=ls.reduce((n,l)=>n+l.matchedReceivedQty,0),sellable=ls.reduce((n,l)=>n+l.sellableQty,0),unsellable=ls.reduce((n,l)=>n+l.unsellableQty,0);if(received>i.quantity)throw new SettlementError('INSPECTION_QUANTITY_MISMATCH');return {item:i,purchased:i.quantity,received,sellable,unsellable,missing:i.quantity-received};});const complete=receipts.length>0&&receipts.every(r=>{const v=revisions.find(v=>v.id===r.currentInspectionRevisionId);return !!v&&v.inspectionComplete&&v.basedReceiptPhysicalVersion===r.physicalVersion;})&&totals.every(l=>l.sellable+l.unsellable===l.received);return {receipts,revisions,totals,complete};}
 async returnChanged(s:TaskTransactionScope,c:TaskEntryContext,a:AfterSale,key:string,reason:string){const approval=await s.tx.exceptionRefundApproval.findFirst({where:{afterSaleId:a.id,invalidatedAt:null}});if(approval){await s.tx.exceptionRefundApproval.update({where:{id:approval.id},data:{invalidatedAt:this.clock.now(),invalidationReason:reason}});if(a.status==='FINAL_INSPECTION'){await this.sales.update(s.tx,a,{status:'INSPECTION_EXCEPTION',returnPhysicalVersion:{increment:1}});await this.cancelStage(c,s.tx,a.id,'RETURN_INSPECT','invalidate:'+key,reason);await this.sales.enter(c,a.id,'INSPECTION_EXCEPTION_CONTACT','invalidate:'+key,reason);return;}}await s.tx.afterSale.update({where:{id:a.id},data:{returnPhysicalVersion:{increment:1}}});}
 async inspectionTask(c:TaskEntryContext,tx:Prisma.TransactionClient,id:string,key:string){
  const active=await tx.task.findFirst({where:{...saleRef(id),stage:'RETURN_INSPECT',...activeTasks}});
  if(!active){await this.sales.enter(c,id,'RETURN_INSPECT',key,'实际到仓后开始本轮验收，须重新领取');return;}
  if(!key.startsWith('received:'))return;
  await this.entry.inContext(c,saleRef(id),async scope=>{
   const task=await lockedContextTask(scope,saleRef(id),active.id),receipt=await tx.returnReceipt.findFirstOrThrow({where:{id:key.slice(9),afterSaleId:id}});
   const snapshot=task.ruleSnapshot as {startBasis?:string;unit?:string;amount?:number};
   if(snapshot.startBasis!=='ACTUAL_RECEIPT'||receipt.receivedAt>=task.startedAt)return;
   if(snapshot.unit!=='WORKDAY'||!Number.isInteger(snapshot.amount)||!task.originalDueAt||!task.dueAt)throw new SettlementError('REFUND_PRECONDITION_FAILED');
   // 同轮补录更早实收只提前基准；沿用本轮设置快照，并保留管理员已给予的延期时长。
   const originalDueAt=calculateDeadline(receipt.receivedAt,{unit:'WORKDAY',amount:snapshot.amount!}),dueAt=new Date(+originalDueAt+(+task.dueAt-+task.originalDueAt)),now=this.clock.now(),actor=await scope.revalidate();
   await this.deadlines.recordOverdue(tx,task,taskAuditActor(actor),scope.requestId,now);
   const corrected=await tx.task.update({where:{id:task.id},data:{startedAt:receipt.receivedAt,originalDueAt,dueAt,version:{increment:1},updatedAt:now}});
   const reason='同轮补录更早真实收包，沿原规则提前验收起算及截止';
   await tx.taskHistory.create({data:{taskId:task.id,action:'DEADLINE_CHANGED',actorType:actor.subjectType==='EMPLOYEE'?'EMPLOYEE':'SYSTEM',actorEmployeeId:actor.subjectType==='EMPLOYEE'?actor.subjectId:null,beforeStatus:task.status,afterStatus:task.status,reason,commandKey:key,requestId:scope.requestId,createdAt:now}});
   await this.audit.appendAudit(tx,{actor:taskAuditActor(actor),action:'task.receipt-start.correct',targetId:task.id,requestId:scope.requestId,reason,before:{startedAt:task.startedAt.toISOString(),dueAt:task.dueAt.toISOString()},after:{startedAt:corrected.startedAt.toISOString(),dueAt:dueAt.toISOString()}});
   await this.deadlines.recordOverdue(tx,corrected,taskAuditActor(actor),scope.requestId,now);
  });
 }
}
