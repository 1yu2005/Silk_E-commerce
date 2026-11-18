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
// 单次读取中的单据、任务、来源、余额及分页统计必须来自同一快照。
const readOptions={isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:5000};
@Injectable()
export class InventoryQueries {
 constructor(@Inject(PrismaService) private readonly db:PrismaService,@Inject(InventoryEvidence) private readonly evidence:InventoryEvidence,
  @Inject(InventoryAccess) private readonly access:InventoryAccess,@Inject(AuditService) private readonly audit:AuditService){}
 async balances(q:InventoryQueryDto){
  const clauses=[Prisma.sql`true`];if(q.skuId)clauses.push(Prisma.sql`b.sku_id=${q.skuId}::uuid`);
  if(q.keyword)clauses.push(Prisma.sql`(s.code ILIKE ${'%'+q.keyword+'%'} OR p.name ILIKE ${'%'+q.keyword+'%'})`);
  if(q.lowStock)clauses.push(q.lowStock==='true'?Prisma.sql`b.available<=b.warning_threshold`:Prisma.sql`b.available>b.warning_threshold`);
  if(q.purchaseBlocked)clauses.push(Prisma.sql`b.purchase_blocked=${q.purchaseBlocked==='true'}`);
  if(q.categoryId)clauses.push(Prisma.sql`EXISTS (SELECT 1 FROM category c WHERE c.id=p.category_id AND c.deleted_at IS NULL AND ${q.categoryId}::uuid=ANY(c.path_ids))`);
  const where=Prisma.join(clauses,' AND ');
  const groupBy=q.groupBy??'sku';
  return this.db.$transaction(async tx=>{
   // 先分页商品身份再取整组，避免同款规格被SKU页边界拆开；未显式分组的候选查询仍按SKU分页。
   const matched=Prisma.sql`SELECT b.sku_id,p.id AS product_id,p.name AS product_name,s.code,s.retired_at IS NOT NULL AS retired,
    ARRAY(SELECT v.sort_order FROM sku_spec_choice sc JOIN product_spec_dimension d ON d.id=sc.dimension_id
     JOIN product_spec_value v ON v.id=sc.value_id WHERE sc.sku_id=s.id ORDER BY d.sort_order,d.id) AS spec_order
    FROM inventory_balance b JOIN sku s ON s.id=b.sku_id JOIN product p ON p.id=s.product_id WHERE ${where}`;
   const paging=Prisma.sql`OFFSET ${(q.page-1)*q.pageSize} LIMIT ${q.pageSize}`;
   const rows=await tx.$queryRaw<{sku_id:string}[]>(Prisma.sql`WITH matched AS (${matched}) SELECT m.sku_id FROM matched m
    ${groupBy==='product'?Prisma.sql`JOIN (SELECT product_id,product_name FROM matched GROUP BY product_id,product_name ORDER BY product_name,product_id ${paging}) page ON page.product_id=m.product_id`:Prisma.empty}
    ORDER BY m.product_name,m.product_id,m.retired,m.spec_order,m.code,m.sku_id ${groupBy==='sku'?paging:Prisma.empty}`);
   const [total]=await tx.$queryRaw<{count:string;products:string;available:string;reserved:string}[]>(Prisma.sql`SELECT COUNT(*)::text AS count,COUNT(DISTINCT p.id)::text AS products,COALESCE(SUM(b.available::bigint),0)::text AS available,COALESCE(SUM(b.reserved::bigint),0)::text AS reserved FROM inventory_balance b JOIN sku s ON s.id=b.sku_id JOIN product p ON p.id=s.product_id WHERE ${where}`);
   const items=await this.balancesTx(tx,rows.map(r=>r.sku_id));
   return {items,total:Number(groupBy==='product'?total!.products:total!.count),groupBy,productTotal:Number(total!.products),skuTotal:Number(total!.count),page:q.page,pageSize:q.pageSize,availableTotal:total!.available,reservedTotal:total!.reserved};
  },readOptions);
 }
 balance(id:string){return this.db.$transaction(tx=>this.balanceTx(tx,id),readOptions);}
 private async balanceTx(tx:Prisma.TransactionClient,id:string){
  const [row]=await this.balancesTx(tx,[id]);if(!row)throw new InventoryError('INVENTORY_NOT_FOUND');return row;
 }
 private async balancesTx(tx:Prisma.TransactionClient,ids:string[]){
  if(!ids.length)return [];
  const balances=await tx.inventoryBalance.findMany({where:{skuId:{in:ids}},include:{sku:{include:{product:{select:{id:true,name:true,productCode:true,category:{select:{pathIds:true}}}},choices:{orderBy:[{dimension:{sortOrder:'asc'}},{dimensionId:'asc'}],include:{dimension:true,value:true}}}}}});
  const blocks=await tx.inventoryPurchaseBlock.findMany({where:{skuId:{in:ids},active:true},select:{skuId:true,id:true,sourceType:true,sourceId:true,reasonCode:true,createdAt:true}});
  const categories=await tx.category.findMany({where:{id:{in:[...new Set(balances.flatMap(b=>b.sku.product.category?.pathIds??[]))]}},select:{id:true,name:true}});
  const names=new Map(categories.map(c=>[c.id,c.name]));
  const rows=new Map(balances.map(b=>[b.skuId,{
   skuId:b.skuId,code:b.sku.code,productId:b.sku.product.id,productCode:b.sku.product.productCode,productName:b.sku.product.name,
   categoryPath:(b.sku.product.category?.pathIds??[]).map(id=>names.get(id)??'未知分类'),skuEnabled:b.sku.enabled,skuRetired:b.sku.retiredAt!==null,
   choices:b.sku.choices.map(c=>`${c.dimension.name}：${c.value.name}`),available:b.available,reserved:b.reserved,warningThreshold:b.warningThreshold,
   lowStock:b.available<=b.warningThreshold,purchaseBlocked:b.purchaseBlocked,version:b.version,
   blocks:blocks.filter(block=>block.skuId===b.skuId).map(({id,sourceType,sourceId,reasonCode,createdAt})=>({id,sourceType,sourceId,reasonCode,createdAt}))
  }]));
  return ids.map(id=>rows.get(id)!);
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
  const [items,total]=await this.db.$transaction([this.db.inventorySource.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(q.page-1)*q.pageSize,take:q.pageSize}),this.db.inventorySource.count({where})],readOptions);return {items,total,page:q.page,pageSize:q.pageSize};
 }
 source(id:string){return this.db.$transaction(tx=>this.sourceTx(tx,id),readOptions);}
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
  return this.db.$transaction(async tx=>{
  const ids=q.assigneeId?(await tx.task.findMany({where:{businessType:'INVENTORY_ADJUSTMENT',assigneeId:q.assigneeId,status:'CLAIMED'},select:{businessId:true}})).map(t=>t.businessId):undefined;
  const where:Prisma.InventoryAdjustmentWhereInput={status:q.status,type:q.type,...(ids?{id:{in:ids}}:{}),...(q.keyword?{number:{contains:q.keyword,mode:'insensitive'}}:{}),...(q.from||q.to?{createdAt:{gte:q.from?new Date(q.from):undefined,lte:q.to?new Date(q.to):undefined}}:{})};
  const items=await tx.inventoryAdjustment.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(q.page-1)*q.pageSize,take:q.pageSize}),total=await tx.inventoryAdjustment.count({where});return {items,total,page:q.page,pageSize:q.pageSize};
  },readOptions);
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
 },readOptions);}
 async ledger(q:InventoryQueryDto){
  const where:Prisma.InventoryLedgerWhereInput={skuId:q.skuId,eventType:q.eventType,actorEmployeeId:q.actorEmployeeId,...(q.businessNumber?{businessNumber:{contains:q.businessNumber,mode:'insensitive'}}:{}),...(q.from||q.to?{createdAt:{gte:q.from?new Date(q.from):undefined,lte:q.to?new Date(q.to):undefined}}:{})};
  const [items,total]=await this.db.$transaction([this.db.inventoryLedger.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(q.page-1)*q.pageSize,take:q.pageSize}),this.db.inventoryLedger.count({where})],readOptions);return {items,total,page:q.page,pageSize:q.pageSize};
 }
 async action(id:string){const action=await this.db.inventoryAction.findUnique({where:{id}});if(!action)throw new InventoryError('INVENTORY_NOT_FOUND');
  // 未来动作要由真实订单/售后领域提供读取范围，当前不凭inventory.read越过其授权。
  if(action.businessType!=='ADJUSTMENT')throw new InventoryError('INVENTORY_DOMAIN_NOT_READY');return {...action,ledger:await this.db.inventoryLedger.findMany({where:{actionId:id},orderBy:[{skuId:'asc'},{sequence:'asc'}]})};
 }
}
