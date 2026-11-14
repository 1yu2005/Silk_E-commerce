// 作用：仓储实际执行保管/寄还义务，仅追加实物事件，不写库存或原运单。
import {Inject,Injectable} from '@nestjs/common';
import {commandFingerprint} from '../common/command-fingerprint.js';
import {PrismaService} from '../prisma/prisma.service.js';
import {AfterSaleService} from '../after-sales/after-sale.service.js';
import {salePermission} from '../after-sales/after-sale.access.js';
import {orderRef,saleRef} from '../after-sales/after-sale.rules.js';
import {TaskEntryService} from '../tasks/task-entry.service.js';
import {TaskLifecycleService,taskAuditActor} from '../tasks/task-lifecycle.service.js';
import {isTaskEligible} from '../tasks/task-access.service.js';
import {Clock} from '../common/time/clock.js';
import {AuditService} from '../audit/audit.service.js';
import {FileBindingService} from '../files/file-binding.service.js';
import type {CustomerContext} from '../customers/customer-access.service.js';
import {CurrentIdentityService} from '../auth/current-identity.service.js';
import {TokenValidationError} from '../auth/jwt-token.service.js';
import {custodyRef,DisputeError} from './dispute.rules.js';
import type {CustodyCorrectionFollowupDto,CustodyEventDto} from './dispute.dto.js';
const access=(ctx:CustomerContext)=>({type:ctx.actor.subjectType,subjectId:ctx.actor.subjectId,token:ctx.token});
@Injectable()
export class CustodyService{
 constructor(@Inject(PrismaService)private readonly db:PrismaService,@Inject(AfterSaleService)private readonly sales:AfterSaleService,@Inject(TaskEntryService)private readonly entry:TaskEntryService,
 @Inject(TaskLifecycleService)private readonly lifecycle:TaskLifecycleService,@Inject(Clock)private readonly clock:Clock,@Inject(AuditService)private readonly audit:AuditService,
 @Inject(FileBindingService)private readonly files:FileBindingService,@Inject(CurrentIdentityService)private readonly identities:CurrentIdentityService){}
 async detail(ctx:CustomerContext,id:string){return this.db.$transaction(async tx=>{const current=await this.identities.authenticate(tx,ctx.token,'EMPLOYEE');if(current.subjectId!==ctx.actor.subjectId||current.sessionId!==ctx.actor.sessionId)throw new TokenValidationError('TOKEN_INVALID');const actor=salePermission(current,'after-sale.inspection.read');const r=await tx.custodyArrangement.findUnique({where:{id}});if(!r)throw new DisputeError('DISPUTE_NOT_FOUND');const sale=await tx.afterSale.findUniqueOrThrow({where:{id:r.afterSaleId}}),events=await tx.custodyEvent.findMany({where:{arrangementId:id},orderBy:[{createdAt:'desc'},{id:'asc'}]}),tasks=await tx.task.findMany({where:{...custodyRef(id)},orderBy:[{round:'desc'},{id:'asc'}]}),refs=await tx.fileReference.findMany({where:{ownerType:'CUSTODY_EVENT',ownerId:{in:events.map(e=>e.id)}},select:{ownerId:true,fileAssetId:true}});return {...r,orderId:sale.orderId,events:events.map(e=>({...e,evidenceFileIds:refs.filter(ref=>ref.ownerId===e.id).map(ref=>ref.fileAssetId)})),tasks:tasks.map(t=>({id:t.id,stage:t.stage,round:t.round,status:t.status,version:t.version,assigneeId:t.assigneeId,dueAt:t.dueAt,canClaim:t.status==='OPEN'&&isTaskEligible(actor,t)}))};},{isolationLevel:'RepeatableRead'});}
 correctionFollowup(ctx:CustomerContext,id:string,b:CustodyCorrectionFollowupDto){
  const fp=commandFingerprint({command:'custody.correction-followup',version:1,actor:{type:ctx.actor.subjectType,id:ctx.actor.subjectId},payload:{arrangementId:id,body:b}});
  return this.sales.run(async tx=>{const loc=await tx.custodyArrangement.findUnique({where:{id}});if(!loc)throw new DisputeError('DISPUTE_NOT_FOUND');const sale=await tx.afterSale.findUniqueOrThrow({where:{id:loc.afterSaleId}});return this.entry.withContext(tx,access(ctx),[orderRef(sale.orderId),saleRef(sale.id),custodyRef(id)],ctx.requestId,c=>this.entry.inContext(c,custodyRef(id),async s=>{
   const actor=salePermission(s.actor,'after-sale.inspection.confirm'),prior=await tx.coordinationCommandResult.findUnique({where:{orderId_action_commandKey:{orderId:sale.orderId,action:'custody.correction-followup',commandKey:b.commandKey}}});if(prior){if(prior.fingerprint!==fp)throw new DisputeError('COMMAND_PAYLOAD_CONFLICT');return {arrangementId:id,taskId:prior.resultId,replayed:true};}
   const a=await tx.custodyArrangement.findUniqueOrThrow({where:{id}});if(a.version!==b.expectedArrangementVersion)throw new DisputeError('VERSION_CONFLICT');if(a.status!=='COMPLETED'||a.disposition==='NO_GOODS')throw new DisputeError('CUSTODY_EVENT_NOT_ALLOWED');
   const existing=await tx.task.findFirst({where:{...custodyRef(id),stage:'CUSTODY_EXECUTE',status:{in:['OPEN','CLAIMED']}}}),task=existing??(await this.entry.enterStage(c,{...custodyRef(id),stage:'CUSTODY_EXECUTE',entryKey:'correction:'+b.commandKey,reason:b.reason})).task;
   await this.audit.appendAudit(tx,{actor:taskAuditActor(actor),action:'coordination.change',targetId:task.id,requestId:s.requestId,reason:b.reason,after:{orderId:sale.orderId,businessId:id,businessType:'CUSTODY_ARRANGEMENT',coordinationAction:'custody.correction-followup',coordinationStatus:a.status,coordinationVersion:a.version}});await tx.coordinationCommandResult.create({data:{orderId:sale.orderId,action:'custody.correction-followup',commandKey:b.commandKey,fingerprint:fp,resultType:'TASK',resultId:task.id,createdAt:this.clock.now()}});await s.revalidate();return {arrangementId:id,taskId:task.id,replayed:false};
  }));});
 }
 event(ctx:CustomerContext,id:string,b:CustodyEventDto){
  const fp=commandFingerprint({command:'custody.event',version:1,actor:{type:ctx.actor.subjectType,id:ctx.actor.subjectId},payload:JSON.parse(JSON.stringify(b))});
  return this.sales.run(async tx=>{const loc=await tx.custodyArrangement.findUnique({where:{id}});if(!loc)throw new DisputeError('DISPUTE_NOT_FOUND');const sale=await tx.afterSale.findUniqueOrThrow({where:{id:loc.afterSaleId}});return this.entry.withContext(tx,access(ctx),[orderRef(sale.orderId),saleRef(sale.id),custodyRef(id)],ctx.requestId,c=>this.entry.inContext(c,custodyRef(id),async s=>{
   const actor=salePermission(s.actor,'after-sale.inspection.confirm');const prior=await tx.coordinationCommandResult.findUnique({where:{orderId_action_commandKey:{orderId:sale.orderId,action:'custody.event',commandKey:b.commandKey}}});if(prior){if(prior.fingerprint!==fp)throw new DisputeError('COMMAND_PAYLOAD_CONFLICT');const e=await tx.custodyEvent.findUniqueOrThrow({where:{id:prior.resultId}});if(e.arrangementId!==id)throw new DisputeError('COMMAND_PAYLOAD_CONFLICT');return {arrangementId:id,eventId:e.id,version:(await tx.custodyArrangement.findUniqueOrThrow({where:{id}})).version,replayed:true};}
   const a=await tx.custodyArrangement.findUniqueOrThrow({where:{id}});if(a.version!==b.expectedArrangementVersion)throw new DisputeError('VERSION_CONFLICT');if(a.status==='COMPLETED'&&b.kind!=='CORRECTION'||a.disposition==='NO_GOODS')throw new DisputeError('CUSTODY_EVENT_NOT_ALLOWED');const t=await tx.task.findFirst({where:{...custodyRef(id),stage:'CUSTODY_EXECUTE',status:'CLAIMED',assigneeId:actor.subjectId}});if(!t||!isTaskEligible(actor,t))throw new DisputeError('TASK_NOT_ASSIGNEE');if(t.version!==b.expectedTaskVersion)throw new DisputeError('VERSION_CONFLICT');
   const now=this.clock.now(),occurred=new Date(b.occurredAt);if(+occurred>+now||+occurred<+a.createdAt||(b.kind==='CORRECTION')!==!!b.correctsEventId||b.correctsEventId&&!await tx.custodyEvent.count({where:{id:b.correctsEventId,arrangementId:id}}))throw new DisputeError('VALIDATION_FAILED');
   const events=await tx.custodyEvent.findMany({where:{arrangementId:id},orderBy:[{createdAt:'asc'},{id:'asc'}]});const receipt=events.findLast(e=>e.kind==='RECEIPT_CONFIRMED');const qty=a.quantity||receipt?.quantity||0;
   if(a.disposition!=='IN_TRANSIT_UNRECEIVED'&&b.quantity!==a.quantity||a.disposition==='IN_TRANSIT_UNRECEIVED'&&b.kind!=='RECEIPT_CONFIRMED'&&b.quantity!==qty)throw new DisputeError('CUSTODY_PLAN_INCOMPLETE');
   if(b.kind==='RETURN_DISPATCH'&&(!b.carrier||!b.tracking||!b.quantity||a.disposition==='IN_TRANSIT_UNRECEIVED'&&!receipt))throw new DisputeError('CUSTODY_EVENT_NOT_ALLOWED');
   if(['HANDOVER','LOCATION_CHANGED'].includes(b.kind)&&(!b.location||!b.quantity))throw new DisputeError('CUSTODY_PLAN_INCOMPLETE');
   if(b.kind==='RECEIPT_CONFIRMED'&&(!b.location||!b.quantity||a.disposition==='RETURN_TO_CUSTOMER'&&!events.some(e=>e.kind==='RETURN_DISPATCH')))throw new DisputeError('CUSTODY_EVENT_NOT_ALLOWED');
   const complete=a.disposition==='KEEP_IN_CUSTODY'&&b.kind==='HANDOVER'||b.kind==='RECEIPT_CONFIRMED'&&events.some(e=>e.kind==='RETURN_DISPATCH')||a.disposition==='IN_TRANSIT_UNRECEIVED'&&b.kind==='HANDOVER'&&!!receipt;
   const e=await tx.custodyEvent.create({data:{arrangementId:id,kind:b.kind,occurredAt:occurred,quantity:b.quantity,carrier:b.carrier,tracking:b.tracking,location:b.location,actorEmployeeId:actor.subjectId,evidenceNote:b.evidenceNote,publicText:b.publicText,correctsEventId:b.correctsEventId,commandKey:b.commandKey,requestId:s.requestId,createdAt:now}});
   if(b.evidenceFileIds.length)await this.files.bindFiles(tx,{identity:actor,token:ctx.token},{ownerType:'CUSTODY_EVENT',ownerId:e.id,slot:'evidence',audience:'INTERNAL',fileIds:b.evidenceFileIds,commandKey:b.commandKey});
   const completedCorrection=a.status==='COMPLETED'&&b.kind==='CORRECTION',status=complete||completedCorrection?'COMPLETED':b.kind==='EXCEPTION'?'EXCEPTION':'IN_PROGRESS';await tx.custodyArrangement.update({where:{id},data:{status,version:{increment:1}}});if(complete||completedCorrection)await this.lifecycle.transition(c,{...custodyRef(id),taskId:t.id,expectedVersion:t.version,action:'COMPLETED',commandKey:b.commandKey,reason:'真实保管交接、寄还签收或历史更正已记录，原去向与事件保留'});
   await this.audit.appendAudit(tx,{actor:taskAuditActor(actor),action:'coordination.change',targetId:e.id,requestId:s.requestId,reason:b.reason,after:{orderId:sale.orderId,businessId:id,businessType:'CUSTODY_ARRANGEMENT',coordinationAction:'custody.event',coordinationStatus:status,coordinationVersion:a.version+1}});await tx.coordinationCommandResult.create({data:{orderId:sale.orderId,action:'custody.event',commandKey:b.commandKey,fingerprint:fp,resultType:'CUSTODY_EVENT',resultId:e.id,createdAt:now}});await s.revalidate();return {arrangementId:id,eventId:e.id,version:a.version+1,replayed:false};
  }));});
 }
}
