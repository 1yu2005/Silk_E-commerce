// 作用：人工登记、确认、作废和核实闭环；所有数量、来源、任务、历史及审计共享一个事务。
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { InventoryAdjustmentType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { runAuthTransaction } from '../auth/auth-transaction.js';
import { TaskEntryService, type TaskEntryContext } from '../tasks/task-entry.service.js';
import { TaskLifecycleService } from '../tasks/task-lifecycle.service.js';
import { TaskCommandService } from '../tasks/task-command.service.js';
import { TaskError } from '../tasks/task.errors.js';
import type { TaskLockResource } from '../tasks/task-business-adapters.js';
import { StateHistoryService } from '../records/state-history.service.js';
import { InventoryAccess, type InventoryContext } from './inventory-access.service.js';
import { InventoryEvidence } from './inventory-evidence.service.js';
import { InventoryKernel } from './inventory-kernel.service.js';
import { InventoryPosting } from './inventory-posting.service.js';
import { InventoryBlocks } from './inventory-block.service.js';
import { InventoryError } from './inventory.errors.js';
import { fingerprint, integer, lockSources, lockStock, normalize, text } from './inventory-support.js';
import type { AdjustmentCommandDto, AdjustmentCreateDto, AdjustmentEditDto, AdjustmentResolveDto, AdjustmentVoidDto, CorrectionCreateDto } from './inventory.dto.js';
export type NewInventoryLine={skuId:string;sourceLineId:string;batchKey?:string|null;quantity?:number|null;signedDeltaA?:number|null;rootLineId?:string|null};
export const inventoryRef=(id:string)=>({businessType:'INVENTORY_ADJUSTMENT' as const,businessId:id});
@Injectable()
export class InventoryAdjustments {
 constructor(@Inject(PrismaService) private readonly db:PrismaService,@Inject(InventoryAccess) private readonly access:InventoryAccess,
  @Inject(InventoryEvidence) private readonly evidence:InventoryEvidence,@Inject(AuditService) private readonly audit:AuditService,
  @Inject(TaskEntryService) private readonly entry:TaskEntryService,@Inject(TaskLifecycleService) private readonly lifecycle:TaskLifecycleService,
  @Inject(TaskCommandService) private readonly tasks:TaskCommandService,@Inject(StateHistoryService) private readonly history:StateHistoryService,
  @Inject(InventoryKernel) private readonly kernel:InventoryKernel,@Inject(InventoryPosting) private readonly posting:InventoryPosting,
  @Inject(InventoryBlocks) private readonly blocks:InventoryBlocks){}
 async lines(tx:Prisma.TransactionClient,type:InventoryAdjustmentType,lines:NewInventoryLine[],maximum=100){
  if(!lines.length||lines.length>maximum)throw new InventoryError('VALIDATION_FAILED');const keys=new Set<string>();
  for(const line of lines){
   const source=await tx.inventorySourceLine.findUnique({where:{id:line.sourceLineId}});
   if(!source||source.skuId!==line.skuId)throw new InventoryError('SOURCE_NOT_FOUND');
   const parent=await tx.inventorySource.findUniqueOrThrow({where:{id:source.sourceId}});
   if(type==='CORRECTION'){
    integer(line.signedDeltaA,-2147483647);if(!line.signedDeltaA||!line.rootLineId)throw new InventoryError('VALIDATION_FAILED');
    const root=await tx.inventoryAdjustmentLine.findUnique({where:{id:line.rootLineId}});
    const adjustment=root?await tx.inventoryAdjustment.findUnique({where:{id:root.adjustmentId}}):null;
    if(!root||!adjustment||adjustment.status!=='POSTED'||root.type==='CORRECTION'||root.skuId!==line.skuId||root.sourceLineId!==line.sourceLineId)throw new InventoryError('CORRECTION_NOT_ALLOWED');
    line.quantity=null;line.batchKey=null;
   }else{
    integer(line.quantity,1);line.rootLineId=null;line.signedDeltaA=null;
    if((type==='AVAILABLE_LOSS')!==(parent.sourceType==='LOSS'))throw new InventoryError('VALIDATION_FAILED');
    if(type==='AVAILABLE_LOSS'){if(line.batchKey)throw new InventoryError('VALIDATION_FAILED');line.batchKey=null;}
    else line.batchKey=normalize(text(line.batchKey,80));
   }
   const key=type==='CORRECTION'?line.rootLineId!:`${line.skuId}:${line.sourceLineId}:${line.batchKey??''}`;
   if(keys.has(key))throw new InventoryError('VALIDATION_FAILED');keys.add(key);
  }return lines;
 }
 /** 新聚合尚未提交且没有任何经办；先持主体和完整库存锁，插入后进入同事务任务上下文。 */
 async createInTransaction(tx:Prisma.TransactionClient,ctx:InventoryContext,type:InventoryAdjustmentType,reason:string,evidenceNote:string|undefined,fileIds:string[]|undefined,lines:NewInventoryLine[],
  conversion?:{key:string;fingerprint:string;snapshot:Prisma.InputJsonValue}){
  await this.lines(tx,type,lines,conversion?200:100);
  if(type==='CORRECTION'&&!text(evidenceNote,2000,true)&&!fileIds?.length)throw new InventoryError('VALIDATION_FAILED');
  const row=await tx.inventoryAdjustment.create({data:{number:'INV-'+randomUUID().replaceAll('-','').toUpperCase(),type,reason:text(reason,500),evidenceNote:text(evidenceNote,2000,true)||null,
   createdById:ctx.actor.subjectId,...(conversion?{conversionKey:conversion.key,conversionFingerprint:conversion.fingerprint,conversionSnapshot:conversion.snapshot}:{})}});
  await tx.inventoryAdjustmentLine.createMany({data:lines.map(line=>({...line,adjustmentId:row.id,type}))});
  await this.entry.withContext(tx,{type:'EMPLOYEE',subjectId:ctx.actor.subjectId,token:ctx.token},[inventoryRef(row.id)],ctx.requestId,async context=>{
   await this.entry.enterStage(context,{...inventoryRef(row.id),stage:'INVENTORY_POST',entryKey:'create',reason:row.reason});
   await this.evidence.bind(tx,ctx,'INVENTORY_ADJUSTMENT',row.id,fileIds,'create');
  });
  await this.history.appendStateHistory(tx,{type:'EMPLOYEE',id:ctx.actor.subjectId},{aggregateType:'INVENTORY_ADJUSTMENT',aggregateId:row.id,dimension:'posting',commandKey:'create',fromState:null,toState:'PENDING',requestId:ctx.requestId,reason:row.reason});
  await this.record(tx,ctx,row.id,conversion?'CONVERT':'CREATE',row.version,row.reason);return row;
 }
 create(ctx:InventoryContext,input:AdjustmentCreateDto){return runAuthTransaction(this.db,async tx=>{
  await this.access.actor(tx,ctx,['inventory.adjustment.create']);await lockStock(tx,input.lines.map(l=>l.skuId));await lockSources(tx,input.lines.map(l=>l.sourceLineId));
  const row=await this.createInTransaction(tx,ctx,input.type,input.reason,input.evidenceNote,input.evidenceFileIds,input.lines.map(l=>({...l})));return {id:row.id,changed:true};
 });}
 corrections(ctx:InventoryContext,id:string,input:CorrectionCreateDto){return runAuthTransaction(this.db,async tx=>{
  await this.access.actor(tx,ctx,['inventory.adjustment.create']);
  const roots=await tx.inventoryAdjustmentLine.findMany({where:{id:{in:input.lines.map(l=>l.rootLineId)},adjustmentId:id}});
  if(roots.length!==input.lines.length)throw new InventoryError('CORRECTION_NOT_ALLOWED');
  await lockStock(tx,roots.map(l=>l.skuId));await lockSources(tx,roots.map(l=>l.sourceLineId));
  await tx.$queryRaw`SELECT id FROM inventory_adjustment WHERE id=${id}::uuid FOR UPDATE`;
  const lines=input.lines.map(line=>{const root=roots.find(r=>r.id===line.rootLineId)!;return {skuId:root.skuId,sourceLineId:root.sourceLineId,...line};});
  const row=await this.createInTransaction(tx,ctx,'CORRECTION',input.reason,input.evidenceNote,input.evidenceFileIds,lines);return {id:row.id,changed:true};
 });}
 private command<T>(ctx:InventoryContext,id:string,fn:(tx:Prisma.TransactionClient,context:TaskEntryContext)=>Promise<T>,extraLocks:readonly TaskLockResource[]=[]){
  return runAuthTransaction(this.db,tx=>this.entry.withContext(tx,{type:'EMPLOYEE',subjectId:ctx.actor.subjectId,token:ctx.token},[inventoryRef(id)],ctx.requestId,async context=>{
   await tx.$queryRaw`SELECT id FROM task_stage_cursor WHERE business_type='INVENTORY_ADJUSTMENT' AND business_id=${id}::uuid ORDER BY id FOR UPDATE`;
   await tx.$queryRaw`SELECT id FROM task WHERE business_type='INVENTORY_ADJUSTMENT' AND business_id=${id}::uuid ORDER BY id FOR UPDATE`;
   return fn(tx,context);
  },extraLocks),
   error=>error instanceof TaskError&&error.code==='TASK_LOCK_PLAN_CHANGED');
 }
 async edit(ctx:InventoryContext,id:string,input:AdjustmentEditDto){
  const proposed:NewInventoryLine[]=[];
  for(const line of input.lines){
   if(input.type==='CORRECTION'){
    if(!line.rootLineId||line.skuId||line.sourceLineId||line.quantity||line.batchKey)throw new InventoryError('VALIDATION_FAILED');
    const root=await this.db.inventoryAdjustmentLine.findUnique({where:{id:line.rootLineId}});if(!root)throw new InventoryError('CORRECTION_NOT_ALLOWED');
    proposed.push({skuId:root.skuId,sourceLineId:root.sourceLineId,rootLineId:root.id,signedDeltaA:line.signedDeltaA});
   }else{if(!line.skuId||!line.sourceLineId||line.rootLineId||line.signedDeltaA!==undefined)throw new InventoryError('VALIDATION_FAILED');proposed.push({...line,skuId:line.skuId,sourceLineId:line.sourceLineId});}
  }
  const skus=await this.db.sku.findMany({where:{id:{in:proposed.map(l=>l.skuId)}}});
  const roots=await this.db.inventoryAdjustmentLine.findMany({where:{id:{in:proposed.flatMap(l=>l.rootLineId?[l.rootLineId]:[])}}});
  const extra:TaskLockResource[]=[...skus.flatMap(s=>[{kind:'PRODUCT' as const,id:s.productId},{kind:'SKU_STOCK' as const,id:s.id}]),
   ...proposed.map(l=>({kind:'INVENTORY_SOURCE' as const,id:l.sourceLineId})),...roots.map(l=>({kind:'INVENTORY_ADJUSTMENT' as const,id:l.adjustmentId}))];
  return this.command(ctx,id,async tx=>{
  const actor=await this.access.actor(tx,ctx,['inventory.adjustment.create'],false);const row=await this.pending(tx,id,input.expectedVersion);
  const task=await this.access.task(tx,id,row.checkRequired);
  if((task.assigneeId??row.createdById)!==actor.subjectId||task.status==='SUSPENDED')throw new InventoryError('TASK_NOT_ASSIGNEE');
  if(row.checkRequired)throw new InventoryError('INVENTORY_CHECK_REQUIRED');
  if(row.type!==input.type)throw new InventoryError('VALIDATION_FAILED');
  const lines=await this.lines(tx,row.type,proposed,row.conversionKey?200:100);
  if(row.type==='CORRECTION'&&!text(input.evidenceNote,2000,true)&&!input.evidenceFileIds?.length)throw new InventoryError('VALIDATION_FAILED');
  await tx.inventoryAdjustmentLine.deleteMany({where:{adjustmentId:id}});await tx.inventoryAdjustmentLine.createMany({data:lines.map(l=>({...l,adjustmentId:id,type:row.type}))});
  const updated=await tx.inventoryAdjustment.update({where:{id},data:{reason:text(input.reason,500),evidenceNote:text(input.evidenceNote,2000,true)||null,version:{increment:1}}});
  await this.evidence.bind(tx,ctx,'INVENTORY_ADJUSTMENT',id,input.evidenceFileIds,`edit:${row.version}`);await this.record(tx,ctx,id,'EDIT',updated.version,updated.reason);return {id,changed:true};
 },extra);}
 async claim(ctx:InventoryContext,id:string,input:AdjustmentCommandDto){
  const row=await this.db.inventoryAdjustment.findUnique({where:{id}});if(!row)throw new InventoryError('ADJUSTMENT_NOT_FOUND');
  const task=await this.db.task.findFirst({where:{...inventoryRef(id),stage:row.checkRequired?'INVENTORY_RECONCILE':'INVENTORY_POST',status:{in:['OPEN','CLAIMED']}}});
  if(!task)throw new InventoryError('ADJUSTMENT_NOT_PENDING');
  const result=await this.tasks.claim(ctx.actor,ctx.token,task.id,{expectedVersion:input.expectedTaskVersion},ctx.requestId,async(tx,current)=>{
   const latest=await this.pending(tx,id,input.expectedVersion);
   if(current.stage!==(latest.checkRequired?'INVENTORY_RECONCILE':'INVENTORY_POST'))throw new InventoryError('VERSION_CONFLICT');
  });return {id,changed:result.changed};
 }
 async post(ctx:InventoryContext,id:string,input:AdjustmentCommandDto){
  // 已提交动作不可变；重放只读验证当前会话和范围，不重复排队取得原单全部写锁。
  const replay=await runAuthTransaction(this.db,async tx=>{
   await this.access.actor(tx,ctx,['inventory.read','inventory.adjustment.post'],false);
   const prior=await tx.inventoryAction.findUnique({where:{actionKey:`ADJUSTMENT:${id}:POST`}});
   if(prior&&prior.requestFingerprint!==fingerprint({adjustmentId:id,contentVersion:input.expectedVersion}))throw new InventoryError('INVENTORY_ACTION_CONFLICT');
   return prior;
  });if(replay)return {id,changed:false,actionId:replay.id};
  const outcome=await this.command(ctx,id,async(tx,context)=>{
   const actor=await this.access.actor(tx,ctx,['inventory.adjustment.post'],false);
   const semantic={adjustmentId:id,contentVersion:input.expectedVersion};const key=`ADJUSTMENT:${id}:POST`;
   const prior=await this.kernel.replay(tx,key,semantic);if(prior)return {id,changed:false,actionId:prior.id};
   const row=await this.pending(tx,id,input.expectedVersion);if(row.checkRequired)throw new InventoryError('INVENTORY_CHECK_REQUIRED');
   const task=await this.access.task(tx,id,false);this.access.assignee(actor,task,input.expectedTaskVersion);
   const lines=await tx.inventoryAdjustmentLine.findMany({where:{adjustmentId:id}});
   let plan;
   try{plan=await this.posting.plan(tx,row,lines);}catch(error){
    if(!(error instanceof InventoryError)||!['STOCK_INSUFFICIENT','SOURCE_QUANTITY_EXCEEDED'].includes(error.code))throw error;
    const updated=await tx.inventoryAdjustment.update({where:{id},data:{checkRequired:true,checkReasonCode:error.code,version:{increment:1}}});
    for(const sku of [...new Set(lines.map(l=>l.skuId))])await this.blocks.open(tx,sku,'ADJUSTMENT',id,error.code,{type:'EMPLOYEE',id:actor.subjectId},ctx.requestId);
    await this.lifecycle.transition(context,{...inventoryRef(id),taskId:task.id,expectedVersion:task.version,action:'SUSPENDED',commandKey:`check:${row.version}`,reason:error.message});
    await this.entry.enterStage(context,{...inventoryRef(id),stage:'INVENTORY_RECONCILE',entryKey:`check:${row.version}`,reason:error.message});
    await this.record(tx,ctx,id,'CHECK',updated.version,error.message);return {id,changed:true,errorCode:error.code};
   }
   await this.posting.applySources(tx,plan);
   const result=await this.kernel.execute(tx,{businessType:'ADJUSTMENT',businessId:id,businessNumber:row.number,actionType:'MANUAL_POST',actionKey:key,semantic,
    actor:{type:'EMPLOYEE',id:actor.subjectId},requestId:ctx.requestId,reason:row.reason,effects:plan.effects});
   const updated=await tx.inventoryAdjustment.update({where:{id},data:{status:'POSTED',postedById:actor.subjectId,postedAt:new Date(),version:{increment:1}}});
   await this.lifecycle.transition(context,{...inventoryRef(id),taskId:task.id,expectedVersion:task.version,action:'COMPLETED',commandKey:'post',reason:row.reason});
   await this.state(tx,ctx,id,'POSTED',row.reason);await this.record(tx,ctx,id,'POST',updated.version,row.reason);return {id,changed:result.changed,actionId:result.action.id};
  });
  // 可预期核实结果已经提交，必须在事务外返回409；不能抛错回滚后声称待办仍存在。
  if('errorCode'in outcome&&outcome.errorCode)throw new InventoryError(outcome.errorCode,{adjustmentId:id,checkRequired:true});return outcome;
 }
 void(ctx:InventoryContext,id:string,input:AdjustmentVoidDto){return this.command(ctx,id,async(tx,context)=>{
  const actor=await this.access.actor(tx,ctx,['inventory.adjustment.void'],false);const row=await this.pending(tx,id,input.expectedVersion);
  const current=await this.access.task(tx,id,row.checkRequired);this.access.assignee(actor,current,input.expectedTaskVersion);const reason=text(input.reason,500);
  const updated=await tx.inventoryAdjustment.update({where:{id},data:{status:'VOID',voidedById:actor.subjectId,voidedAt:new Date(),checkRequired:false,checkReasonCode:null,version:{increment:1}}});
  for(const task of await tx.task.findMany({where:{...inventoryRef(id),status:{in:['OPEN','CLAIMED','SUSPENDED']}}}))await this.lifecycle.transition(context,{...inventoryRef(id),taskId:task.id,expectedVersion:task.version,action:'CANCELLED',commandKey:'void',reason});
  for(const line of await tx.inventoryAdjustmentLine.findMany({where:{adjustmentId:id}}))await this.blocks.resolve(tx,line.skuId,'ADJUSTMENT',id,{type:'EMPLOYEE',id:actor.subjectId},ctx.requestId,reason);
  await this.state(tx,ctx,id,'VOID',reason);await this.record(tx,ctx,id,'VOID',updated.version,reason);return {id,changed:true};
 });}
 resolve(ctx:InventoryContext,id:string,input:AdjustmentResolveDto){return this.command(ctx,id,async(tx,context)=>{
  const actor=await this.access.actor(tx,ctx,['inventory.adjustment.post'],false);const row=await this.pending(tx,id,input.expectedVersion);
  if(!row.checkRequired)throw new InventoryError('INVENTORY_CHECK_UNRESOLVED');const task=await this.access.task(tx,id,true);this.access.assignee(actor,task,input.expectedTaskVersion);
  const lines=await tx.inventoryAdjustmentLine.findMany({where:{adjustmentId:id}});
  try{await this.posting.plan(tx,row,lines);}catch(error){if(error instanceof InventoryError)throw new InventoryError('INVENTORY_CHECK_UNRESOLVED');throw error;}
  const reason=text(input.reason,500);const updated=await tx.inventoryAdjustment.update({where:{id},data:{checkRequired:false,checkReasonCode:null,evidenceNote:text(input.evidenceNote,2000),version:{increment:1}}});
  // command已锁定全部既有游标/任务，此时仍由核实经办绑定证据；后面只插入本事务的新入账轮。
  await this.evidence.bind(tx,ctx,'INVENTORY_ADJUSTMENT',id,input.evidenceFileIds,`resolve:${row.version}`);
  await this.lifecycle.transition(context,{...inventoryRef(id),taskId:task.id,expectedVersion:task.version,action:'COMPLETED',commandKey:`resolve:${row.version}`,reason});
  for(const line of lines)await this.blocks.resolve(tx,line.skuId,'ADJUSTMENT',id,{type:'EMPLOYEE',id:actor.subjectId},ctx.requestId,reason);
  await this.entry.enterStage(context,{...inventoryRef(id),stage:'INVENTORY_POST',entryKey:`resolved:${row.version}`,reason});
  await this.record(tx,ctx,id,'RESOLVE',updated.version,reason);return {id,changed:true};
 });}
 private async pending(tx:Prisma.TransactionClient,id:string,version:number){
  const row=await tx.inventoryAdjustment.findUnique({where:{id}});if(!row)throw new InventoryError('ADJUSTMENT_NOT_FOUND');
  if(row.status!=='PENDING')throw new InventoryError('ADJUSTMENT_NOT_PENDING');if(row.version!==version||row.version>=2147483647)throw new InventoryError('VERSION_CONFLICT');return row;
 }
 private state(tx:Prisma.TransactionClient,ctx:InventoryContext,id:string,toState:'POSTED'|'VOID',reason:string){return this.history.appendStateHistory(tx,{type:'EMPLOYEE',id:ctx.actor.subjectId},
  {aggregateType:'INVENTORY_ADJUSTMENT',aggregateId:id,dimension:'posting',commandKey:toState.toLowerCase(),fromState:'PENDING',toState,requestId:ctx.requestId,reason});}
 private record(tx:Prisma.TransactionClient,ctx:InventoryContext,id:string,operation:'CREATE'|'EDIT'|'CONVERT'|'POST'|'VOID'|'CHECK'|'RESOLVE',version:number,reason:string){return this.audit.appendAudit(tx,
  {actor:{type:'EMPLOYEE',id:ctx.actor.subjectId},action:'inventory.adjustment',targetId:id,requestId:ctx.requestId,reason,after:{inventoryOperation:operation,inventoryVersion:version,inventoryQuantity:0}});}
}
