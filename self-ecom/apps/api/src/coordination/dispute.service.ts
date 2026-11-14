// 作用：管理员结案复用真实售后终结事务；实物、待办和其它阻塞各自保留。
import {Inject,Injectable} from '@nestjs/common';
import type {AfterSale,Order,Prisma} from '@prisma/client';
import {AfterSaleService} from '../after-sales/after-sale.service.js';
import {AfterSaleCloseFacts} from '../after-sales/after-sale-close-facts.js';
import {salePermission,ownedSale} from '../after-sales/after-sale.access.js';
import {orderRef,saleRef} from '../after-sales/after-sale.rules.js';
import {pendingHandover} from '../orders/fulfillment.rules.js';
import {TaskEntryService,type TaskTransactionScope} from '../tasks/task-entry.service.js';
import {TaskSourceService} from '../tasks/task-source.service.js';
import {taskAuditActor} from '../tasks/task-lifecycle.service.js';
import {AuditService} from '../audit/audit.service.js';
import {FileBindingService} from '../files/file-binding.service.js';
import {Clock} from '../common/time/clock.js';
import {PrismaService} from '../prisma/prisma.service.js';
import type {CustomerContext} from '../customers/customer-access.service.js';
import {CurrentIdentityService} from '../auth/current-identity.service.js';
import {TokenValidationError} from '../auth/jwt-token.service.js';
import {OfflineCaseService} from './offline-case.service.js';
import {DisputeError,custodyRef} from './dispute.rules.js';
import type {CloseDecisionDto,CustodyItemDto,DisputeCommandDto,DisputeRequestDto} from './dispute.dto.js';
const active={status:{in:['OPEN','CLAIMED','SUSPENDED'] as ('OPEN'|'CLAIMED'|'SUSPENDED')[]}};
const access=(ctx:CustomerContext)=>({type:ctx.actor.subjectType,subjectId:ctx.actor.subjectId,token:ctx.token});
@Injectable()
export class DisputeService{
 constructor(@Inject(AfterSaleService)private readonly sales:AfterSaleService,@Inject(AfterSaleCloseFacts)private readonly facts:AfterSaleCloseFacts,
 @Inject(TaskEntryService)private readonly entry:TaskEntryService,@Inject(TaskSourceService)private readonly sources:TaskSourceService,
 @Inject(AuditService)private readonly audit:AuditService,@Inject(FileBindingService)private readonly files:FileBindingService,@Inject(Clock)private readonly clock:Clock,
 @Inject(PrismaService)private readonly db:PrismaService,@Inject(CurrentIdentityService)private readonly identities:CurrentIdentityService,@Inject(OfflineCaseService)private readonly offline:OfflineCaseService){}
 followup(ctx:CustomerContext,id:string,b:DisputeCommandDto){return this.sales.command(ctx,id,'dispute-followup',b,'after-sale.return.follow',async(s,c,a)=>{
  const o=await s.tx.order.findUniqueOrThrow({where:{id:a.orderId}});if(o.version!==b.expectedOrderVersion)throw new DisputeError('VERSION_CONFLICT');
  if(!['WAIT_RETURN','WAIT_RECEIPT','WAIT_INSPECTION','INSPECTION_EXCEPTION','FINAL_INSPECTION','WAIT_FULFILLMENT_CHECK','WAIT_REFUND','REFUND_FAILED'].includes(a.status))throw new DisputeError('AFTER_SALE_CLOSE_FORBIDDEN');
  const existing=await s.tx.task.findFirst({where:{...saleRef(id),stage:{in:['RETURN_FOLLOW','INSPECTION_EXCEPTION_CONTACT']},...active}});
  const t=existing??await this.sales.enter(c,id,'INSPECTION_EXCEPTION_CONTACT','dispute-followup:'+b.commandKey,'争议提请前客服跟进，须显式领取');
  await this.auditEvent(s,a,'dispute.followup','OPEN',t.id);return {taskId:t.id};
 });}
 request(ctx:CustomerContext,id:string,b:DisputeRequestDto){return this.sales.command(ctx,id,'dispute-request',b,'after-sale.return.follow',async(s,c,a)=>{
  const o=await s.tx.order.findUniqueOrThrow({where:{id:a.orderId}});this.versions(o,a,b);
  const t=await s.tx.task.findFirst({where:{...saleRef(id),stage:{in:['SUPPLEMENT_FOLLOW','RETURN_FOLLOW','INSPECTION_EXCEPTION_CONTACT']},...active}});
  if(!t)throw new DisputeError('TASK_NOT_ASSIGNEE');await this.sales.task(s,a,t.stage,b.expectedTaskVersion);
  if(!await s.tx.communication.count({where:{id:b.communicationId,scopeType:'AFTER_SALE',scopeId:id}}))throw new DisputeError('COMMUNICATION_REQUIRED');
  const previous=await s.tx.disputeRequest.findFirst({where:{afterSaleId:id,kind:b.kind,status:'OPEN'}});if(previous){if(previous.basedAfterSaleVersion===a.version&&previous.basedOrderPhysicalVersion===o.stockPhysicalVersion&&previous.basedReturnPhysicalVersion===a.returnPhysicalVersion)throw new DisputeError('DISPUTE_ALREADY_OPEN');await s.tx.disputeRequest.update({where:{id:previous.id},data:{status:'WITHDRAWN'}});const source=await s.tx.taskBusinessSource.findFirst({where:{sourceType:'DISPUTE_REQUEST',sourceId:previous.id,status:'ACTIVE'}});if(source){const task=await s.tx.task.findUniqueOrThrow({where:{id:source.taskId}});await this.sources.cancel(c,{...saleRef(id),taskId:task.id,expectedVersion:task.version,sourceType:'DISPUTE_REQUEST',sourceId:previous.id,commandKey:'superseded:'+b.commandKey,reason:'当前事实已变化，保留旧提请，重新核实后提交新请求'});}}
  const r=await s.tx.disputeRequest.create({data:{afterSaleId:id,kind:b.kind,basedAfterSaleVersion:a.version,basedOrderPhysicalVersion:o.stockPhysicalVersion,basedReturnPhysicalVersion:a.returnPhysicalVersion,communicationId:b.communicationId,proposal:b.proposal,publicExplanation:b.publicExplanation,createdById:salePermission(s.actor,'after-sale.return.follow').subjectId,createdAt:this.clock.now()}});
  const admin=await this.sources.attach(c,{...saleRef(id),stage:'ADMIN_DISPUTE',sourceType:'DISPUTE_REQUEST',sourceId:r.id,entryKey:'dispute:'+r.id,reason:'客服已提请受限争议决定，管理员须显式领取'});
  await this.auditEvent(s,a,'dispute.request','OPEN',r.id);return {disputeRequestId:r.id,taskId:admin.task.id};
 });}
 close(ctx:CustomerContext,id:string,b:CloseDecisionDto){return this.sales.command(ctx,id,'close-decision',b,'after-sale.dispute.decide',async(s,c,a)=>{
  const actor=salePermission(s.actor,'after-sale.dispute.decide');if(actor.role!=='SUPER_ADMIN')throw new DisputeError('AFTER_SALE_CLOSE_FORBIDDEN');
  const o=await s.tx.order.findUniqueOrThrow({where:{id:a.orderId}});this.versions(o,a,b);const r=await s.tx.disputeRequest.findFirst({where:{id:b.disputeRequestId,afterSaleId:id,status:'OPEN'}});if(!r)throw new DisputeError('DISPUTE_NOT_OPEN');
  if(r.basedAfterSaleVersion!==a.version||r.basedOrderPhysicalVersion!==o.stockPhysicalVersion||r.basedReturnPhysicalVersion!==a.returnPhysicalVersion)throw new DisputeError('CUSTODY_FACT_STALE');
  await this.sales.task(s,a,'ADMIN_DISPUTE',b.expectedTaskVersion);
  const f=await this.facts.read(s.tx,id);if(f.finalInspection||f.restocked||f.refundAttempt||a.finalInspectionId||['REFUNDING','REFUND_FAILED','SUCCEEDED'].includes(a.status))throw new DisputeError('AFTER_SALE_CLOSE_FORBIDDEN');
  if(await pendingHandover(s.tx,a.orderId))throw new DisputeError('HANDOVER_VERIFICATION_REQUIRED');
  if(b.decision==='STOP_UNSHIPPED_REFUND'){
   if(o.actualHandoverAt||a.type!=='REFUND_ONLY'||!['WAIT_FULFILLMENT_CHECK','WAIT_REFUND'].includes(a.status)||r.kind!=='STOP_UNSHIPPED_REFUND')throw new DisputeError('AFTER_SALE_CLOSE_FORBIDDEN');
   if(a.status==='WAIT_REFUND'){const check=b.physicalCheckId?await s.tx.unshippedPhysicalCheck.findFirst({where:{id:b.physicalCheckId,afterSaleId:id,orderId:o.id,status:'VALID',physicalVersion:o.stockPhysicalVersion}}):null;if(!check||a.activeUnshippedCheckId!==check.id)throw new DisputeError('CUSTODY_FACT_STALE');}
  }else if(a.type!=='RETURN_REFUND'||!['WAIT_RETURN','WAIT_RECEIPT','WAIT_INSPECTION','INSPECTION_EXCEPTION','FINAL_INSPECTION'].includes(a.status))throw new DisputeError('AFTER_SALE_CLOSE_FORBIDDEN');
  const approval=await s.tx.exceptionRefundApproval.findFirst({where:{afterSaleId:id,invalidatedAt:null}});if((approval?.id??null)!==(b.approvalId??null))throw new DisputeError('CUSTODY_FACT_STALE');
  await this.validatePlans(s.tx,a,b.custodyItems);
  const now=this.clock.now(),d=await s.tx.disputeDecision.create({data:{requestId:r.id,afterSaleId:id,decision:b.decision,fromStatus:a.status,reason:b.reason,publicExplanation:b.publicExplanation,evidenceSummary:b.evidenceSummary,decidedById:actor.subjectId,decidedAt:now,checkedPhysicalVersion:o.stockPhysicalVersion,checkedReturnPhysicalVersion:a.returnPhysicalVersion,relatedCheckId:b.physicalCheckId,approvalId:b.approvalId,commandKey:b.commandKey,requestIdTrace:s.requestId}});
  if(b.evidenceFileIds.length)await this.files.bindFiles(s.tx,{identity:actor,token:ctx.token},{ownerType:'DISPUTE_DECISION',ownerId:d.id,slot:'evidence',audience:'INTERNAL',fileIds:b.evidenceFileIds,commandKey:b.commandKey});
  const follow=b.custodyItems.some(i=>i.disposition!=='NO_GOODS')?await this.offline.createInContext(s,{orderId:o.id,afterSaleId:id,disputeDecisionId:d.id,type:'CUSTODY_FOLLOW',subject:'争议结束后的物品保管与寄还跟进',description:b.evidenceSummary,publicSummary:b.publicExplanation,commandKey:b.commandKey,reason:'售后受限结束，实物义务继续跟进'},access(ctx)):null;
  for(const p of b.custodyItems){const arrangement=await s.tx.custodyArrangement.create({data:{disputeDecisionId:d.id,afterSaleId:id,...p,nextFollowAt:p.nextFollowAt?new Date(p.nextFollowAt):null,status:p.disposition==='NO_GOODS'?'COMPLETED':'PLANNED',followOfflineCaseId:follow?.id,createdAt:now}});if(arrangement.status!=='COMPLETED')await this.entry.withContext(s.tx,access(ctx),[orderRef(o.id),saleRef(id),custodyRef(arrangement.id)],s.requestId,cc=>this.entry.enterStage(cc,{...custodyRef(arrangement.id),stage:'CUSTODY_EXECUTE',entryKey:'plan:'+arrangement.id,reason:'售后结案不终止保管、寄还和到仓核实义务'}));}
  await s.tx.afterSaleDecision.create({data:{afterSaleId:id,kind:'CLOSE',fromStatus:a.status,toStatus:'CLOSED',basedMaterialVersionId:a.currentMaterialVersionId!,actorEmployeeId:actor.subjectId,publicExplanation:b.publicExplanation,reason:b.reason,communicationId:r.communicationId,disputeDecisionId:d.id,requestId:s.requestId,createdAt:now}});
  if(approval)await s.tx.exceptionRefundApproval.update({where:{id:approval.id},data:{invalidatedAt:now,invalidationReason:'管理员在最终验收前受限结案，批准历史保留'}});
  await s.tx.unshippedPhysicalCheck.updateMany({where:{afterSaleId:id,status:'VALID'},data:{status:'INVALIDATED',invalidatedAt:now,invalidationReason:'管理员停止本售后退款路线'}});
  await s.tx.afterSale.update({where:{id},data:{activeUnshippedCheckId:null}});
  await s.tx.disputeRequest.update({where:{id:r.id},data:{status:'DECIDED'}});await s.tx.disputeRequest.updateMany({where:{afterSaleId:id,status:'OPEN'},data:{status:'WITHDRAWN'}});
  const sourceRows=await s.tx.taskBusinessSource.findMany({where:{sourceType:'DISPUTE_REQUEST',sourceId:{in:(await s.tx.disputeRequest.findMany({where:{afterSaleId:id},select:{id:true}})).map(x=>x.id)},status:'ACTIVE'}});
  for(const source of sourceRows){const t=await s.tx.task.findUniqueOrThrow({where:{id:source.taskId}});await this.sources.cancel(c,{...saleRef(id),taskId:t.id,expectedVersion:t.version,sourceType:'DISPUTE_REQUEST',sourceId:source.sourceId,commandKey:'closed:'+b.commandKey,reason:'本售后已受限结案，争议来源结束'});}
  await this.sales.terminate(s,c,a,'CLOSED',b.commandKey,b.publicExplanation);await this.auditEvent(s,a,'dispute.close','DECIDED',d.id);return {disputeDecisionId:d.id,...(follow?{offlineCaseId:follow.id}:{})};
 });}
 private versions(o:Order,a:AfterSale,b:{expectedOrderVersion:number;expectedPhysicalVersion:number;expectedReturnPhysicalVersion:number}){if(o.version!==b.expectedOrderVersion)throw new DisputeError('VERSION_CONFLICT');if(o.stockPhysicalVersion!==b.expectedPhysicalVersion||a.returnPhysicalVersion!==b.expectedReturnPhysicalVersion)throw new DisputeError('CUSTODY_FACT_STALE');}
 private async validatePlans(tx:Prisma.TransactionClient,a:AfterSale,plans:CustodyItemDto[]){
  if(!plans.length)throw new DisputeError('CUSTODY_PLAN_INCOMPLETE');
  const receipts=await tx.returnReceipt.findMany({where:{afterSaleId:a.id},orderBy:{id:'asc'}});for(const r of receipts)await tx.$queryRaw`SELECT id FROM return_receipt WHERE id=${r.id}::uuid FOR UPDATE`;
  const expected=new Map<string,number>(),unmatchedReceipt=new Map<string,string>();for(const r of receipts){const rev=r.currentInspectionRevisionId?await tx.returnInspectionRevision.findUnique({where:{id:r.currentInspectionRevisionId}}):null;if(!rev||!rev.inspectionComplete||rev.basedReceiptPhysicalVersion!==r.physicalVersion)throw new DisputeError('CUSTODY_FACT_STALE');const lines=await tx.returnInspectionLine.findMany({where:{revisionId:rev.id}}),unmatched=await tx.returnUnmatchedItem.findMany({where:{revisionId:rev.id}});for(const l of lines)if(l.matchedReceivedQty)expected.set(r.id+':'+l.orderItemId,l.matchedReceivedQty);for(const u of unmatched){expected.set('unmatched:'+u.id,u.quantity);unmatchedReceipt.set(u.id,r.id);}if(!lines.some(l=>l.matchedReceivedQty)&&!unmatched.length)expected.set('empty:'+r.id,0);}
  const actual=new Map<string,number>();for(const p of plans){if(p.unmatchedItemId&&p.returnReceiptId&&unmatchedReceipt.get(p.unmatchedItemId)!==p.returnReceiptId)throw new DisputeError('CUSTODY_PLAN_INCOMPLETE');if(p.orderItemId&&p.unmatchedItemId)throw new DisputeError('CUSTODY_PLAN_INCOMPLETE');if(p.orderItemId&&!await tx.orderItem.count({where:{id:p.orderItemId,orderId:a.orderId}}))throw new DisputeError('CUSTODY_PLAN_INCOMPLETE');if(p.custodianEmployeeId&&!await tx.employee.count({where:{id:p.custodianEmployeeId,status:'ACTIVE'}}))throw new DisputeError('CUSTODY_PLAN_INCOMPLETE');if(['KEEP_IN_CUSTODY','RETURN_TO_CUSTOMER'].includes(p.disposition)&&(!p.custodianEmployeeId||!p.location||p.quantity<=0))throw new DisputeError('CUSTODY_PLAN_INCOMPLETE');if(p.disposition==='NO_GOODS'&&p.quantity!==0)throw new DisputeError('CUSTODY_PLAN_INCOMPLETE');if(p.nextFollowAt&&+new Date(p.nextFollowAt)<+this.clock.now())throw new DisputeError('VALIDATION_FAILED');const k=p.unmatchedItemId?'unmatched:'+p.unmatchedItemId:p.returnReceiptId?(p.orderItemId?p.returnReceiptId+':'+p.orderItemId:'empty:'+p.returnReceiptId):null;if(k){if(!expected.has(k)||p.disposition==='IN_TRANSIT_UNRECEIVED'||p.disposition==='NO_GOODS'&&expected.get(k)!==0)throw new DisputeError('CUSTODY_PLAN_INCOMPLETE');actual.set(k,(actual.get(k)??0)+p.quantity);}else if(p.quantity!==0||p.disposition==='KEEP_IN_CUSTODY'||p.disposition==='RETURN_TO_CUSTOMER')throw new DisputeError('CUSTODY_PLAN_INCOMPLETE');}
  for(const [key,qty]of expected)if(!actual.has(key)||actual.get(key)!==qty)throw new DisputeError('CUSTODY_PLAN_INCOMPLETE');
  const unreceived=await tx.returnParcel.findMany({where:{afterSaleId:a.id,id:{notIn:receipts.map(r=>r.parcelId)}},select:{id:true}}),transit=await tx.returnLogisticsRevision.count({where:{parcelId:{in:unreceived.map(p=>p.id)},dispatchDeclaration:'DECLARED_SENT'}})>0||await tx.returnDispatchVerification.count({where:{afterSaleId:a.id,outcome:'IN_TRANSIT',...(receipts.length?{parcelId:{notIn:receipts.map(r=>r.parcelId)}}:{})}})>0;
  if(plans.some(p=>p.disposition==='NO_GOODS'&&!p.returnReceiptId)&&(receipts.length||transit))throw new DisputeError('CUSTODY_PLAN_INCOMPLETE');if(transit&&!plans.some(p=>p.disposition==='IN_TRANSIT_UNRECEIVED'&&!p.returnReceiptId&&!p.unmatchedItemId&&!p.orderItemId))throw new DisputeError('CUSTODY_PLAN_INCOMPLETE');if(!transit&&plans.some(p=>p.disposition==='IN_TRANSIT_UNRECEIVED')||!transit&&!receipts.length&&!plans.some(p=>p.disposition==='NO_GOODS'))throw new DisputeError('CUSTODY_PLAN_INCOMPLETE');
 }
 private auditEvent(s:TaskTransactionScope,a:AfterSale,action:string,status:string,id:string){return this.audit.appendAudit(s.tx,{actor:taskAuditActor(s.actor),action:'coordination.change',targetId:id,requestId:s.requestId,reason:action,after:{orderId:a.orderId,businessId:id,businessType:'AFTER_SALE',coordinationAction:action,coordinationStatus:status,coordinationVersion:a.version}});}
 async detail(ctx:CustomerContext,id:string){return this.db.$transaction(async tx=>{const actor=await this.identities.authenticate(tx,ctx.token,'EMPLOYEE');if(actor.subjectId!==ctx.actor.subjectId||actor.sessionId!==ctx.actor.sessionId)throw new TokenValidationError('TOKEN_INVALID');await ownedSale(tx,id,actor);salePermission(actor,'after-sale.service.read');const requests=await tx.disputeRequest.findMany({where:{afterSaleId:id},orderBy:[{createdAt:'desc'},{id:'asc'}]}),decisions=await tx.disputeDecision.findMany({where:{afterSaleId:id},orderBy:[{decidedAt:'desc'},{id:'asc'}]}),arrangements=await tx.custodyArrangement.findMany({where:{afterSaleId:id},orderBy:[{createdAt:'desc'},{id:'asc'}]});return {requests,decisions,arrangements};},{isolationLevel:'RepeatableRead'});}
}
