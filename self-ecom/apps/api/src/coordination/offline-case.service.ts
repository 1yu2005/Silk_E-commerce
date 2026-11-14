// 作用：真实线下处理只追加事实和任务，不修改Payment/Refund、原运单、订单地址或库存。
import {Inject,Injectable} from '@nestjs/common';
import {Prisma,type OfflineCase,type Task} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {PrismaService} from '../prisma/prisma.service.js';
import {runAuthTransaction,postgresErrorCode} from '../auth/auth-transaction.js';
import {CurrentIdentityService} from '../auth/current-identity.service.js';
import {AccessDeniedError} from '../auth/access-denied.error.js';
import {TokenValidationError} from '../auth/jwt-token.service.js';
import {lockSessionSubject} from '../auth/session-support.js';
import {Clock} from '../common/time/clock.js';
import type {CustomerContext} from '../customers/customer-access.service.js';
import {TaskEntryService,type TaskActorAccess,type TaskEntryContext,type TaskTransactionScope} from '../tasks/task-entry.service.js';
import {TaskLifecycleService} from '../tasks/task-lifecycle.service.js';
import type {TaskCommandActor} from '../tasks/task-business-adapters.js';
import {isTaskEligible} from '../tasks/task-access.service.js';
import {TaskError} from '../tasks/task.errors.js';
import {FileBindingService} from '../files/file-binding.service.js';
import {AuditService} from '../audit/audit.service.js';
import {commandFingerprint} from '../common/command-fingerprint.js';
import {orderRef} from '../after-sales/after-sale.rules.js';
import * as D from './offline-case.dto.js';
import {OfflineCaseError,offlineActive,offlineCaseTypes,offlineTerminal,offlineRef,offlineTime,offlineEventFacts} from './offline-case.rules.js';
import {publicOfflineForOrder} from './offline-case.public.js';

export function offlinePermission(actor:TaskCommandActor){
 if(actor.subjectType!=='EMPLOYEE'||actor.mustChangePassword||!['offline-case.manage','order.service.read'].every(p=>actor.effectivePermissions.includes(p)))throw new AccessDeniedError('FORBIDDEN');
 return actor;
}
export async function ownedOffline(tx:Prisma.TransactionClient,id:string,actor:TaskCommandActor){
 const row=await tx.offlineCase.findUnique({where:{id}});
 if(!row)throw new OfflineCaseError('OFFLINE_CASE_NOT_FOUND');
 offlinePermission(actor);return row;
}
export interface OfflineCreateInput{
 orderId:string;type:string;subject:string;description:string;publicSummary:string;commandKey:string;reason:string;
 afterSaleId?:string;addressRequestId?:string;disputeDecisionId?:string;nextFollowAt?:string;
}
export interface OfflineResult{offlineCaseId:string;caseNo:string;orderId:string;type:string;status:string;version:number;eventId?:string;taskId?:string;replayed:boolean;transactionNotice:string}
const notice='线下记录，不计系统支付、退款、净消费或库存';
const access=(ctx:CustomerContext):TaskActorAccess=>({type:ctx.actor.subjectType,subjectId:ctx.actor.subjectId,token:ctx.token});
const fingerprint=(actor:TaskCommandActor,action:string,body:object)=>commandFingerprint({command:'offline-case.'+action,version:1,actor:{type:actor.subjectType,id:actor.subjectType==='SYSTEM'?'system':actor.subjectId},payload:JSON.parse(JSON.stringify(body))});
const retryable=(e:unknown)=>e instanceof TaskError&&e.code==='TASK_LOCK_PLAN_CHANGED';

@Injectable()
export class OfflineCaseService{
 constructor(@Inject(PrismaService)private readonly db:PrismaService,@Inject(TaskEntryService)private readonly entry:TaskEntryService,
  @Inject(TaskLifecycleService)private readonly lifecycle:TaskLifecycleService,@Inject(CurrentIdentityService)private readonly identities:CurrentIdentityService,
  @Inject(Clock)private readonly clock:Clock,@Inject(FileBindingService)private readonly files:FileBindingService,@Inject(AuditService)private readonly audit:AuditService){}
 private async run<T>(work:(tx:Prisma.TransactionClient)=>Promise<T>){
  try{return await runAuthTransaction(this.db,work,retryable);}catch(e){
   if(e instanceof Error&&e.message==='timeout exceeded when trying to connect'||e instanceof Prisma.PrismaClientKnownRequestError&&(e.code==='P2028'||e.code==='P2010'&&['55P03','57014'].includes(postgresErrorCode(e)??'')))throw new OfflineCaseError('REQUEST_IN_PROGRESS');throw e;
  }
 }
 private result(row:OfflineCase,replayed=false,extra:Partial<Pick<OfflineResult,'eventId'|'taskId'>>={}):OfflineResult{return {offlineCaseId:row.id,caseNo:row.caseNo,orderId:row.orderId,type:row.type,status:row.status,version:row.version,...extra,replayed,transactionNotice:notice};}
 private async prior(tx:Prisma.TransactionClient,orderId:string,action:string,key:string,hash:string,id?:string){
  const row=await tx.coordinationCommandResult.findUnique({where:{orderId_action_commandKey:{orderId,action:'offline.'+action,commandKey:key}}});
  if(!row)return;
  if(row.fingerprint!==hash||id&&row.resultType==='OFFLINE_CASE'&&row.resultId!==id)throw new OfflineCaseError('COMMAND_PAYLOAD_CONFLICT');
  const event=row.resultType==='OFFLINE_CASE_EVENT'?await tx.offlineCaseEvent.findUniqueOrThrow({where:{id:row.resultId}}):null;
  if(id&&event&&event.offlineCaseId!==id)throw new OfflineCaseError('COMMAND_PAYLOAD_CONFLICT');
  return this.result(await tx.offlineCase.findUniqueOrThrow({where:{id:event?.offlineCaseId??row.resultId}}),true,event?{eventId:event.id}:{});
 }
 private async receipt(tx:Prisma.TransactionClient,row:OfflineCase,action:string,key:string,hash:string,eventId?:string){
  await tx.coordinationCommandResult.create({data:{orderId:row.orderId,action:'offline.'+action,commandKey:key,fingerprint:hash,resultType:eventId?'OFFLINE_CASE_EVENT':'OFFLINE_CASE',resultId:eventId??row.id,createdAt:this.clock.now()}});
  return this.result(row,false,eventId?{eventId}:{});
 }
 async auditChange(s:TaskTransactionScope,row:OfflineCase,action:string,reason:string){
  const actor=offlinePermission(s.actor);
  await this.audit.appendAudit(s.tx,{actor:{type:'EMPLOYEE',id:actor.subjectId},action:'coordination.change',targetId:row.id,requestId:s.requestId,reason,
   after:{orderId:row.orderId,businessType:'OFFLINE_CASE',businessId:row.id,coordinationAction:action,coordinationStatus:row.status,coordinationVersion:row.version}});
 }
 private async links(tx:Prisma.TransactionClient,input:OfflineCreateInput){
  const order=await tx.order.findUnique({where:{id:input.orderId}});if(!order)throw new OfflineCaseError('OFFLINE_CASE_NOT_FOUND');
  if(input.afterSaleId&&!await tx.afterSale.count({where:{id:input.afterSaleId,orderId:order.id,customerId:order.customerId}}))throw new OfflineCaseError('OFFLINE_CASE_NOT_FOUND');
  if(input.addressRequestId&&!await tx.addressRequest.count({where:{id:input.addressRequestId,orderId:order.id,customerId:order.customerId}}))throw new OfflineCaseError('OFFLINE_CASE_NOT_FOUND');
  if(input.disputeDecisionId){const decision=await tx.disputeDecision.findUnique({where:{id:input.disputeDecisionId}});if(!decision||input.afterSaleId&&input.afterSaleId!==decision.afterSaleId||!await tx.afterSale.count({where:{id:decision.afterSaleId,orderId:order.id,customerId:order.customerId}}))throw new OfflineCaseError('OFFLINE_CASE_NOT_FOUND');}
  return order;
 }
 /** 调用方已持Order等上游锁；只使用传入事务，不消费外部命令结果键。 */
 async createInContext(s:TaskTransactionScope,input:OfflineCreateInput,actorAccess:TaskActorAccess){
  const actor=offlinePermission(s.actor),order=await this.links(s.tx,input),now=this.clock.now();
  if(!offlineCaseTypes.includes(input.type as typeof offlineCaseTypes[number]))throw new OfflineCaseError('VALIDATION_FAILED');
  const row=await s.tx.offlineCase.create({data:{id:randomUUID(),caseNo:'OC'+now.getTime().toString(36).toUpperCase()+randomUUID().replaceAll('-','').slice(0,14).toUpperCase(),customerId:order.customerId,orderId:order.id,type:input.type,subject:input.subject,description:input.description,publicSummary:input.publicSummary,afterSaleId:input.afterSaleId,addressRequestId:input.addressRequestId,disputeDecisionId:input.disputeDecisionId,nextFollowAt:input.nextFollowAt?offlineTime(input.nextFollowAt,now,true):null,createdById:actor.subjectId,createdAt:now}});
  return this.entry.withContext(s.tx,actorAccess,[orderRef(order.id),offlineRef(row.id)],s.requestId,c=>this.entry.inContext(c,offlineRef(row.id),async inner=>{
   const task=await this.entry.enterStage(c,{...offlineRef(row.id),stage:'OFFLINE_FOLLOW',entryKey:'create:'+input.commandKey,reason:input.reason});
   await this.auditChange(inner,row,'create',input.reason);await inner.revalidate();return {...row,taskId:task.task.id};
  }));
 }
 create(ctx:CustomerContext,b:D.CreateOfflineCaseDto){return this.run(tx=>this.entry.withContext(tx,access(ctx),[orderRef(b.orderId)],ctx.requestId,c=>this.entry.inContext(c,orderRef(b.orderId),async s=>{
  offlinePermission(s.actor);const order=await this.links(tx,b),hash=fingerprint(s.actor,'create',b),old=await this.prior(tx,order.id,'create',b.commandKey,hash);if(old)return old;
  if(order.version!==b.expectedOrderVersion)throw new OfflineCaseError('VERSION_CONFLICT');
  const row=await this.createInContext(s,b,access(ctx));await s.revalidate();const result=await this.receipt(tx,row,'create',b.commandKey,hash);return {...result,taskId:row.taskId};
 })));}
 async task(s:TaskTransactionScope,id:string,version:number,stage:'OFFLINE_FOLLOW'|'ADMIN_DISPUTE'='OFFLINE_FOLLOW'){
  const actor=offlinePermission(s.actor),task=await s.tx.task.findFirst({where:{...offlineRef(id),stage,...offlineActive}});
  if(!task||task.status!=='CLAIMED'||task.assigneeId!==actor.subjectId||!isTaskEligible(actor,task))throw new OfflineCaseError('TASK_NOT_ASSIGNEE');
  if(task.version!==version)throw new OfflineCaseError('VERSION_CONFLICT');return task;
 }
 private command<T extends D.OfflineCommandDto>(ctx:CustomerContext,id:string,action:string,b:T,work:(s:TaskTransactionScope,c:TaskEntryContext,row:OfflineCase)=>Promise<string|undefined>){return this.run(async tx=>{
  const location=await tx.offlineCase.findUnique({where:{id},select:{orderId:true}});if(!location)throw new OfflineCaseError('OFFLINE_CASE_NOT_FOUND');
  return this.entry.withContext(tx,access(ctx),[orderRef(location.orderId),offlineRef(id)],ctx.requestId,c=>this.entry.inContext(c,offlineRef(id),async s=>{
   const row=await ownedOffline(tx,id,s.actor),hash=fingerprint(s.actor,action,b),old=await this.prior(tx,row.orderId,action,b.commandKey,hash,id);if(old)return old;
   if(row.version!==b.expectedCaseVersion)throw new OfflineCaseError('VERSION_CONFLICT');if(offlineTerminal(row.status))throw new OfflineCaseError('OFFLINE_CASE_ACTION_NOT_ALLOWED');
   if(row.status==='OPEN'&&action!=='begin')throw new OfflineCaseError('OFFLINE_CASE_ACTION_NOT_ALLOWED');
   const eventId=await work(s,c,row);await s.revalidate();return this.receipt(tx,await tx.offlineCase.findUniqueOrThrow({where:{id}}),action,b.commandKey,hash,eventId);
  }));
 });}
 begin(ctx:CustomerContext,id:string,b:D.OfflineCommandDto){return this.command(ctx,id,'begin',b,async(s,_c,row)=>{
  await this.task(s,id,b.expectedTaskVersion);if(row.status!=='OPEN')throw new OfflineCaseError('OFFLINE_CASE_ACTION_NOT_ALLOWED');
  const current=await s.tx.offlineCase.update({where:{id},data:{status:'IN_PROGRESS',version:{increment:1}}});await this.auditChange(s,current,'begin',b.reason);return undefined;
 });}
 append(ctx:CustomerContext,id:string,b:D.OfflineEventDto){return this.command(ctx,id,'event',b,async(s,c)=>{const event=await this.appendInContext(s,c,id,b,ctx.token);return event.id;});}
 /** 代理输入调用同一领域；Context消费和ProxyExecution由调用方在本事务内完成。 */
 async appendInContext(s:TaskTransactionScope,c:TaskEntryContext,id:string,b:D.OfflineEventDto,token:string,proxyContextId?:string){
  const row=await ownedOffline(s.tx,id,s.actor),actor=offlinePermission(s.actor);
  if(row.version!==b.expectedCaseVersion)throw new OfflineCaseError('VERSION_CONFLICT');if(offlineTerminal(row.status)||row.status==='OPEN')throw new OfflineCaseError('OFFLINE_CASE_ACTION_NOT_ALLOWED');
  const isAdminDecision=!!b.adminDecision&&b.adminDecision!=='REQUEST';
  if(!isAdminDecision)await this.task(s,id,b.expectedTaskVersion);
  const now=this.clock.now(),times=offlineEventFacts(b,now);
  if(await s.tx.offlineCaseEvent.count({where:{offlineCaseId:id,commandKey:b.commandKey}}))throw new OfflineCaseError('COMMAND_PAYLOAD_CONFLICT');
  if(b.correctsEventId&&!await s.tx.offlineCaseEvent.count({where:{id:b.correctsEventId,offlineCaseId:id}}))throw new OfflineCaseError('OFFLINE_CASE_NOT_FOUND');
  let admin:Task|undefined;
  if(b.adminDecision==='REQUEST'){
   if(row.adminRequestEventId&&!row.adminDecisionEventId)throw new OfflineCaseError('OFFLINE_CASE_HAS_PENDING_ACTIONS');
  }else if(b.adminDecision){
   if(actor.role!=='SUPER_ADMIN'||!actor.effectivePermissions.includes('after-sale.dispute.decide'))throw new AccessDeniedError('FORBIDDEN');
   if(row.adminRequestEventId!==b.basedAdminRequestEventId||row.adminDecisionEventId)throw new OfflineCaseError('VERSION_CONFLICT');
   admin=await this.task(s,id,b.expectedAdminTaskVersion??b.expectedTaskVersion,'ADMIN_DISPUTE');
  }
  if(proxyContextId){const proxy=await s.tx.proxyContext.findUnique({where:{id:proxyContextId}});if(b.adminDecision||!proxy||proxy.orderId!==row.orderId||proxy.customerId!==row.customerId||proxy.offlineCaseId!==id||proxy.action!=='OFFLINE_RESULT'||proxy.verifiedById!==actor.subjectId||proxy.status!=='VERIFIED'||+proxy.expiresAt<=+now)throw new OfflineCaseError('VALIDATION_FAILED');}
  const event=await s.tx.offlineCaseEvent.create({data:{offlineCaseId:id,kind:b.kind,occurredAt:times.occurredAt,channel:b.channel,result:b.result,nextStep:b.nextStep,nextFollowAt:times.nextFollowAt,publicText:b.publicText,reportedAmountCents:b.reportedAmountCents,externalPaymentAt:times.externalPaymentAt,externalVerification:b.externalVerification,carrier:b.carrier,tracking:b.tracking,correctsEventId:b.correctsEventId,actorEmployeeId:actor.subjectId,proxyContextId,representedCustomerId:proxyContextId?row.customerId:null,adminDecision:b.adminDecision,basedAdminRequestEventId:b.basedAdminRequestEventId,commandKey:b.commandKey,requestId:s.requestId,createdAt:now}});
  if(b.evidenceFileIds.length)await this.files.bindFiles(s.tx,{identity:actor,token},{ownerType:'OFFLINE_CASE_EVENT',ownerId:event.id,slot:'evidence',audience:'INTERNAL',fileIds:b.evidenceFileIds,commandKey:b.commandKey});
  const current=await s.tx.offlineCase.update({where:{id},data:{status:b.waitExternal?'WAIT_EXTERNAL':'IN_PROGRESS',version:{increment:1},nextFollowAt:times.nextFollowAt,...(b.adminDecision==='REQUEST'?{adminRequestEventId:event.id,adminDecisionEventId:null}:b.adminDecision?{adminDecisionEventId:event.id}:{})}});
  if(b.adminDecision==='REQUEST')await this.entry.enterStage(c,{...offlineRef(id),stage:'ADMIN_DISPUTE',entryKey:'admin:'+event.id,reason:b.reason});
  if(admin)await this.finish(c,admin,b.commandKey,b.reason);
  // 等待外部保留当前经办与原轮；不会因写一条备注结束任务。
  await this.auditChange(s,current,'event',b.reason);await s.revalidate();return event;
 }
 private finish(c:TaskEntryContext,task:Task,key:string,reason:string){return this.lifecycle.transition(c,{...offlineRef(task.businessId),taskId:task.id,expectedVersion:task.version,action:'COMPLETED',commandKey:key,reason});}
 async assertNoPending(tx:Prisma.TransactionClient,row:OfflineCase){
  if(row.adminRequestEventId&&!row.adminDecisionEventId||await tx.task.count({where:{...offlineRef(row.id),stage:'ADMIN_DISPUTE',...offlineActive}}))throw new OfflineCaseError('OFFLINE_CASE_HAS_PENDING_ACTIONS');
  if(await tx.custodyArrangement.count({where:{OR:[{followOfflineCaseId:row.id},...(row.disputeDecisionId?[{disputeDecisionId:row.disputeDecisionId}]:[]),...(row.afterSaleId?[{afterSaleId:row.afterSaleId}]:[])],status:{not:'COMPLETED'}}}))throw new OfflineCaseError('OFFLINE_CASE_HAS_PENDING_ACTIONS');
  if(row.afterSaleId&&await tx.disputeRequest.count({where:{afterSaleId:row.afterSaleId,status:'OPEN'}}))throw new OfflineCaseError('OFFLINE_CASE_HAS_PENDING_ACTIONS');
 }
 resolve(ctx:CustomerContext,id:string,b:D.ResolveOfflineCaseDto){return this.end(ctx,id,'resolve',b);}
 close(ctx:CustomerContext,id:string,b:D.CloseOfflineCaseDto){return this.end(ctx,id,'close',b);}
 private end(ctx:CustomerContext,id:string,action:'resolve'|'close',b:D.ResolveOfflineCaseDto|D.CloseOfflineCaseDto){return this.command(ctx,id,action,b,async(s,c,row)=>{
  const task=await this.task(s,id,b.expectedTaskVersion);await this.assertNoPending(s.tx,row);const now=this.clock.now(),status=action==='resolve'?'RESOLVED':'CLOSED';
  const event=await s.tx.offlineCaseEvent.create({data:{offlineCaseId:id,kind:action==='resolve'?'RESOLUTION':'CLOSURE',occurredAt:now,channel:'OTHER',result:'actualResult'in b?b.actualResult:b.reason,publicText:b.publicExplanation,actorEmployeeId:offlinePermission(s.actor).subjectId,commandKey:b.commandKey,requestId:s.requestId,createdAt:now}});
  const current=await s.tx.offlineCase.update({where:{id},data:{status,version:{increment:1},publicSummary:b.publicExplanation,nextFollowAt:null,...(action==='resolve'?{resolvedAt:now}:{closedAt:now})}});
  await this.finish(c,task,b.commandKey,b.reason);await this.auditChange(s,current,action,b.reason);return event.id;
 });}
 private async read<T>(ctx:CustomerContext,work:(tx:Prisma.TransactionClient,actor:TaskCommandActor)=>Promise<T>){return this.run(async tx=>{
  if(ctx.actor.subjectType!=='EMPLOYEE')throw new AccessDeniedError('FORBIDDEN');await lockSessionSubject(tx,ctx.actor);const actor=await this.identities.authenticate(tx,ctx.token,'EMPLOYEE');if(actor.subjectId!==ctx.actor.subjectId||actor.sessionId!==ctx.actor.sessionId)throw new TokenValidationError('TOKEN_INVALID');offlinePermission(actor);return work(tx,actor);
 });}
 list(ctx:CustomerContext,q:D.OfflineCaseQueryDto){return this.read(ctx,async(tx)=>{
  const page=q.page??1,pageSize=q.pageSize??20;
  const orderIds=q.orderNo?(await tx.order.findMany({where:{number:{contains:q.orderNo,mode:'insensitive'}},select:{id:true}})).map(o=>o.id):undefined;
  const assigned=q.assigneeId?(await tx.task.findMany({where:{businessType:'OFFLINE_CASE',assigneeId:q.assigneeId,...offlineActive},select:{businessId:true}})).map(t=>t.businessId):undefined;
  const where:Prisma.OfflineCaseWhereInput={...(q.type?{type:q.type}:{}),...(q.status?{status:q.status}:{}),...(q.orderId?{orderId:q.orderId}:{}),...(orderIds?{AND:[{orderId:{in:orderIds}}]}:{}),...(assigned?{id:{in:assigned}}:{})};
  const total=await tx.offlineCase.count({where}),skip=BigInt(page-1)*BigInt(pageSize),rows=skip>=BigInt(total)?[]:await tx.offlineCase.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:Number(skip),take:pageSize});
  return {items:await Promise.all(rows.map(async row=>({...this.summary(row),tasks:await this.tasks(tx,row.id)}))),total,page,pageSize,transactionNotice:notice};
 });}
 private summary(row:OfflineCase){return {id:row.id,caseNo:row.caseNo,orderId:row.orderId,customerId:row.customerId,afterSaleId:row.afterSaleId,addressRequestId:row.addressRequestId,disputeDecisionId:row.disputeDecisionId,type:row.type,status:row.status,subject:row.subject,publicSummary:row.publicSummary,version:row.version,nextFollowAt:row.nextFollowAt,createdAt:row.createdAt,resolvedAt:row.resolvedAt,closedAt:row.closedAt,adminRequestEventId:row.adminRequestEventId,adminDecisionEventId:row.adminDecisionEventId};}
 private async tasks(tx:Prisma.TransactionClient,id:string){return tx.task.findMany({where:{...offlineRef(id)},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true,stage:true,status:true,assigneeId:true,version:true,round:true,dueAt:true,reassignNeeded:true,everOverdue:true}});}
 detail(ctx:CustomerContext,id:string){return this.read(ctx,async(tx,actor)=>{
  const row=await ownedOffline(tx,id,actor),events=await tx.offlineCaseEvent.findMany({where:{offlineCaseId:id},orderBy:[{createdAt:'asc'},{id:'asc'}]}),tasks=await this.tasks(tx,id);
  const references=await tx.fileReference.findMany({where:{ownerType:'OFFLINE_CASE_EVENT',ownerId:{in:events.map(e=>e.id)}}});
  let hasPendingActions=false;try{await this.assertNoPending(tx,row);}catch(e){if(!(e instanceof OfflineCaseError)||e.code!=='OFFLINE_CASE_HAS_PENDING_ACTIONS')throw e;hasPendingActions=true;}
  const actorId=offlinePermission(actor).subjectId,following=!offlineTerminal(row.status)&&tasks.some(t=>t.stage==='OFFLINE_FOLLOW'&&t.status==='CLAIMED'&&t.assigneeId===actorId);
  return {...this.summary(row),description:row.description,createdById:row.createdById,events:events.map(event=>({...event,evidence:references.filter(r=>r.ownerId===event.id).map(r=>({id:r.fileAssetId,contentUrl:'/api/v1/files/'+r.fileAssetId+'/content'}))})),tasks,custodyArrangements:await tx.custodyArrangement.findMany({where:{followOfflineCaseId:id},orderBy:{id:'asc'}}),hasPendingActions,allowedActions:{begin:row.status==='OPEN'&&following,event:following,resolve:following&&!hasPendingActions,close:following&&!hasPendingActions,adminDecision:actor.subjectType==='EMPLOYEE'&&actor.role==='SUPER_ADMIN'&&tasks.some(t=>t.stage==='ADMIN_DISPUTE'&&t.status==='CLAIMED'&&t.assigneeId===actor.subjectId)},transactionNotice:notice,serverTime:this.clock.now()};
 });}
 /** 订单/售后本人投影仅显式公开字段，调用方仍须先验证本人订单归属。 */
 async publicForOrder(tx:Prisma.TransactionClient,orderId:string,customerId:string){
  return publicOfflineForOrder(tx,orderId,customerId);
 }
}
