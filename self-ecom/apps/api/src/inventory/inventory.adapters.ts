// 作用：将真实库存聚合接入任务、文件、状态历史和SKU引用保护；无订单占位适配器。
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Prisma, Task } from '@prisma/client';
import { TaskBusinessAdapters, type TaskLockResource, type TaskCommandActor } from '../tasks/task-business-adapters.js';
import { isTaskEligible } from '../tasks/task-access.service.js';
import { TaskError } from '../tasks/task.errors.js';
import { FileBusinessAdapters } from '../files/file-business-adapters.js';
import { FileError } from '../files/file.errors.js';
import { SkuReferences } from '../catalog/sku-reference.service.js';
import { BusinessRecordAdapters } from '../records/business-record-adapters.js';
import { RecordInputError } from '../records/record-support.js';
import { InventoryError } from './inventory.errors.js';
import { permission } from './inventory-access.service.js';
@Injectable()
export class InventoryAdapters implements OnModuleInit {
 constructor(@Inject(TaskBusinessAdapters) private readonly tasks:TaskBusinessAdapters,@Inject(FileBusinessAdapters) private readonly files:FileBusinessAdapters,
  @Inject(SkuReferences) private readonly skus:SkuReferences,@Inject(BusinessRecordAdapters) private readonly records:BusinessRecordAdapters){}
 onModuleInit(){
  const requirePending=async(tx:Prisma.TransactionClient,task:Task)=>{const row=await tx.inventoryAdjustment.findUnique({where:{id:task.businessId}});
   if(!row||row.status!=='PENDING'||task.stage!==(row.checkRequired?'INVENTORY_RECONCILE':'INVENTORY_POST'))throw new TaskError('TASK_ENTRY_BLOCKED');return row;};
  const authorize=async(tx:Prisma.TransactionClient,id:string,actor:TaskCommandActor)=>{
   if(actor.subjectType==='SYSTEM')throw new InventoryError('INVENTORY_DOMAIN_NOT_READY');permission(actor,['inventory.read']);
   if(!await tx.inventoryAdjustment.count({where:{id}}))throw new InventoryError('ADJUSTMENT_NOT_FOUND');
  };
  this.tasks.registerLocker('PRODUCT',async(tx,id)=>{await tx.$queryRaw`SELECT id FROM product WHERE id=${id}::uuid FOR UPDATE`;});
  this.tasks.registerLocker('SKU_STOCK',async(tx,id)=>{await tx.$queryRaw`SELECT id FROM sku WHERE id=${id}::uuid FOR UPDATE`;await tx.$queryRaw`SELECT sku_id FROM inventory_balance WHERE sku_id=${id}::uuid FOR UPDATE`;});
  this.tasks.registerLocker('INVENTORY_SOURCE',async(tx,id)=>{await tx.$queryRaw`SELECT id FROM inventory_source_line WHERE id=${id}::uuid FOR UPDATE`;});
  this.tasks.registerLocker('INVENTORY_ADJUSTMENT',async(tx,id)=>{await tx.$queryRaw`SELECT id FROM inventory_adjustment WHERE id=${id}::uuid FOR UPDATE`;
   await tx.$queryRaw`SELECT id FROM inventory_adjustment_line WHERE adjustment_id=${id}::uuid ORDER BY id FOR UPDATE`;});
  this.tasks.registerBusiness('INVENTORY_ADJUSTMENT',{
   async planLocks(tx,ref){
    const lines=await tx.inventoryAdjustmentLine.findMany({where:{adjustmentId:ref.businessId}});
    const roots=await tx.inventoryAdjustmentLine.findMany({where:{id:{in:lines.flatMap(l=>l.rootLineId?[l.rootLineId]:[])}}});
    const skus=await tx.sku.findMany({where:{id:{in:lines.map(l=>l.skuId)}},select:{id:true,productId:true}});
    const resources:TaskLockResource[]=[{kind:'INVENTORY_ADJUSTMENT',id:ref.businessId},...roots.map(r=>({kind:'INVENTORY_ADJUSTMENT' as const,id:r.adjustmentId})),
     ...skus.flatMap(s=>[{kind:'PRODUCT' as const,id:s.productId},{kind:'SKU_STOCK' as const,id:s.id}]),...lines.map(l=>({kind:'INVENTORY_SOURCE' as const,id:l.sourceLineId}))];return resources;
   },
   authorize:(tx,ref,actor)=>authorize(tx,ref.businessId,actor),
   async resolveEntry(tx,entry,_actor,active){
    const row=await tx.inventoryAdjustment.findUniqueOrThrow({where:{id:entry.businessId}});
    if(row.status!=='PENDING'||entry.stage!==(row.checkRequired?'INVENTORY_RECONCILE':'INVENTORY_POST'))throw new TaskError('TASK_ENTRY_BLOCKED');
    if(active){if(entry.stage!=='INVENTORY_POST'||active.status!=='SUSPENDED'||!entry.entryKey.startsWith('resolved:'))throw new TaskError('TASK_STAGE_ACTIVE');
     return {startedAt:row.updatedAt,replaces:{taskId:active.id,expectedVersion:active.version,outcome:'CANCELLED'}};}
    return {startedAt:entry.stage==='INVENTORY_POST'&&entry.entryKey==='create'?row.createdAt:row.updatedAt};
   },
  });
  this.tasks.registerAccess('INVENTORY_ADJUSTMENT',{
   async visibleBusinessIds(tx,actor){if(!actor.effectivePermissions.includes('inventory.read'))return [];return (await tx.inventoryAdjustment.findMany({select:{id:true}})).map(r=>r.id);},
   async describe(tx,actor,task){await authorize(tx,task.businessId,actor);const row=await tx.inventoryAdjustment.findUniqueOrThrow({where:{id:task.businessId}});
    const active=row.status==='PENDING'&&task.stage===(row.checkRequired?'INVENTORY_RECONCILE':'INVENTORY_POST');
    return {number:row.number,label:row.checkRequired?'库存待核实':'库存待确认',detailPath:`/inventory/adjustments/${row.id}`,canClaim:active&&task.status==='OPEN'&&isTaskEligible(actor,task),
     canRelease:active&&task.status==='CLAIMED'&&task.assigneeId===actor.subjectId,canReadHistoryReasons:true,canTransfer:active,canExtendDeadline:active};
   },
   async assertClaim(tx,actor,task){await authorize(tx,task.businessId,actor);await requirePending(tx,task);},
   async assertRelease(tx,actor,task){await authorize(tx,task.businessId,actor);await requirePending(tx,task);},
  });
  this.tasks.registerHandoff('INVENTORY_ADJUSTMENT',{
   async transfer(tx,_actor,_target,task){await requirePending(tx,task);},
   async qualificationLost(tx,_actorId,task){
    // 撤权者已不再有领域权限，使用锁内真实状态处理回池，不能反向要求其旧权限仍有效。
    await requirePending(tx,task);
   },
  });
  this.tasks.registerDeadline('INVENTORY_ADJUSTMENT',{
   async assertCanExtend(tx,actor,task){await authorize(tx,task.businessId,actor);await requirePending(tx,task);},
   async extend(tx,_actor,task){await requirePending(tx,task);},
  });
  this.tasks.registerLifecycle('INVENTORY_ADJUSTMENT',{
   async assertTransition(tx,actor,task,action){
    await authorize(tx,task.businessId,actor);const row=await tx.inventoryAdjustment.findUniqueOrThrow({where:{id:task.businessId}});
    const employee=actor.subjectType==='EMPLOYEE'?actor.subjectId:null;
    const allowed=action==='COMPLETED'?(task.stage==='INVENTORY_POST'?row.status==='POSTED'&&row.postedById===employee:row.status==='PENDING'&&!row.checkRequired)
     :action==='SUSPENDED'?row.status==='PENDING'&&row.checkRequired&&task.stage==='INVENTORY_POST'&&task.assigneeId===employee
     :action==='CANCELLED'?(row.status==='VOID'||(row.status==='PENDING'&&!row.checkRequired&&task.stage==='INVENTORY_POST'&&task.status==='SUSPENDED')):false;
    if(!allowed)throw new TaskError('TASK_TRANSITION_BLOCKED');
   },async applyTransition(){/* 领域状态由库存命令先写，Task保持唯一经办权威。 */},
  });
  for(const ownerType of ['INVENTORY_SOURCE','INVENTORY_ADJUSTMENT'] as const)this.files.register({ownerType,
   async aggregate(tx,target){const found=ownerType==='INVENTORY_SOURCE'?await tx.inventorySource.count({where:{id:target.ownerId}}):await tx.inventoryAdjustment.count({where:{id:target.ownerId}});
    if(!found)throw new FileError('FILE_NOT_FOUND');return `${ownerType}:${target.ownerId}`;},
   async authorize(tx,actor,target,mode){
    if(actor.subjectType!=='EMPLOYEE'||actor.mustChangePassword||target.slot!=='evidence'||target.audience!=='INTERNAL')throw new FileError('FILE_NOT_FOUND');
    if(!actor.effectivePermissions.includes(mode==='READ'?'inventory.read':ownerType==='INVENTORY_SOURCE'?'inventory.source.manage':'inventory.adjustment.create')
     &&!(mode==='BIND'&&ownerType==='INVENTORY_ADJUSTMENT'&&actor.effectivePermissions.includes('inventory.adjustment.post')))throw new FileError('FILE_NOT_FOUND');
    if(ownerType==='INVENTORY_SOURCE'){if(!await tx.inventorySource.count({where:{id:target.ownerId}}))throw new FileError('FILE_NOT_FOUND');}
    else{const row=await tx.inventoryAdjustment.findUnique({where:{id:target.ownerId}});if(!row)throw new FileError('FILE_NOT_FOUND');
     if(mode==='BIND'){const task=await tx.task.findFirst({where:{businessType:'INVENTORY_ADJUSTMENT',businessId:row.id,status:{in:['OPEN','CLAIMED']}}});
      if(row.status!=='PENDING'||(task?.assigneeId??row.createdById)!==actor.subjectId)throw new FileError('FILE_NOT_BINDABLE');}}
   },
  });
  this.skus.register({domain:'inventory',async referenced(tx,ids){return (await tx.inventorySourceLine.count({where:{skuId:{in:ids}}}))>0
   ||(await tx.inventoryAdjustmentLine.count({where:{skuId:{in:ids}}}))>0||(await tx.inventoryLedger.count({where:{skuId:{in:ids}}}))>0||(await tx.inventoryPurchaseBlock.count({where:{skuId:{in:ids}}}))>0;}});
  this.records.registerStateHistory({aggregateType:'INVENTORY_ADJUSTMENT',async lockAndValidate(tx,actor,t){
   const row=await tx.inventoryAdjustment.findUnique({where:{id:t.aggregateId}});
   if(!row||actor.type!=='EMPLOYEE'||!t.reason||t.dimension!=='posting'||t.toState!==row.status
    ||!(t.fromState===null&&t.toState==='PENDING'||t.fromState==='PENDING'&&['POSTED','VOID'].includes(t.toState)))throw new RecordInputError();
  }});
 }
}
