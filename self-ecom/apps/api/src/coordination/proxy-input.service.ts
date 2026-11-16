// 作用：冻结顾客单动作核实、显式领单与员工代录同事务；重放不重复消费。
import {Inject,Injectable,type OnModuleInit} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import type {Prisma,ProxyContext,ProxyExecution} from '@prisma/client';
import {APP_CONFIG,type EnvironmentConfig} from '../config/environment.js';
import {AfterSaleService,type ResultReference} from '../after-sales/after-sale.service.js';
import {ownedSale} from '../after-sales/after-sale.access.js';
import {orderRef,saleRef} from '../after-sales/after-sale.rules.js';
import type {CustomerContext} from '../customers/customer-access.service.js';
import {commandFingerprint} from '../common/command-fingerprint.js';
import {Clock} from '../common/time/clock.js';
import {PrismaService} from '../prisma/prisma.service.js';
import {TaskEntryService,type TaskEntryContext,type TaskTransactionScope} from '../tasks/task-entry.service.js';
import {TaskSourceService} from '../tasks/task-source.service.js';
import {isTaskEligible} from '../tasks/task-access.service.js';
import {AuditService} from '../audit/audit.service.js';
import {FileBusinessAdapters} from '../files/file-business-adapters.js';
import {FileError} from '../files/file.errors.js';
import {OfflineCaseService} from './offline-case.service.js';
import {assertProxyContext,ProxyError,proxyPermission,type ProxyAction} from './proxy.rules.js';
import type * as D from './proxy.dto.js';
import type * as A from '../after-sales/after-sale.dto.js';
import {CustomerStatusEffects} from '../customers/customer-status-effects.js';
import {TaskIdentityEffects} from '../tasks/task-identity-effects.js';

const active={status:{in:['OPEN','CLAIMED','SUSPENDED'] as ('OPEN'|'CLAIMED'|'SUSPENDED')[]}};
@Injectable()
export class ProxyInputService implements OnModuleInit {
 private readonly instanceId=randomUUID();
 constructor(@Inject(PrismaService)private readonly db:PrismaService,@Inject(AfterSaleService)private readonly sales:AfterSaleService,
 @Inject(TaskEntryService)private readonly entry:TaskEntryService,@Inject(TaskSourceService)private readonly sources:TaskSourceService,
 @Inject(Clock)private readonly clock:Clock,@Inject(AuditService)private readonly audit:AuditService,
 @Inject(FileBusinessAdapters)private readonly files:FileBusinessAdapters,@Inject(OfflineCaseService)private readonly offline:OfflineCaseService,
 @Inject(CustomerStatusEffects)private readonly customerEffects:CustomerStatusEffects,@Inject(TaskIdentityEffects)private readonly employeeEffects:TaskIdentityEffects,
 @Inject(APP_CONFIG)private readonly config:EnvironmentConfig){}
 private access(ctx:CustomerContext){return {type:ctx.actor.subjectType,subjectId:ctx.actor.subjectId,token:ctx.token};}
 private fingerprint(ctx:CustomerContext,action:string,body:object){return commandFingerprint({command:'proxy.'+action.toLowerCase().replaceAll('_','-'),version:1,actor:{type:ctx.actor.subjectType,id:ctx.actor.subjectId},payload:JSON.parse(JSON.stringify(body))});}
 private async auditChange(s:TaskTransactionScope,id:string,action:string,orderId:string,reason=action){await this.audit.appendAudit(s.tx,{actor:s.actor.subjectType==='EMPLOYEE'?{type:'EMPLOYEE',id:s.actor.subjectId}:{type:'SYSTEM'},action:'coordination.change',targetId:id,requestId:s.requestId,reason,after:{coordinationAction:action.toLowerCase().replaceAll('_','-'),orderId,proxyContextId:id}});}
 private async summary(tx:Prisma.TransactionClient,p:ProxyContext,replayed=false){const task=await tx.task.findFirst({where:{...orderRef(p.orderId),stage:'PROXY_INPUT',...active}});return {proxyContextId:p.id,customerId:p.customerId,orderId:p.orderId,action:p.action,status:p.status,expiresAt:p.expiresAt,verifiedAt:p.verifiedAt,afterSaleId:p.afterSaleId,parcelId:p.parcelId,supplementRequestId:p.supplementRequestId,offlineCaseId:p.offlineCaseId,taskId:task?.id??null,taskVersion:task?.version??null,replayed};}
 create(ctx:CustomerContext,customerId:string,b:D.CreateProxyContextDto){const fingerprint=this.fingerprint(ctx,'create',b);return this.sales.run(tx=>this.entry.withContext(tx,this.access(ctx),[orderRef(b.orderId)],ctx.requestId,c=>this.entry.inContext(c,orderRef(b.orderId),async s=>{
  const actor=proxyPermission(s.actor),o=await tx.order.findUniqueOrThrow({where:{id:b.orderId}});if(o.customerId!==customerId)throw new ProxyError('PROXY_CONTEXT_NOT_FOUND');
  const prior=await tx.coordinationCommandResult.findUnique({where:{orderId_action_commandKey:{orderId:o.id,action:'proxy-context-create',commandKey:b.commandKey}}});
  if(prior){if(prior.fingerprint!==fingerprint)throw new ProxyError('COMMAND_PAYLOAD_CONFLICT');const p=await tx.proxyContext.findUniqueOrThrow({where:{id:prior.resultId}});if(p.verifiedById!==actor.subjectId)throw new ProxyError('PROXY_CONTEXT_NOT_FOUND');return this.summary(tx,p,true);}
  const customer=await tx.customer.findUniqueOrThrow({where:{id:customerId}});if(customer.status!=='LOGIN_FROZEN'||customer.statusVersion!==b.expectedCustomerStatusVersion)throw new ProxyError('CUSTOMER_STATUS_CHANGED');if(o.version!==b.expectedOrderVersion)throw new ProxyError('VERSION_CONFLICT');
  await this.assertTargets(tx,o.id,b);
  const comm=await tx.communication.findUnique({where:{id:b.sourceCommunicationId}});if(!comm||!(comm.scopeType==='ORDER'&&comm.scopeId===o.id||comm.scopeType==='AFTER_SALE'&&await tx.afterSale.count({where:{id:comm.scopeId,orderId:o.id}})))throw new ProxyError('PROXY_CONTEXT_MISMATCH');
  const now=this.clock.now(),p=await tx.proxyContext.create({data:{customerId,orderId:o.id,afterSaleId:b.afterSaleId,parcelId:b.parcelId,supplementRequestId:b.supplementRequestId,offlineCaseId:b.offlineCaseId,action:b.action,customerStatusVersion:customer.statusVersion,verifiedById:actor.subjectId,verifiedAt:now,method:b.method,verificationSummary:b.verificationSummary,sourceCommunicationId:comm.id,expiresAt:new Date(+now+30*60000),createdAt:now}});
  await this.sources.attach(c,{...orderRef(o.id),stage:'PROXY_INPUT',sourceType:'PROXY_CONTEXT',sourceId:p.id,entryKey:'proxy:'+p.id,reason:'人工核实后等待本人显式领取指定顾客输入'});
  await tx.coordinationCommandResult.create({data:{orderId:o.id,action:'proxy-context-create',commandKey:b.commandKey,fingerprint,resultType:'PROXY_CONTEXT',resultId:p.id,createdAt:now}});await s.revalidate();await this.auditChange(s,p.id,'proxy-context-create',o.id,b.reason);return this.summary(tx,p);
 })));}
 private async assertTargets(tx:Prisma.TransactionClient,orderId:string,b:Pick<D.CreateProxyContextDto,'action'|'afterSaleId'|'parcelId'|'supplementRequestId'|'offlineCaseId'>){
  if(b.action==='APPLY_AFTER_SALE'){if(b.afterSaleId||b.parcelId||b.supplementRequestId||b.offlineCaseId)throw new ProxyError('PROXY_CONTEXT_MISMATCH');return;}
  if(b.action==='OFFLINE_RESULT'){if(!b.offlineCaseId||b.parcelId||b.supplementRequestId||!await tx.offlineCase.count({where:{id:b.offlineCaseId,orderId,...(b.afterSaleId?{afterSaleId:b.afterSaleId}:{})}}))throw new ProxyError('PROXY_CONTEXT_MISMATCH');return;}
  if(!b.afterSaleId||b.offlineCaseId||!await tx.afterSale.count({where:{id:b.afterSaleId,orderId}}))throw new ProxyError('PROXY_CONTEXT_MISMATCH');
  if(b.action==='SUPPLEMENT'){if(b.parcelId||!b.supplementRequestId||!await tx.afterSaleSupplementRequest.count({where:{id:b.supplementRequestId,afterSaleId:b.afterSaleId,respondedAt:null,closedAt:null}}))throw new ProxyError('PROXY_CONTEXT_MISMATCH');}
  else if(b.action==='RETURN_LOGISTICS'){if(b.supplementRequestId||b.parcelId&&!await tx.returnParcel.count({where:{id:b.parcelId,afterSaleId:b.afterSaleId}}))throw new ProxyError('PROXY_CONTEXT_MISMATCH');}
  else throw new ProxyError('VALIDATION_FAILED');
 }
 get(ctx:CustomerContext,id:string){return this.sales.run(async tx=>{const located=await tx.proxyContext.findUnique({where:{id}});if(!located)throw new ProxyError('PROXY_CONTEXT_NOT_FOUND');return this.entry.withContext(tx,this.access(ctx),[orderRef(located.orderId)],ctx.requestId,c=>this.entry.inContext(c,orderRef(located.orderId),async s=>{const a=proxyPermission(s.actor),p=await tx.proxyContext.findUniqueOrThrow({where:{id}});if(p.verifiedById!==a.subjectId&&a.role!=='SUPER_ADMIN')throw new ProxyError('PROXY_CONTEXT_NOT_FOUND');return {...await this.summary(tx,p),method:p.method,verificationSummary:p.verificationSummary,sourceCommunicationId:p.sourceCommunicationId,invalidatedReason:p.invalidatedReason};}));});}
 private async task(s:TaskTransactionScope,p:ProxyContext,version:number){const actor=proxyPermission(s.actor),t=await s.tx.task.findFirst({where:{...orderRef(p.orderId),stage:'PROXY_INPUT',...active}});if(!t||t.status!=='CLAIMED'||t.assigneeId!==actor.subjectId||!isTaskEligible(actor,t))throw new ProxyError('TASK_NOT_ASSIGNEE');if(t.version!==version)throw new ProxyError('VERSION_CONFLICT');return t;}
 private async presentExecution(tx:Prisma.TransactionClient,p:ProxyContext,e:ProxyExecution,replayed:boolean){const saleId=e.resultAfterSaleId??p.afterSaleId,sale=saleId?await tx.afterSale.findUnique({where:{id:saleId}}):null;return {proxyContextId:p.id,executionId:e.id,action:p.action,orderId:p.orderId,afterSaleId:sale?.id??null,status:sale?.status??null,version:sale?.version??null,materialVersionId:e.materialVersionId,revisionId:e.parcelRevisionId,offlineEventId:e.offlineEventId,replayed};}
 private execute(ctx:CustomerContext,id:string,action:ProxyAction,b:{commandKey:string;expectedProxyTaskVersion:number},work:(s:TaskTransactionScope,c:TaskEntryContext,p:ProxyContext)=>Promise<ResultReference>){return this.sales.run(tx=>this.executeInTransaction(ctx,tx,id,action,b,work));}
 private async executeInTransaction(ctx:CustomerContext,tx:Prisma.TransactionClient,id:string,action:ProxyAction,b:{commandKey:string;expectedProxyTaskVersion:number},work:(s:TaskTransactionScope,c:TaskEntryContext,p:ProxyContext)=>Promise<ResultReference>){
  const located=await tx.proxyContext.findUnique({where:{id}});if(!located)throw new ProxyError('PROXY_CONTEXT_NOT_FOUND');const refs=[orderRef(located.orderId),...(located.afterSaleId?[saleRef(located.afterSaleId)]:[]),...(located.offlineCaseId?[{businessType:'OFFLINE_CASE' as const,businessId:located.offlineCaseId}]:[])],fingerprint=this.fingerprint(ctx,action,{proxyContextId:id,...b});
  return this.entry.withContext(tx,this.access(ctx),refs,ctx.requestId,c=>this.entry.inContext(c,orderRef(located.orderId),async s=>{
   const actor=proxyPermission(s.actor),p=await tx.proxyContext.findUniqueOrThrow({where:{id}});if(p.verifiedById!==actor.subjectId||p.action!==action)throw new ProxyError('PROXY_CONTEXT_MISMATCH');
   const prior=await tx.proxyExecution.findUnique({where:{actorEmployeeId_orderId_action_commandKey:{actorEmployeeId:actor.subjectId,orderId:p.orderId,action,commandKey:b.commandKey}}});if(prior){if(prior.proxyContextId!==id||prior.fingerprint!==fingerprint)throw new ProxyError('COMMAND_PAYLOAD_CONFLICT');return this.presentExecution(tx,p,prior,true);}
   await assertProxyContext(tx,s.actor,id,action,p.orderId,this.clock.now(),p.afterSaleId??undefined);await this.task(s,p,b.expectedProxyTaskVersion);
   const result=await work(s,c,p);await s.revalidate();
   const e=await tx.proxyExecution.create({data:{proxyContextId:id,actorEmployeeId:actor.subjectId,customerId:p.customerId,orderId:p.orderId,action,commandKey:b.commandKey,fingerprint,resultAfterSaleId:action==='APPLY_AFTER_SALE'?String(result.afterSaleId):null,materialVersionId:action==='SUPPLEMENT'?result.materialVersionId:null,parcelRevisionId:action==='RETURN_LOGISTICS'?result.revisionId:null,offlineEventId:action==='OFFLINE_RESULT'?String(result.offlineEventId):null,requestId:s.requestId,createdAt:this.clock.now()}});
   await tx.proxyContext.update({where:{id},data:{status:'CONSUMED'}});await this.endSource(s,c,p,b.commandKey,'COMPLETED');await this.auditChange(s,id,'proxy-'+action,p.orderId);return this.presentExecution(tx,p,e,false);
  }));
 }
 apply(ctx:CustomerContext,id:string,b:D.ProxyApplyDto){return this.execute(ctx,id,'APPLY_AFTER_SALE',b,(s,_c,p)=>{if(b.orderId!==p.orderId)throw new ProxyError('PROXY_CONTEXT_MISMATCH');const input={orderId:b.orderId,type:b.type,reasonCode:b.reasonCode,description:b.description,evidenceFileIds:b.evidenceFileIds,commandKey:b.commandKey};return this.sales.applyInTransaction(ctx,s.tx,input,{proxyContextId:p.id,representedCustomerId:p.customerId,sourceCommunicationId:p.sourceCommunicationId,assistance:true});});}
 async executeApplyInTransaction(ctx:CustomerContext,tx:Prisma.TransactionClient,id:string,b:A.ApplyAfterSaleDto,expectedProxyTaskVersion:number){const result=await this.executeInTransaction(ctx,tx,id,'APPLY_AFTER_SALE',{...b,expectedProxyTaskVersion},(s,_c,p)=>{if(b.orderId!==p.orderId)throw new ProxyError('PROXY_CONTEXT_MISMATCH');return this.sales.applyInTransaction(ctx,s.tx,b,{proxyContextId:p.id,representedCustomerId:p.customerId,sourceCommunicationId:p.sourceCommunicationId,assistance:true});});if(!result.afterSaleId)throw new Error('代理申请结果缺少真实售后');return {...result,afterSaleId:result.afterSaleId};}
 supplement(ctx:CustomerContext,id:string,b:D.ProxySupplementDto){return this.execute(ctx,id,'SUPPLEMENT',b,async(s,c,p)=>{if(!p.afterSaleId||b.supplementRequestId!==p.supplementRequestId)throw new ProxyError('PROXY_CONTEXT_MISMATCH');const a=await ownedSale(s.tx,p.afterSaleId,s.actor);return this.sales.supplementInContext(s,c,ctx,a,b,{proxyContextId:p.id,representedCustomerId:p.customerId,sourceCommunicationId:p.sourceCommunicationId,assistance:true});});}
 returnLogistics(ctx:CustomerContext,id:string,b:D.ProxyReturnLogisticsDto){return this.execute(ctx,id,'RETURN_LOGISTICS',b,async(s,c,p)=>{if(!p.afterSaleId||(b.parcelId??null)!==p.parcelId)throw new ProxyError('PROXY_CONTEXT_MISMATCH');const a=await ownedSale(s.tx,p.afterSaleId,s.actor);return this.sales.returnLogisticsInContext(s,c,ctx,a,b,{proxyContextId:p.id,representedCustomerId:p.customerId,sourceCommunicationId:p.sourceCommunicationId,assistance:true});});}
 offlineResult(ctx:CustomerContext,id:string,b:D.ProxyOfflineResultDto){return this.execute(ctx,id,'OFFLINE_RESULT',b,async(s,c,p)=>{if(b.offlineCaseId!==p.offlineCaseId)throw new ProxyError('PROXY_CONTEXT_MISMATCH');const event=await this.offline.appendInContext(s,c,b.offlineCaseId,b,ctx.token,p.id);return {offlineEventId:event.id};});}
 private async endSource(s:TaskTransactionScope,c:TaskEntryContext,p:ProxyContext,key:string,outcome:'COMPLETED'|'CANCELLED'){
  const rows=await s.tx.taskBusinessSource.findMany({where:{sourceType:'PROXY_CONTEXT',sourceId:p.id,status:'ACTIVE'}});for(const row of rows){const t=await s.tx.task.findUniqueOrThrow({where:{id:row.taskId}});const input={...orderRef(p.orderId),taskId:t.id,expectedVersion:t.version,sourceType:'PROXY_CONTEXT' as const,sourceId:p.id,commandKey:'proxy-end:'+key,reason:outcome==='COMPLETED'?'本次顾客输入已代录，只结束自身核实来源':'本次核实失效，只结束自身来源'};if(outcome==='COMPLETED')await this.sources.resolve(c,input);else await this.sources.cancel(c,input);}
 }
 async invalidateOrderInContext(s:TaskTransactionScope,c:TaskEntryContext,orderId:string,reason:string,where:Prisma.ProxyContextWhereInput={}){const rows=await s.tx.proxyContext.findMany({where:{orderId,status:'VERIFIED',...where},orderBy:{id:'asc'}});for(const p of rows){await s.tx.proxyContext.update({where:{id:p.id},data:{status:'INVALIDATED',invalidatedReason:reason}});await this.endSource(s,c,p,p.id,'CANCELLED');await this.auditChange(s,p.id,'proxy-context-invalidated',p.orderId,reason);}return rows.length;}
 async expire(batchSize=100){
  if(!Number.isInteger(batchSize)||batchSize<1||batchSize>500)throw new ProxyError('VALIDATION_FAILED');
  const id=randomUUID(),requestId=randomUUID(),jobName='proxy-context-expiry',now=this.clock.now();
  let changed=0,scannedCount=0,failedCount=0,created=false,disconnected=false;
  const guard=new Client({connectionString:this.config.databaseUrl,connectionTimeoutMillis:1000,statement_timeout:1000,query_timeout:1500});guard.on('error',()=>{disconnected=true;});
  try{
   await guard.connect();const lock=await guard.query<{locked:boolean}>('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[jobName]);
   if(!lock.rows[0]?.locked)return {status:'SKIPPED',changed,scannedCount,failedCount};
   await guard.query("UPDATE scheduler_run SET status='ABANDONED',finished_at=GREATEST(started_at,$2) WHERE job_name=$1 AND status='RUNNING'",[jobName,now]);
   await this.db.schedulerRun.create({data:{id,jobName,instanceId:this.instanceId,requestId,startedAt:now}});created=true;
   let cursor:string|undefined;
   for(;;){
    if(disconnected)throw new Error('核实扫描守护连接失效');
    const rows=await this.db.proxyContext.findMany({where:{status:'VERIFIED',expiresAt:{lte:now},...(cursor?{id:{gt:cursor}}:{})},orderBy:{id:'asc'},take:batchSize});if(!rows.length)break;
    for(const p of rows){
     if(disconnected)throw new Error('核实扫描守护连接失效');scannedCount++;
     try{changed+=await this.sales.run(tx=>this.entry.withContext(tx,{type:'SYSTEM'},[orderRef(p.orderId)],requestId,c=>this.entry.inContext(c,orderRef(p.orderId),s=>this.invalidateOrderInContext(s,c,p.orderId,'身份核实已过期',{id:p.id,expiresAt:{lte:now}}))));}
     catch(error){failedCount++;await this.db.schedulerFailure.create({data:{runId:id,errorCode:error instanceof ProxyError?error.code:'PROXY_EXPIRY_FAILED',sanitizedMessage:'核实 '+p.id+' 失效事务未提交，下轮补扫',occurredAt:this.clock.now()}});}
    }
    cursor=rows.at(-1)!.id;
   }
   const status=failedCount?(changed?'PARTIAL_FAILED':'FAILED'):'SUCCEEDED';
   await this.db.schedulerRun.update({where:{id},data:{status,scannedCount,changedCount:changed,failedCount,finishedAt:this.clock.now()}});
   return {id,requestId,status,changed,scannedCount,failedCount};
  }catch(error){
   if(created)await this.db.schedulerRun.updateMany({where:{id,status:'RUNNING'},data:{status:'FAILED',scannedCount,changedCount:changed,failedCount:failedCount+1,finishedAt:this.clock.now()}});
   throw error;
  }finally{await guard.end();}
 }
 onModuleInit(){
  this.customerEffects.register(async(tx,ctx,id,work)=>{const ps=await tx.proxyContext.findMany({where:{customerId:id,status:'VERIFIED'},select:{orderId:true}});if(!ps.length)return work();const refs=[...new Set(ps.map(p=>p.orderId))].sort().map(orderRef);return this.entry.withContext(tx,this.access(ctx),refs,ctx.requestId,async c=>{const before=await tx.customer.findUniqueOrThrow({where:{id},select:{statusVersion:true}});const result=await work();const after=await tx.customer.findUniqueOrThrow({where:{id},select:{statusVersion:true}});if(before.statusVersion===after.statusVersion)return result;for(const ref of refs)await this.entry.inContext(c,ref,s=>this.invalidateOrderInContext(s,c,ref.businessId,'顾客状态版本已变化'));return result;});});
  this.employeeEffects.register({references:async(tx,id,permissions,change)=>change.permission!=='employee.role.change'&&['customer.frozen.proxy','customer.read','after-sale.service.read'].every(p=>permissions.includes(p))?[]:(await tx.proxyContext.findMany({where:{verifiedById:id,status:'VERIFIED'},distinct:['orderId'],select:{orderId:true}})).map(p=>orderRef(p.orderId)),invalidate:(tx,id,permissions,change)=>change.permission!=='employee.role.change'&&['customer.frozen.proxy','customer.read','after-sale.service.read'].every(p=>permissions.includes(p))?Promise.resolve():this.invalidateEmployeeLocked(tx,id,change.requestId)});
  this.files.register({ownerType:'PROXY_VERIFICATION',async aggregate(tx,t){const p=await tx.proxyContext.findUnique({where:{id:t.ownerId}});if(!p)throw new FileError('FILE_NOT_FOUND');return 'ORDER:'+p.orderId;},async authorize(tx,a,t,mode){const actor=proxyPermission(a),p=await tx.proxyContext.findUnique({where:{id:t.ownerId}});if(!p||p.verifiedById!==actor.subjectId&&actor.role!=='SUPER_ADMIN'||t.audience!=='INTERNAL'||t.slot!=='evidence'||mode==='BIND'&&p.status!=='VERIFIED')throw new FileError('FILE_NOT_FOUND');}});
 }
 private async invalidateEmployeeLocked(tx:Prisma.TransactionClient,id:string,requestId:string){
  // prepare已按原员工资格变更计划锁完主体、订单、Cursor和Task；此处不能反向重取主体锁。
  const ps=await tx.proxyContext.findMany({where:{verifiedById:id,status:'VERIFIED'},orderBy:{id:'asc'}});
  for(const p of ps){
   const reason='核实员工资格已变化';await tx.proxyContext.update({where:{id:p.id},data:{status:'INVALIDATED',invalidatedReason:reason}});
   const rows=await tx.taskBusinessSource.findMany({where:{sourceType:'PROXY_CONTEXT',sourceId:p.id,status:'ACTIVE'}});
   for(const r of rows){
    const now=this.clock.now(),key='proxy-qualification:'+p.id;
    await tx.taskBusinessSource.update({where:{id:r.id},data:{status:'CANCELLED',endedAt:now,resolutionCommandKey:key,resolutionReason:reason,resolutionActorKey:'SYSTEM',resolutionOutcome:'CANCELLED'}});
    await tx.taskBusinessSourceHistory.create({data:{sourceRecordId:r.id,action:'CANCELLED',commandKey:key,actorKey:'SYSTEM',reason,requestId,createdAt:now}});
    await this.audit.appendAudit(tx,{actor:{type:'SYSTEM'},action:'task.source.cancel',targetId:r.taskId,requestId,reason,after:{sourceType:'PROXY_CONTEXT',sourceId:p.id,sourceStatus:'CANCELLED'}});
    if(!await tx.taskBusinessSource.count({where:{taskId:r.taskId,status:'ACTIVE'}})){
     const t=await tx.task.findUniqueOrThrow({where:{id:r.taskId}});
     if(['OPEN','CLAIMED','SUSPENDED'].includes(t.status)){
      if(t.version>=2147483647)throw new ProxyError('VERSION_CONFLICT');
      await tx.task.update({where:{id:t.id},data:{status:'CANCELLED',assigneeId:null,closedAt:now,reassignNeeded:false,version:{increment:1},updatedAt:now}});
      await tx.taskHistory.create({data:{taskId:t.id,action:'CANCELLED',actorType:'SYSTEM',fromAssigneeId:t.assigneeId,beforeStatus:t.status,afterStatus:'CANCELLED',reason:'本轮核实来源均已失效',commandKey:key,requestId,createdAt:now}});
      await this.audit.appendAudit(tx,{actor:{type:'SYSTEM'},action:'task.stage.cancel',targetId:t.id,requestId,reason, before:{taskStatus:t.status,assigneeId:t.assigneeId,round:t.round},after:{taskStatus:'CANCELLED',assigneeId:null,round:t.round}});
     }
    }
   }
   await this.audit.appendAudit(tx,{actor:{type:'SYSTEM'},action:'coordination.change',targetId:p.id,requestId,reason,after:{coordinationAction:'proxy-context-invalidated',orderId:p.orderId,proxyContextId:p.id}});
  }
 }
}
