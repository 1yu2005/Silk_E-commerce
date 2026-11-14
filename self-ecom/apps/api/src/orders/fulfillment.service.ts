// 作用：仓储动作以订单锁串行裁决；真实交运、计时、任务、证据、历史和审计在同一事务。
import {Inject,Injectable} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {Prisma,type Order,type HandoverAttempt,type TaskStage,type TaskStatus} from '@prisma/client';
import {PrismaService} from '../prisma/prisma.service.js';
import {runAuthTransaction} from '../auth/auth-transaction.js';
import {Clock} from '../common/time/clock.js';
import {calculateDeadline,BUSINESS_TIME_ZONE,DEADLINE_ALGORITHM_VERSION} from '../common/time/deadline.js';
import {commandFingerprint} from '../common/command-fingerprint.js';
import type {CustomerContext} from '../customers/customer-access.service.js';
import {TaskEntryService,type TaskActorAccess,type TaskEntryContext,type TaskTransactionScope} from '../tasks/task-entry.service.js';
import {TaskLifecycleService,taskAuditActor} from '../tasks/task-lifecycle.service.js';
import {TaskSourceService} from '../tasks/task-source.service.js';
import {TaskCommandService} from '../tasks/task-command.service.js';
import {isTaskEligible} from '../tasks/task-access.service.js';
import {TaskError} from '../tasks/task.errors.js';
import {OrderTimerService} from '../tasks/order-timer.service.js';
import {StateHistoryService} from '../records/state-history.service.js';
import {CommunicationService} from '../records/communication.service.js';
import {AuditService} from '../audit/audit.service.js';
import {FileBindingService} from '../files/file-binding.service.js';
import {StoreSettingsService} from '../settings/store-settings.service.js';
import {APP_CONFIG,type EnvironmentConfig} from '../config/environment.js';
import {FulfillmentAfterSales} from './fulfillment-after-sales.js';
import {requireOrderPermission,ownedOrder} from './order-access.service.js';
import {checkWholeOrder,pendingHandover,shipmentBlocked,validPacking} from './fulfillment.rules.js';
import {currentDamage} from './order-stock.js';
import {OrderError} from './order.errors.js';
import type * as D from './fulfillment.dto.js';
type RefResult={shipmentId?:string;packingCheckId?:string;attemptId?:string;exceptionId?:string;verificationId?:string;revisionId?:string;conclusion?:string};
const ref=(id:string)=>({businessType:'ORDER' as const,businessId:id});
const retryPlan=(e:unknown)=>e instanceof TaskError&&e.code==='TASK_LOCK_PLAN_CHANGED';
const activeStatuses:TaskStatus[]=['OPEN','CLAIMED','SUSPENDED'];
@Injectable()
export class FulfillmentService {
 constructor(@Inject(PrismaService)private readonly db:PrismaService,@Inject(Clock)private readonly clock:Clock,
 @Inject(TaskEntryService)private readonly entry:TaskEntryService,@Inject(TaskLifecycleService)private readonly lifecycle:TaskLifecycleService,
 @Inject(TaskSourceService)private readonly sources:TaskSourceService,@Inject(TaskCommandService)private readonly tasks:TaskCommandService,
 @Inject(OrderTimerService)private readonly timer:OrderTimerService,@Inject(StateHistoryService)private readonly history:StateHistoryService,
 @Inject(AuditService)private readonly audit:AuditService,@Inject(FileBindingService)private readonly files:FileBindingService,
 @Inject(StoreSettingsService)private readonly settings:StoreSettingsService,@Inject(FulfillmentAfterSales)private readonly afterSales:FulfillmentAfterSales,
 @Inject(CommunicationService)private readonly communications:CommunicationService,@Inject(APP_CONFIG)private readonly config:EnvironmentConfig){}
 private access(ctx:CustomerContext):TaskActorAccess{return {type:ctx.actor.subjectType,subjectId:ctx.actor.subjectId,token:ctx.token};}
 private locked<T>(access:TaskActorAccess,id:string,requestId:string,work:(scope:TaskTransactionScope,context:TaskEntryContext)=>Promise<T>){
  return runAuthTransaction(this.db,tx=>this.entry.withContext(tx,access,[ref(id)],requestId,c=>this.entry.inContext(c,ref(id),s=>work(s,c))),retryPlan);
 }
 private async present(tx:Prisma.TransactionClient,id:string,result:RefResult,replayed:boolean){const o=await tx.order.findUniqueOrThrow({where:{id}});const attempt=result.attemptId?await tx.handoverAttempt.findUnique({where:{id:result.attemptId}}):null;
  const tasks=await tx.task.findMany({where:{...ref(id),status:{in:activeStatuses}},select:{id:true,stage:true,status:true,version:true}});
  return {orderId:id,orderStatus:o.status,fulfillmentStage:o.fulfillmentStage,orderVersion:o.version,tasks,...result,...(attempt?{attemptNo:attempt.attemptNo,attemptStatus:attempt.status,attemptVersion:attempt.version}:{}),replayed};}
 private command(ctx:CustomerContext,id:string,action:string,b:D.FulfillmentCommandDto,permission:string,work:(s:TaskTransactionScope,c:TaskEntryContext,o:Order,fingerprint:string)=>Promise<RefResult>){
  // JSON转换仅用于把经过DTO白名单的类实例规范成普通对象；指纹仍由公共内核稳定排序。
  const fingerprint=commandFingerprint({command:'fulfillment.'+action.replaceAll(':','.'),version:1,actor:{type:ctx.actor.subjectType,id:ctx.actor.subjectId},payload:JSON.parse(JSON.stringify(b))});
  return this.locked(this.access(ctx),id,ctx.requestId,async(s,c)=>{const a=requireOrderPermission(s.actor,permission),o=await ownedOrder(s.tx,id,a);
   const prior=await s.tx.fulfillmentCommandResult.findUnique({where:{orderId_action_commandKey:{orderId:id,action,commandKey:b.commandKey}}});
   if(prior){if(prior.fingerprint!==fingerprint)throw new OrderError('COMMAND_PAYLOAD_CONFLICT');return this.present(s.tx,id,prior.result as RefResult,true);}
   if(o.version!==b.expectedOrderVersion)throw new OrderError('VERSION_CONFLICT');
   const result=await work(s,c,o,fingerprint);await s.revalidate();
   await s.tx.fulfillmentCommandResult.create({data:{orderId:id,action,commandKey:b.commandKey,fingerprint,result,createdAt:this.clock.now()}});
   return this.present(s.tx,id,result,false);
  });
 }
 private async assignee(s:TaskTransactionScope,id:string,stages:TaskStage[],version:number){const a=s.actor;if(a.subjectType!=='EMPLOYEE')throw new OrderError('TASK_NOT_ASSIGNEE');
  const task=await s.tx.task.findFirst({where:{...ref(id),stage:{in:stages},status:'CLAIMED',assigneeId:a.subjectId},orderBy:{id:'asc'}});
  if(!task||!isTaskEligible(a,task))throw new OrderError('TASK_NOT_ASSIGNEE');if(task.version!==version)throw new OrderError('VERSION_CONFLICT');return task;
 }
 private async readyToWork(s:TaskTransactionScope,o:Order){if(o.status!=='WAIT_SHIPMENT'||o.actualHandoverAt)throw new OrderError('ORDER_NOT_READY_TO_SHIP');if(await pendingHandover(s.tx,o.id))throw new OrderError('HANDOVER_ALREADY_PENDING');if(await shipmentBlocked(s.tx,o.id)||await this.afterSales.hasActive(s.tx,o.id))throw new OrderError('ORDER_BLOCKED');}
 private async changeStage(s:TaskTransactionScope,o:Order,to:string,key:string,reason:string,extra:Prisma.OrderUpdateInput={}){
  const after=await s.tx.order.update({where:{id:o.id},data:{...extra,fulfillmentStage:to,version:{increment:1},updatedAt:this.clock.now()}});
  if(o.fulfillmentStage!==to)await this.history.appendStateHistory(s.tx,taskAuditActor(s.actor),{aggregateType:'ORDER',aggregateId:o.id,dimension:'fulfillment',fromState:o.fulfillmentStage,toState:to,commandKey:key,reason,requestId:s.requestId});return after;
 }
 private async event(s:TaskTransactionScope,id:string,action:'PACK'|'PREPARE'|'START'|'CONFIRM'|'UNCERTAIN'|'RESOLVE'|'EXCEPTION'|'WAREHOUSE_READY'|'CUSTOMER_WAIT'|'CUSTOMER_CONTINUE'|'CUSTOMER_REQUEST_REFUND'|'RELEASE_EXCEPTION'|'TRACKING'|'PHYSICAL_CHECK',reason:string,sourceId?:string){const o=await s.tx.order.findUniqueOrThrow({where:{id}});await this.audit.appendAudit(s.tx,{actor:taskAuditActor(s.actor),action:'order.fulfillment',targetId:id,requestId:s.requestId,reason,after:{orderStatus:o.status,orderVersion:o.version,fulfillmentStage:o.fulfillmentStage,fulfillmentAction:action,...(sourceId?{sourceId}:{})}});}
 private async bind(s:TaskTransactionScope,ctx:CustomerContext,ownerType:'HANDOVER_VERIFICATION'|'SHIPMENT_EXCEPTION'|'SHIPMENT_EXCEPTION_DECISION'|'SHIPMENT_TRACKING_REVISION',ownerId:string,fileIds:string[]|undefined,key:string){if(!fileIds?.length)return;if(s.actor.subjectType==='SYSTEM')throw new OrderError('VALIDATION_FAILED');await this.files.bindFiles(s.tx,{identity:s.actor,token:ctx.token},{ownerType,ownerId,slot:'evidence',audience:'INTERNAL',fileIds,commandKey:key});}
 async claim(ctx:CustomerContext,id:string,b:D.ClaimShipmentDto){const task=await this.db.task.findFirst({where:{...ref(id),stage:'SHIPMENT_PROCESS',status:{in:activeStatuses}},orderBy:{round:'desc'}});if(!task)throw new OrderError('ORDER_NOT_READY_TO_SHIP');
  return this.tasks.claim(ctx.actor,ctx.token,task.id,{expectedVersion:b.expectedTaskVersion},ctx.requestId,async(tx,t)=>{const o=await ownedOrder(tx,id,ctx.actor);if(o.version!==b.expectedOrderVersion){const prior=t.status==='CLAIMED'&&t.assigneeId===ctx.actor.subjectId&&t.version===b.expectedTaskVersion+1;if(!prior)throw new OrderError('VERSION_CONFLICT');}});
 }
 pack(ctx:CustomerContext,id:string,b:D.PackDto,physical=false){return this.command(ctx,id,physical?'physical-check':'pack',b,'shipment.pack',async(s,_c,o)=>{
  await this.readyToWork(s,o);await this.assignee(s,id,['SHIPMENT_PROCESS'],b.expectedTaskVersion);if(o.stockPhysicalVersion!==b.expectedPhysicalVersion)throw new OrderError('PHYSICAL_CHECK_STALE');
  const items=checkWholeOrder(await s.tx.orderItem.findMany({where:{orderId:id}}),b.items),a=requireOrderPermission(s.actor,'shipment.pack'),now=this.clock.now();
  const f=await s.tx.fulfillment.upsert({where:{orderId:id},create:{orderId:id},update:{}});
  const p=await s.tx.packingCheck.create({data:{orderId:id,fulfillmentId:f.id,checkedPhysicalVersion:o.stockPhysicalVersion+(physical?1:0),checkedItems:items,goodsLocation:b.goodsLocation,checkedById:a.subjectId,commandKey:b.commandKey,createdAt:now}});
  await s.tx.fulfillment.update({where:{id:f.id},data:{currentPackingCheckId:physical?null:p.id,version:{increment:1},updatedAt:now}});
  const shipment=await s.tx.shipment.findUnique({where:{orderId:id}});await this.changeStage(s,o,!physical&&shipment?'READY':'PREPARING',b.commandKey,b.reason,physical?{stockPhysicalVersion:{increment:1}}:{});
  await this.event(s,id,physical?'PHYSICAL_CHECK':'PACK',b.reason,p.id);return {packingCheckId:p.id};
 });}
 prepare(ctx:CustomerContext,id:string,b:D.PrepareShipmentDto){return this.command(ctx,id,'prepare',b,'shipment.pack',async(s,_c,o)=>{
  await this.readyToWork(s,o);await this.assignee(s,id,['SHIPMENT_PROCESS'],b.expectedTaskVersion);const a=requireOrderPermission(s.actor,'shipment.pack');const prior=await s.tx.shipment.findUnique({where:{orderId:id}});
  if(!await validPacking(s.tx,o))throw new OrderError('PACKING_CHECK_STALE');
  if(prior&&(prior.carrierName!==b.carrierName||prior.trackingNumber!==b.trackingNumber))await this.revision(s,ctx,prior,b,false);
  const shipment=prior?await s.tx.shipment.update({where:{id:prior.id},data:{carrierName:b.carrierName,trackingNumber:b.trackingNumber,version:{increment:1},updatedAt:this.clock.now()}}):await s.tx.shipment.create({data:{orderId:id,carrierName:b.carrierName,trackingNumber:b.trackingNumber,preparedById:a.subjectId,createdAt:this.clock.now(),updatedAt:this.clock.now()}});
  await this.changeStage(s,o,await validPacking(s.tx,o)?'READY':'PREPARING',b.commandKey,b.reason);await this.event(s,id,'PREPARE',b.reason,shipment.id);return {shipmentId:shipment.id};
 });}
 start(ctx:CustomerContext,id:string,b:D.StartHandoverDto){return this.command(ctx,id,'start',b,'shipment.handover',async(s,_c,o,fingerprint)=>{
  await this.readyToWork(s,o);await this.assignee(s,id,['SHIPMENT_PROCESS'],b.expectedTaskVersion);const p=await validPacking(s.tx,o),shipment=await s.tx.shipment.findUnique({where:{orderId:id}});
  if(o.fulfillmentStage!=='READY'||!shipment||shipment.id!==b.shipmentId||shipment.status!=='PREPARED'||!await s.tx.payment.count({where:{orderId:id,status:'SUCCEEDED'}}))throw new OrderError('ORDER_NOT_READY_TO_SHIP');
  if(!p||p.id!==b.packingCheckId||o.stockPhysicalVersion!==b.expectedPhysicalVersion)throw new OrderError('PACKING_CHECK_STALE');
  const a=requireOrderPermission(s.actor,'shipment.handover'),now=this.clock.now(),last=await s.tx.handoverAttempt.findFirst({where:{orderId:id},orderBy:{attemptNo:'desc'}});
  const attempt=await s.tx.handoverAttempt.create({data:{orderId:id,shipmentId:shipment.id,attemptNo:(last?.attemptNo??0)+1,startCommandKey:b.commandKey,fingerprint,carrierSnapshot:shipment.carrierName,trackingSnapshot:shipment.trackingNumber,packingCheckId:p.id,physicalVersion:o.stockPhysicalVersion,startedById:a.subjectId,startedAt:now,uncertainAfter:new Date(+now+(this.config.handoverTimeoutMs??300000))}});
  await this.changeStage(s,o,'HANDOVER_IN_PROGRESS',b.commandKey,b.reason);await this.event(s,id,'START',b.reason,attempt.id);return {attemptId:attempt.id,shipmentId:shipment.id};
 });}
 confirm(ctx:CustomerContext,id:string,b:D.ConfirmHandoverDto){return this.command(ctx,id,'confirm',b,'shipment.handover',async(s,c,o,f)=>{
  const attempt=await this.attempt(s,id,b.attemptId,b.expectedAttemptVersion);if(attempt.status!=='IN_PROGRESS')throw new OrderError('HANDOVER_VERIFICATION_REQUIRED');await this.assignee(s,id,['SHIPMENT_PROCESS'],b.expectedTaskVersion);
  return this.handedOver(s,c,ctx,o,attempt,b,new Date(b.actualHandoverAt),f,false);
 });}
 private async attempt(s:TaskTransactionScope,id:string,attemptId:string,version:number){const attempt=await s.tx.handoverAttempt.findUnique({where:{id:attemptId}});if(!attempt||attempt.orderId!==id)throw new OrderError('HANDOVER_NOT_FOUND');if(attempt.version!==version)throw new OrderError('VERSION_CONFLICT');if(!['IN_PROGRESS','UNCERTAIN'].includes(attempt.status))throw new OrderError('HANDOVER_RESULT_CONFLICT');return attempt;}
 declareUncertain(ctx:CustomerContext,id:string,b:D.AttemptEvidenceDto){return this.command(ctx,id,'uncertain',b,'shipment.handover',async(s,c,o,fingerprint)=>{const attempt=await this.attempt(s,id,b.attemptId,b.expectedAttemptVersion);const task=await this.assignee(s,id,['SHIPMENT_PROCESS'],b.expectedTaskVersion);const v=await s.tx.handoverVerification.create({data:{orderId:id,attemptId:attempt.id,commandKey:b.commandKey,fingerprint,conclusion:'STILL_UNCERTAIN',reason:b.reason,evidenceNote:b.evidenceNote,actorEmployeeId:task.assigneeId!,requestId:s.requestId,createdAt:this.clock.now()}});await this.bind(s,ctx,'HANDOVER_VERIFICATION',v.id,b.evidenceFileIds,b.commandKey);await this.makeUncertain(s,c,o,attempt,b.reason);return {attemptId:attempt.id,verificationId:v.id};});}
 async timeout(id:string,requestId=randomUUID()){return this.locked({type:'SYSTEM'},id,requestId,async(s,c)=>{const o=await ownedOrder(s.tx,id,s.actor),attempt=await pendingHandover(s.tx,id);if(!attempt||attempt.status!=='IN_PROGRESS')return {changed:false};
  const hasOwner=await s.tx.task.count({where:{...ref(id),stage:'SHIPMENT_PROCESS',status:'CLAIMED'}});if(+this.clock.now()<+attempt.uncertainAfter&&hasOwner)return {changed:false};await this.makeUncertain(s,c,o,attempt,'交运动作超时或经办已回池，需核实真实结果');return {changed:true};});}
 private async makeUncertain(s:TaskTransactionScope,c:TaskEntryContext,o:Order,attempt:HandoverAttempt,reason:string){if(attempt.status==='UNCERTAIN')return;
  await s.tx.handoverAttempt.update({where:{id:attempt.id},data:{status:'UNCERTAIN',version:{increment:1}}});await this.changeStage(s,o,'HANDOVER_UNCERTAIN','uncertain:'+attempt.id,reason);
  await this.timer.addBlock(c,o.id,{sourceType:'HANDOVER_UNCERTAIN',sourceId:attempt.id},{commandKey:'uncertain:'+attempt.id,reason});
  await this.stopShipping(s,c,o.id,'SUSPENDED','uncertain:'+attempt.id,reason);
  await this.sources.attach(c,{...ref(o.id),stage:'HANDOVER_VERIFY',sourceType:'HANDOVER_UNCERTAIN',sourceId:attempt.id,entryKey:'uncertain:'+attempt.id,reason});await this.event(s,o.id,'UNCERTAIN',reason,attempt.id);
 }
 resolve(ctx:CustomerContext,id:string,b:D.ResolveHandoverDto){return this.command(ctx,id,'resolve',b,'shipment.handover',async(s,c,o,f)=>{
  const attempt=await this.attempt(s,id,b.attemptId,b.expectedAttemptVersion);if(attempt.status!=='UNCERTAIN')throw new OrderError('HANDOVER_VERIFICATION_REQUIRED');await this.assignee(s,id,['HANDOVER_VERIFY'],b.expectedTaskVersion);
  if(b.conclusion==='HANDED_OVER'){if(!b.actualHandoverAt)throw new OrderError('VALIDATION_FAILED');return this.handedOver(s,c,ctx,o,attempt,b,new Date(b.actualHandoverAt),f,true);}
  if(b.actualHandoverAt!==undefined)throw new OrderError('VALIDATION_FAILED');let items:ReturnType<typeof checkWholeOrder>|undefined;
  if(b.conclusion==='NOT_HANDED_OVER'){if(!b.goodsLocation||!b.items||b.expectedPhysicalVersion!==o.stockPhysicalVersion)throw new OrderError('PHYSICAL_CHECK_STALE');items=checkWholeOrder(await s.tx.orderItem.findMany({where:{orderId:id}}),b.items);}
  const a=requireOrderPermission(s.actor,'shipment.handover'),now=this.clock.now();
  const v=await s.tx.handoverVerification.create({data:{orderId:id,attemptId:attempt.id,commandKey:b.commandKey,fingerprint:f,conclusion:b.conclusion,goodsLocation:b.goodsLocation,checkedItems:items,physicalVersion:b.expectedPhysicalVersion,reason:b.reason,evidenceNote:b.evidenceNote,actorEmployeeId:a.subjectId,requestId:s.requestId,createdAt:now}});await this.bind(s,ctx,'HANDOVER_VERIFICATION',v.id,b.evidenceFileIds,b.commandKey);
  if(b.conclusion==='NOT_HANDED_OVER'){
   await s.tx.handoverAttempt.update({where:{id:attempt.id},data:{status:'NOT_HANDED_OVER',resolvedAt:now,resolvedById:a.subjectId,resolutionReason:b.reason,version:{increment:1}}});
   const p=await validPacking(s.tx,o),unchanged=!!p&&p.goodsLocation===b.goodsLocation;
   await this.changeStage(s,o,unchanged?'READY':'UNCLAIMED',b.commandKey,b.reason,unchanged?{}:{stockPhysicalVersion:{increment:1}});
   await this.timer.releaseBlock(c,id,{sourceType:'HANDOVER_UNCERTAIN',sourceId:attempt.id},{commandKey:'resolve:'+b.commandKey,reason:b.reason});
   await this.finishSource(s,c,id,'HANDOVER_UNCERTAIN',attempt.id,b.commandKey,b.reason,true);
   await this.stopShipping(s,c,id,'CANCELLED','resolve:'+b.commandKey,'未交运核实已结案，原轮结束，重新领取');await this.resumeShipping(s,c,id,b.commandKey,b.reason);
  }
  await this.event(s,id,'RESOLVE',b.reason,v.id);return {attemptId:attempt.id,verificationId:v.id,conclusion:b.conclusion};
 });}
 private async handedOver(s:TaskTransactionScope,c:TaskEntryContext,ctx:CustomerContext,o:Order,attempt:HandoverAttempt,b:D.ConfirmHandoverDto|D.ResolveHandoverDto,actual:Date,fingerprint:string,verified:boolean){
  const a=requireOrderPermission(s.actor,'shipment.handover'),now=this.clock.now();if(o.status!=='WAIT_SHIPMENT'||o.actualHandoverAt)throw new OrderError('ORDER_ALREADY_SHIPPED');
  if(!Number.isFinite(+actual)||+actual>+now||!o.paidAt||+actual<+o.paidAt||(!verified&&+actual<+attempt.startedAt))throw new OrderError('VALIDATION_FAILED');
  const evidence='evidenceNote' in b?b.evidenceNote:undefined;if(+actual<+attempt.startedAt&&!evidence)throw new OrderError('VALIDATION_FAILED');
  const v=await s.tx.handoverVerification.create({data:{orderId:o.id,attemptId:attempt.id,commandKey:b.commandKey,fingerprint,conclusion:'HANDED_OVER',actualHandoverAt:actual,reason:b.reason,evidenceNote:evidence,actorEmployeeId:a.subjectId,requestId:s.requestId,createdAt:now}});
  await this.bind(s,ctx,'HANDOVER_VERIFICATION',v.id,'evidenceFileIds' in b?b.evidenceFileIds:undefined,b.commandKey);
  await s.tx.handoverAttempt.update({where:{id:attempt.id},data:{status:'HANDED_OVER',resolvedAt:now,resolvedById:a.subjectId,actualHandoverAt:actual,procedureViolation:+actual<+attempt.startedAt,resolutionReason:b.reason,version:{increment:1}}});
  await s.tx.shipment.update({where:{id:attempt.shipmentId},data:{status:'CONFIRMED',confirmedAttemptId:attempt.id,confirmedById:a.subjectId,actualHandoverAt:actual,version:{increment:1},updatedAt:now}});
  if(verified)await this.timer.releaseBlock(c,o.id,{sourceType:'HANDOVER_UNCERTAIN',sourceId:attempt.id},{commandKey:'resolve:'+b.commandKey,reason:b.reason});
  const setting=await this.settings.requireCurrent(s.tx);await s.tx.order.update({where:{id:o.id},data:{autoReceiptDays:setting.autoReceiptDays,receiptSettingVersionId:setting.id}});
  await this.timer.recordActualHandover(c,o.id,actual,{commandKey:'handover:'+b.commandKey,reason:b.reason});
  await s.tx.order.update({where:{id:o.id},data:{version:{increment:1},updatedAt:now}});
  await this.history.appendStateHistory(s.tx,taskAuditActor(a),{aggregateType:'ORDER',aggregateId:o.id,dimension:'status',fromState:'WAIT_SHIPMENT',toState:'SHIPPED',commandKey:b.commandKey,reason:b.reason,requestId:s.requestId,publicText:'包裹已实际交运，可查看运单'});
  await this.history.appendStateHistory(s.tx,taskAuditActor(a),{aggregateType:'ORDER',aggregateId:o.id,dimension:'fulfillment',fromState:o.fulfillmentStage,toState:'SHIPPED',commandKey:b.commandKey,reason:b.reason,requestId:s.requestId});
  await this.stopShipping(s,c,o.id,verified?'CANCELLED':'COMPLETED',b.commandKey,'真实交运事实已登记，结束原发货轮');
  if(verified)await this.finishSource(s,c,o.id,'HANDOVER_UNCERTAIN',attempt.id,b.commandKey,b.reason,true);
  await this.event(s,o.id,'CONFIRM',b.reason,attempt.id);return {attemptId:attempt.id,shipmentId:attempt.shipmentId,verificationId:v.id,conclusion:'HANDED_OVER'};
 }
 private async stopShipping(s:TaskTransactionScope,c:TaskEntryContext,id:string,action:'SUSPENDED'|'CANCELLED'|'COMPLETED',key:string,reason:string){const task=await s.tx.task.findFirst({where:{...ref(id),stage:'SHIPMENT_PROCESS',status:{in:activeStatuses}}});if(!task||action==='SUSPENDED'&&task.status==='SUSPENDED')return;await this.lifecycle.transition(c,{...ref(id),taskId:task.id,expectedVersion:task.version,action,commandKey:key,reason});}
 private async finishSource(s:TaskTransactionScope,c:TaskEntryContext,id:string,type:'HANDOVER_UNCERTAIN'|'SHIPMENT_EXCEPTION',sourceId:string,key:string,reason:string,complete=false){
  const tasks=await s.tx.task.findMany({where:{...ref(id),status:{in:activeStatuses}},orderBy:{id:'asc'}});for(const task of tasks){if(!await s.tx.taskBusinessSource.count({where:{taskId:task.id,sourceType:type,sourceId,status:'ACTIVE'}}))continue;
   const input={...ref(id),taskId:task.id,expectedVersion:task.version,sourceType:type,sourceId,commandKey:key,reason};if(complete)await this.sources.resolve(c,input);else await this.sources.cancel(c,input);
  }
 }
 /** 统一放行只处理履约，绝不把未知、已完成或退款的订单恢复。后续售后结案同事务调用此端口。 */
 async resumeShipping(s:TaskTransactionScope,c:TaskEntryContext,id:string,key:string,reason:string,forceUnclaimed=false){const o=await s.tx.order.findUniqueOrThrow({where:{id}});
  if(o.status!=='WAIT_SHIPMENT'||await pendingHandover(s.tx,id)||await shipmentBlocked(s.tx,id)||await this.afterSales.hasActive(s.tx,id))return;
  const prior=await s.tx.task.findFirst({where:{...ref(id),stage:'SHIPMENT_PROCESS',status:{in:activeStatuses}}});if(prior?.status!=='SUSPENDED'&&prior)return;
  if(prior)await this.stopShipping(s,c,id,'CANCELLED','resume:'+key,'暂停来源结案，原轮结束，经办不继承');
  const p=await validPacking(s.tx,o),shipment=await s.tx.shipment.findUnique({where:{orderId:id}});
  const stage=!forceUnclaimed&&p&&shipment?'READY':'UNCLAIMED';if(o.fulfillmentStage!==stage)await this.changeStage(s,o,stage,'resume:'+key,reason);
  await this.entry.enterStage(c,{...ref(id),stage:'SHIPMENT_PROCESS',entryKey:'resume:'+key,reason});
 }
 exception(ctx:CustomerContext,id:string,b:D.ShipmentExceptionDto){return this.command(ctx,id,'exception',b,'shipment.exception.manage',async(s,c,o,fingerprint)=>{
  if(!['WAIT_SHIPMENT','SHIPPED'].includes(o.status))throw new OrderError('ORDER_NOT_READY_TO_SHIP');if(o.status==='WAIT_SHIPMENT')await this.assignee(s,id,['SHIPMENT_PROCESS','HANDOVER_VERIFY','SHIPMENT_EXCEPTION_VERIFY'],b.expectedTaskVersion);
  const items=await s.tx.orderItem.findMany({where:{orderId:id},select:{id:true}});if(new Set(b.orderItemIds).size!==b.orderItemIds.length||b.orderItemIds.some(item=>!items.some(i=>i.id===item)))throw new OrderError('VALIDATION_FAILED');
  if(b.stockIncidentId&&!await s.tx.stockIncidentItem.count({where:{incidentId:b.stockIncidentId,orderItem:{orderId:id}}}))throw new OrderError('STOCK_INCIDENT_CONFLICT');
  const existing=await s.tx.shipmentException.findUnique({where:{incidentKey:b.incidentKey}});if(existing)throw new OrderError('COMMAND_PAYLOAD_CONFLICT');const a=requireOrderPermission(s.actor,'shipment.exception.manage'),now=this.clock.now();
  const row=await s.tx.shipmentException.create({data:{orderId:id,type:b.type,incidentKey:b.incidentKey,fingerprint,reason:b.reason,evidenceNote:b.evidenceNote,goodsLocation:b.goodsLocation,orderItemIds:[...b.orderItemIds].sort(),physicalVersionAtOpen:o.stockPhysicalVersion+1,stockIncidentId:b.stockIncidentId,createdById:a.subjectId,createdAt:now}});
  await s.tx.order.update({where:{id},data:{stockPhysicalVersion:{increment:1},version:{increment:1},updatedAt:now}});await this.bind(s,ctx,'SHIPMENT_EXCEPTION',row.id,b.evidenceFileIds,b.commandKey);
  await this.timer.addBlock(c,id,{sourceType:'SHIPMENT_EXCEPTION',sourceId:row.id},{commandKey:'exception:'+b.commandKey,reason:b.reason});
  const attempt=await pendingHandover(s.tx,id);if(attempt?.status==='IN_PROGRESS')await this.makeUncertain(s,c,await s.tx.order.findUniqueOrThrow({where:{id}}),attempt,'交运期间发生异常，需独立核实事实');
  else if(o.status==='WAIT_SHIPMENT')await this.stopShipping(s,c,id,'SUSPENDED',b.commandKey,b.reason);
  for(const stage of ['SHIPMENT_EXCEPTION_VERIFY','CUSTOMER_CONTACT'] as const)await this.sources.attach(c,{...ref(id),stage,sourceType:'SHIPMENT_EXCEPTION',sourceId:row.id,entryKey:'exception:'+row.id,reason:b.reason});
  await this.event(s,id,'EXCEPTION',b.reason,row.id);return {exceptionId:row.id};
 });}
 warehouseReady(ctx:CustomerContext,id:string,exceptionId:string,b:D.WarehouseReadyDto){return this.decision(ctx,id,exceptionId,b,'WAREHOUSE_READY');}
 customerChoice(ctx:CustomerContext,id:string,exceptionId:string,b:D.CustomerConfirmationDto){return this.decision(ctx,id,exceptionId,b,'CUSTOMER_'+b.choice as 'CUSTOMER_WAIT'|'CUSTOMER_CONTINUE'|'CUSTOMER_REQUEST_REFUND');}
 private decision(ctx:CustomerContext,id:string,exceptionId:string,b:D.ExceptionCommandDto|D.WarehouseReadyDto|D.CustomerConfirmationDto,kind:'WAREHOUSE_READY'|'CUSTOMER_WAIT'|'CUSTOMER_CONTINUE'|'CUSTOMER_REQUEST_REFUND'){
  return this.command(ctx,id,'decision:'+exceptionId,b,kind==='WAREHOUSE_READY'?'shipment.exception.manage':'shipment.customer-confirm',async(s,_c,o)=>{
   const row=await s.tx.shipmentException.findUnique({where:{id:exceptionId}});if(!row||row.orderId!==id)throw new OrderError('SHIPMENT_EXCEPTION_NOT_FOUND');if(row.status!=='OPEN')throw new OrderError('SHIPMENT_EXCEPTION_UNRESOLVED');
   if(row.version!==b.expectedExceptionVersion)throw new OrderError('VERSION_CONFLICT');if(o.stockPhysicalVersion!==b.currentPhysicalVersion)throw new OrderError('PHYSICAL_CHECK_STALE');
   const a=requireOrderPermission(s.actor,kind==='WAREHOUSE_READY'?'shipment.exception.manage':'shipment.customer-confirm');await this.assignee(s,id,[kind==='WAREHOUSE_READY'?'SHIPMENT_EXCEPTION_VERIFY':'CUSTOMER_CONTACT'],b.expectedTaskVersion);
   if(kind==='WAREHOUSE_READY'){
    if(!('items' in b)||!('goodsLocation' in b))throw new OrderError('VALIDATION_FAILED');const items=checkWholeOrder(await s.tx.orderItem.findMany({where:{orderId:id}}),b.items);
    if((await currentDamage(s.tx,id)).some(l=>l.unknown||l.damaged>0))throw new OrderError('ORDER_STOCK_BLOCKED');
    await s.tx.shipmentException.update({where:{id:exceptionId},data:{currentVerifiedPhysicalVersion:o.stockPhysicalVersion,goodsLocation:b.goodsLocation}});
    const fulfillment=await s.tx.fulfillment.upsert({where:{orderId:id},create:{orderId:id},update:{}});await s.tx.packingCheck.create({data:{orderId:id,fulfillmentId:fulfillment.id,checkedPhysicalVersion:o.stockPhysicalVersion,checkedItems:items,goodsLocation:b.goodsLocation,checkedById:a.subjectId,commandKey:b.commandKey,createdAt:this.clock.now()}});
   }else{requireOrderPermission(s.actor,'communication.service.write');await this.communications.appendCommunication(s.tx,{identity:a,token:ctx.token},{scopeType:'ORDER',scopeId:id,channel:'OTHER',occurredAt:new Date(),result:b.evidenceNote,nextStep:kind==='CUSTOMER_REQUEST_REFUND'?'仅记录退款意愿，待正式售后接入或人工跟进':'按异常双确认与实物版本规则跟进',requestId:s.requestId});}
   const lastDecision=await s.tx.shipmentExceptionDecision.findFirst({where:{exceptionId},orderBy:{createdAt:'desc'}});
   // 同毫秒内的串行意见仍须有稳定先后，避免UUID排序把旧WAIT当成最新意见。
   const recordedAt=new Date(Math.max(+this.clock.now(),lastDecision?+lastDecision.createdAt+1:0));
   const decision=await s.tx.shipmentExceptionDecision.create({data:{exceptionId,kind,physicalVersion:o.stockPhysicalVersion,description:b.evidenceNote,actorEmployeeId:a.subjectId,commandKey:b.commandKey,requestId:s.requestId,createdAt:recordedAt}});
   await s.tx.shipmentException.update({where:{id:exceptionId},data:{version:{increment:1}}});await s.tx.order.update({where:{id},data:{version:{increment:1},updatedAt:this.clock.now()}});await this.bind(s,ctx,'SHIPMENT_EXCEPTION_DECISION',decision.id,b.evidenceFileIds,b.commandKey);
   await this.event(s,id,kind,b.reason,exceptionId);return {exceptionId};
  });
 }
 private async tryReleaseException(s:TaskTransactionScope,c:TaskEntryContext,id:string,exceptionId:string,key:string,reason:string){const o=await s.tx.order.findUniqueOrThrow({where:{id}}),row=await s.tx.shipmentException.findUniqueOrThrow({where:{id:exceptionId}});
  const warehouse=await s.tx.shipmentExceptionDecision.findFirst({where:{exceptionId,kind:'WAREHOUSE_READY'},orderBy:[{createdAt:'desc'},{id:'desc'}]}),customer=await s.tx.shipmentExceptionDecision.findFirst({where:{exceptionId,kind:{startsWith:'CUSTOMER_'}},orderBy:[{createdAt:'desc'},{id:'desc'}]});
  if(row.currentVerifiedPhysicalVersion!==o.stockPhysicalVersion||warehouse?.physicalVersion!==o.stockPhysicalVersion||customer?.kind!=='CUSTOMER_CONTINUE'||customer.physicalVersion!==o.stockPhysicalVersion||await pendingHandover(s.tx,id))return false;
  await s.tx.shipmentException.update({where:{id:exceptionId},data:{status:'RESOLVED',resolvedAt:this.clock.now(),version:{increment:1}}});
  await this.timer.releaseBlock(c,id,{sourceType:'SHIPMENT_EXCEPTION',sourceId:exceptionId},{commandKey:'release:'+key,reason});
  await this.finishSource(s,c,id,'SHIPMENT_EXCEPTION',exceptionId,key,'本异常双确认完成，结束本来源跟进');await this.event(s,id,'RELEASE_EXCEPTION',reason,exceptionId);await this.resumeShipping(s,c,id,key,reason);return true;
 }
 resolveException(ctx:CustomerContext,id:string,exceptionId:string,b:D.ExceptionCommandDto){return this.command(ctx,id,'resolve-ex:'+exceptionId,b,'shipment.exception.manage',async(s,c,o)=>{const e=await s.tx.shipmentException.findUnique({where:{id:exceptionId}});if(!e||e.orderId!==id)throw new OrderError('SHIPMENT_EXCEPTION_NOT_FOUND');if(e.status!=='OPEN'||e.version!==b.expectedExceptionVersion)throw new OrderError('VERSION_CONFLICT');if(o.stockPhysicalVersion!==b.currentPhysicalVersion)throw new OrderError('PHYSICAL_CHECK_STALE');await this.assignee(s,id,['SHIPMENT_EXCEPTION_VERIFY'],b.expectedTaskVersion);if(!await this.tryReleaseException(s,c,id,exceptionId,b.commandKey,b.reason))throw new OrderError('SHIPMENT_EXCEPTION_UNRESOLVED');const a=requireOrderPermission(s.actor,'shipment.exception.manage');const decision=await s.tx.shipmentExceptionDecision.create({data:{exceptionId,kind:'RESOLUTION',physicalVersion:o.stockPhysicalVersion,description:b.evidenceNote,actorEmployeeId:a.subjectId,commandKey:b.commandKey,requestId:s.requestId,createdAt:this.clock.now()}});await this.bind(s,ctx,'SHIPMENT_EXCEPTION_DECISION',decision.id,b.evidenceFileIds,b.commandKey);return {exceptionId};});}
 async stockBlocked(c:TaskEntryContext,id:string,key:string,reason:string){return this.entry.inContext(c,ref(id),async s=>{const o=await ownedOrder(s.tx,id,s.actor);if(o.status!=='WAIT_SHIPMENT')return;const attempt=await pendingHandover(s.tx,id);if(attempt?.status==='IN_PROGRESS')await this.makeUncertain(s,c,o,attempt,reason);else await this.stopShipping(s,c,id,'SUSPENDED',key,reason);});}
 async stockReleased(c:TaskEntryContext,id:string,key:string,reason:string){return this.entry.inContext(c,ref(id),s=>this.resumeShipping(s,c,id,key,reason));}
 private async revision(s:TaskTransactionScope,ctx:CustomerContext,old:{id:string;orderId:string;carrierName:string;trackingNumber:string},b:D.PrepareShipmentDto|D.TrackingCorrectionDto,historical:boolean){
  const a=s.actor;if(a.subjectType!=='EMPLOYEE')throw new OrderError('VALIDATION_FAILED');
  const r=await s.tx.shipmentTrackingRevision.create({data:{orderId:old.orderId,shipmentId:old.id,oldCarrier:old.carrierName,oldTracking:old.trackingNumber,newCarrier:b.carrierName,newTracking:b.trackingNumber,reason:b.reason,evidenceNote:'evidenceNote' in b?b.evidenceNote:undefined,actorEmployeeId:a.subjectId,historical,commandKey:b.commandKey,requestId:s.requestId,createdAt:this.clock.now()}});
  await this.bind(s,ctx,'SHIPMENT_TRACKING_REVISION',r.id,'evidenceFileIds' in b?b.evidenceFileIds:undefined,b.commandKey);return r;
 }
 correctTracking(ctx:CustomerContext,id:string,b:D.TrackingCorrectionDto,historical=false){return this.command(ctx,id,historical?'history-tracking':'tracking',b,historical?'shipment.history.correct':'shipment.tracking.correct',async(s,_c,o)=>{
  const a=requireOrderPermission(s.actor,historical?'shipment.history.correct':'shipment.tracking.correct');if(await pendingHandover(s.tx,id))throw new OrderError('TRACKING_CHANGE_BLOCKED');
  if(historical?(a.role!=='SUPER_ADMIN'||!['COMPLETED','REFUNDED'].includes(o.status)||!b.evidenceNote):!['WAIT_SHIPMENT','SHIPPED'].includes(o.status))throw new OrderError('TRACKING_CHANGE_BLOCKED');
  const shipment=await s.tx.shipment.findUnique({where:{orderId:id}});if(!shipment)throw new OrderError('TRACKING_CHANGE_BLOCKED');let revisionId:string|undefined;
  if(shipment.carrierName!==b.carrierName||shipment.trackingNumber!==b.trackingNumber){revisionId=(await this.revision(s,ctx,shipment,b,historical)).id;await s.tx.shipment.update({where:{id:shipment.id},data:{carrierName:b.carrierName,trackingNumber:b.trackingNumber,version:{increment:1},updatedAt:this.clock.now()}});await s.tx.order.update({where:{id},data:{version:{increment:1},updatedAt:this.clock.now()}});}
  await this.event(s,id,'TRACKING',b.reason,revisionId??shipment.id);return {shipmentId:shipment.id,...(revisionId?{revisionId}:{})};
 });}
 confirmReceipt(ctx:CustomerContext,id:string){if(ctx.actor.subjectType!=='CUSTOMER')throw new OrderError('ORDER_NOT_FOUND');return this.receipt(this.access(ctx),id,ctx.requestId);}
 autoReceipt(id:string,requestId=randomUUID()){return this.receipt({type:'SYSTEM'},id,requestId);}
 private receipt(access:TaskActorAccess,id:string,requestId:string){return this.locked(access,id,requestId,async(s,c)=>{
  const o=await ownedOrder(s.tx,id,s.actor);if(o.status==='COMPLETED')return {orderId:id,orderStatus:o.status,completedAt:o.completedAt,afterSaleDeadline:o.afterSaleDeadline,receiptSource:o.receiptSource,replayed:true};
  if(o.status!=='SHIPPED'||!o.actualHandoverAt||!await s.tx.shipment.count({where:{orderId:id,status:'CONFIRMED'}})){if(s.actor.subjectType==='SYSTEM')return {orderId:id,skipped:true};throw new OrderError('ORDER_NOT_RECEIVABLE');}
  if(await s.tx.orderBlock.count({where:{orderId:id,active:true,blocksReceipt:true}})||await this.afterSales.hasActive(s.tx,id)){if(s.actor.subjectType==='SYSTEM')return {orderId:id,skipped:true};throw new OrderError('RECEIPT_BLOCKED');}
  if(s.actor.subjectType==='SYSTEM'&&(!o.autoReceiptDueAt||+this.clock.now()<+o.autoReceiptDueAt))return {orderId:id,skipped:true};
  const setting=await this.settings.requireCurrent(s.tx);await s.revalidate();const now=this.clock.now(),deadline=calculateDeadline(now,{unit:'NATURAL_DAY',amount:setting.afterSaleWindowDays}),source=s.actor.subjectType==='SYSTEM'?'SYSTEM':'CUSTOMER',reason=source==='SYSTEM'?'生效自动收货截止已到，系统确认收货':'顾客主动确认收货';
  await this.timer.finishOrderTimer(c,id,'COMPLETED',{commandKey:'receipt:'+id,reason});
  const updated=await s.tx.order.update({where:{id},data:{status:'COMPLETED',completedAt:now,afterSaleDeadline:deadline,receiptSource:source,completionSettingVersionId:setting.id,afterSaleRuleSnapshot:{unit:'NATURAL_DAY',amount:setting.afterSaleWindowDays,versionNumber:setting.versionNumber,timeZone:BUSINESS_TIME_ZONE,algorithmVersion:DEADLINE_ALGORITHM_VERSION},version:{increment:1},updatedAt:now}});
  await this.history.appendStateHistory(s.tx,taskAuditActor(s.actor),{aggregateType:'ORDER',aggregateId:id,dimension:'status',fromState:'SHIPPED',toState:'COMPLETED',commandKey:'receipt:'+id,reason,requestId,publicText:source==='SYSTEM'?'订单已自动确认收货':'顾客已确认收货'});
  await this.audit.appendAudit(s.tx,{actor:taskAuditActor(s.actor),action:'order.receipt',targetId:id,requestId,reason,after:{orderStatus:'COMPLETED',orderVersion:updated.version,receiptSource:source,dueAt:deadline.toISOString()}});
  return {orderId:id,orderStatus:'COMPLETED',completedAt:now,afterSaleDeadline:deadline,receiptSource:source,replayed:false};
 });}
}
