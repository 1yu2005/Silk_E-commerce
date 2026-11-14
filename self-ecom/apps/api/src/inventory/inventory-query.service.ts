// 作用：库存读取投影只含岗位需要的字段；汇总转十进制字符串，公开商城继续使用既有脱敏投影。
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { runAuthTransaction } from '../auth/auth-transaction.js';
import { InventoryAccess, type InventoryContext } from './inventory-access.service.js';
import { InventoryEvidence } from './inventory-evidence.service.js';
import { InventoryError } from './inventory.errors.js';
import { lockStock, text } from './inventory-support.js';
import type { InventoryQueryDto, InventoryThresholdDto } from './inventory.dto.js';
@Injectable()
export class InventoryQueries {
 constructor(@Inject(PrismaService) private readonly db:PrismaService,@Inject(InventoryEvidence) private readonly evidence:InventoryEvidence,
  @Inject(InventoryAccess) private readonly access:InventoryAccess,@Inject(AuditService) private readonly audit:AuditService){}
 async balances(q:InventoryQueryDto){
  const clauses=[Prisma.sql`true`];if(q.skuId)clauses.push(Prisma.sql`b.sku_id=${q.skuId}::uuid`);
  if(q.keyword)clauses.push(Prisma.sql`(s.code ILIKE ${'%'+q.keyword+'%'} OR p.name ILIKE ${'%'+q.keyword+'%'})`);
  if(q.lowStock)clauses.push(q.lowStock==='true'?Prisma.sql`b.available<=b.warning_threshold`:Prisma.sql`b.available>b.warning_threshold`);
  if(q.purchaseBlocked)clauses.push(Prisma.sql`b.purchase_blocked=${q.purchaseBlocked==='true'}`);
  const where=Prisma.join(clauses,' AND ');
  return this.db.$transaction(async tx=>{
   const rows=await tx.$queryRaw<{sku_id:string}[]>(Prisma.sql`SELECT b.sku_id FROM inventory_balance b JOIN sku s ON s.id=b.sku_id JOIN product p ON p.id=s.product_id WHERE ${where} ORDER BY s.code,b.sku_id OFFSET ${(q.page-1)*q.pageSize} LIMIT ${q.pageSize}`);
   const [total]=await tx.$queryRaw<{count:string;available:string;reserved:string}[]>(Prisma.sql`SELECT COUNT(*)::text AS count,COALESCE(SUM(b.available::bigint),0)::text AS available,COALESCE(SUM(b.reserved::bigint),0)::text AS reserved FROM inventory_balance b JOIN sku s ON s.id=b.sku_id JOIN product p ON p.id=s.product_id WHERE ${where}`);
   const items=[];for(const r of rows)items.push(await this.balanceTx(tx,r.sku_id));return {items,total:Number(total!.count),page:q.page,pageSize:q.pageSize,availableTotal:total!.available,reservedTotal:total!.reserved};
  });
 }
 balance(id:string){return this.db.$transaction(tx=>this.balanceTx(tx,id));}
 private async balanceTx(tx:Prisma.TransactionClient,id:string){
  const b=await tx.inventoryBalance.findUnique({where:{skuId:id},include:{sku:{include:{product:{select:{id:true,name:true}},choices:{include:{dimension:true,value:true}}}}}});
  if(!b)throw new InventoryError('INVENTORY_NOT_FOUND');
  return {skuId:b.skuId,code:b.sku.code,productId:b.sku.product.id,productName:b.sku.product.name,choices:b.sku.choices.map(c=>`${c.dimension.name}：${c.value.name}`),
   available:b.available,reserved:b.reserved,warningThreshold:b.warningThreshold,lowStock:b.available<=b.warningThreshold,purchaseBlocked:b.purchaseBlocked,version:b.version,
   blocks:await tx.inventoryPurchaseBlock.findMany({where:{skuId:id,active:true},select:{id:true,sourceType:true,sourceId:true,reasonCode:true,createdAt:true}})};
 }
 threshold(ctx:InventoryContext,id:string,input:InventoryThresholdDto){return runAuthTransaction(this.db,async tx=>{
  const actor=await this.access.actor(tx,ctx,['inventory.alert.manage']);await lockStock(tx,[id]);const row=await tx.inventoryBalance.findUnique({where:{skuId:id}});if(!row)throw new InventoryError('INVENTORY_NOT_FOUND');
  if(row.version!==input.expectedVersion||row.version>=2147483647)throw new InventoryError('VERSION_CONFLICT');
  const updated=await tx.inventoryBalance.update({where:{skuId:id},data:{warningThreshold:input.threshold,version:{increment:1}}});
  await this.audit.appendAudit(tx,{actor:{type:'EMPLOYEE',id:actor.subjectId},action:'inventory.threshold',targetId:id,requestId:ctx.requestId,reason:text(input.reason,500),
   before:{inventoryOperation:'THRESHOLD',inventoryVersion:row.version,inventoryQuantity:row.warningThreshold},after:{inventoryOperation:'THRESHOLD',inventoryVersion:updated.version,inventoryQuantity:updated.warningThreshold}});
  return {...await this.balanceTx(tx,id),changed:true};
 });}
 async sources(q:InventoryQueryDto){
  const where:Prisma.InventorySourceWhereInput={sourceType:q.sourceType,...(q.keyword?{OR:[{reference:{contains:q.keyword,mode:'insensitive'}},{namespace:{contains:q.keyword,mode:'insensitive'}}]}:{})};
  const [items,total]=await this.db.$transaction([this.db.inventorySource.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(q.page-1)*q.pageSize,take:q.pageSize}),this.db.inventorySource.count({where})]);return {items,total,page:q.page,pageSize:q.pageSize};
 }
 source(id:string){return this.db.$transaction(tx=>this.sourceTx(tx,id));}
 private async sourceTx(tx:Prisma.TransactionClient,id:string){
  const row=await tx.inventorySource.findUnique({where:{id}});if(!row)throw new InventoryError('SOURCE_NOT_FOUND');
  const lines=await tx.inventorySourceLine.findMany({where:{sourceId:id},orderBy:{lineKey:'asc'}});const result=[];
  for(const line of lines){const sku=await tx.sku.findUniqueOrThrow({where:{id:line.skuId},select:{code:true}});const batches=[];
   for(const batch of await tx.inventoryReceiptBatch.findMany({where:{sourceLineId:line.id},orderBy:{createdAt:'asc'}})){
    const root=await tx.inventoryAdjustmentLine.findUniqueOrThrow({where:{id:batch.rootAdjustmentLineId}});const original=await tx.inventoryAdjustment.findUniqueOrThrow({where:{id:root.adjustmentId}});
    const correctionLines=await tx.inventoryAdjustmentLine.findMany({where:{rootLineId:root.id}});const corrections=await tx.inventoryAdjustment.findMany({where:{id:{in:correctionLines.map(l=>l.adjustmentId)}},select:{id:true,number:true,status:true}});
    batches.push({...batch,adjustmentId:original.id,adjustmentNumber:original.number,corrections});
   }
   result.push({...line,skuCode:sku.code,batches});}
  return {...row,lines:result,evidence:await this.evidence.list(tx,'INVENTORY_SOURCE',id)};
 }
 async adjustments(q:InventoryQueryDto){
  const ids=q.assigneeId?(await this.db.task.findMany({where:{businessType:'INVENTORY_ADJUSTMENT',assigneeId:q.assigneeId,status:'CLAIMED'},select:{businessId:true}})).map(t=>t.businessId):undefined;
  const where:Prisma.InventoryAdjustmentWhereInput={status:q.status,type:q.type,...(ids?{id:{in:ids}}:{}),...(q.keyword?{number:{contains:q.keyword,mode:'insensitive'}}:{}),...(q.from||q.to?{createdAt:{gte:q.from?new Date(q.from):undefined,lte:q.to?new Date(q.to):undefined}}:{})};
  const [items,total]=await this.db.$transaction([this.db.inventoryAdjustment.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(q.page-1)*q.pageSize,take:q.pageSize}),this.db.inventoryAdjustment.count({where})]);return {items,total,page:q.page,pageSize:q.pageSize};
 }
 adjustment(id:string){return this.db.$transaction(async tx=>{
  const row=await tx.inventoryAdjustment.findUnique({where:{id}});if(!row)throw new InventoryError('ADJUSTMENT_NOT_FOUND');
  const lines=await tx.inventoryAdjustmentLine.findMany({where:{adjustmentId:id},orderBy:{id:'asc'}});const detailed=[];
  for(const line of lines){const sku=await tx.sku.findUniqueOrThrow({where:{id:line.skuId},select:{code:true}}),source=await tx.inventorySourceLine.findUniqueOrThrow({where:{id:line.sourceLineId}}),balance=await tx.inventoryBalance.findUniqueOrThrow({where:{skuId:line.skuId}});
   const deltaA=line.type==='CORRECTION'?line.signedDeltaA!:line.type==='AVAILABLE_LOSS'?-line.quantity!:line.quantity!;
   const root=line.rootLineId?await tx.inventoryAdjustmentLine.findUnique({where:{id:line.rootLineId}}):null;
   detailed.push({...line,skuCode:sku.code,available:balance.available,reserved:balance.reserved,deltaA,sourceId:source.sourceId,rootAdjustmentId:root?.adjustmentId??null});}
  const sourceIds=[...new Set((await tx.inventorySourceLine.findMany({where:{id:{in:lines.map(l=>l.sourceLineId)}}})).map(l=>l.sourceId))];const sources=[];for(const sourceId of sourceIds)sources.push(await this.sourceTx(tx,sourceId));
  const tasks=await tx.task.findMany({where:{businessType:'INVENTORY_ADJUSTMENT',businessId:id},orderBy:{createdAt:'asc'},select:{id:true,stage:true,status:true,assigneeId:true,version:true,round:true,dueAt:true,reassignNeeded:true}});
  const task=tasks.find(t=>t.stage===(row.checkRequired?'INVENTORY_RECONCILE':'INVENTORY_POST')&&['OPEN','CLAIMED'].includes(t.status))??null;
  const action=await tx.inventoryAction.findUnique({where:{adjustmentId:id}});
  return {...row,adjustmentVersion:row.version,taskVersion:task?.version??null,lines:detailed,sources,evidence:await this.evidence.list(tx,'INVENTORY_ADJUSTMENT',id),task,tasks,action,
   ledger:action?await tx.inventoryLedger.findMany({where:{actionId:action.id},orderBy:[{skuId:'asc'},{sequence:'asc'}]}):[],
   history:await tx.businessStateHistory.findMany({where:{aggregateType:'INVENTORY_ADJUSTMENT',aggregateId:id},orderBy:{createdAt:'asc'}})};
 });}
 async ledger(q:InventoryQueryDto){
  const where:Prisma.InventoryLedgerWhereInput={skuId:q.skuId,eventType:q.eventType,actorEmployeeId:q.actorEmployeeId,...(q.businessNumber?{businessNumber:{contains:q.businessNumber,mode:'insensitive'}}:{}),...(q.from||q.to?{createdAt:{gte:q.from?new Date(q.from):undefined,lte:q.to?new Date(q.to):undefined}}:{})};
  const [items,total]=await this.db.$transaction([this.db.inventoryLedger.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(q.page-1)*q.pageSize,take:q.pageSize}),this.db.inventoryLedger.count({where})]);return {items,total,page:q.page,pageSize:q.pageSize};
 }
 async action(id:string){const action=await this.db.inventoryAction.findUnique({where:{id}});if(!action)throw new InventoryError('INVENTORY_NOT_FOUND');
  // 未来动作要由真实订单/售后领域提供读取范围，当前不凭inventory.read越过其授权。
  if(action.businessType!=='ADJUSTMENT')throw new InventoryError('INVENTORY_DOMAIN_NOT_READY');return {...action,ledger:await this.db.inventoryLedger.findMany({where:{actionId:id},orderBy:[{skuId:'asc'},{sequence:'asc'}]})};
 }
}
