// 作用：库存读取投影只含岗位需要的字段；汇总转十进制字符串，公开商城继续使用既有脱敏投影。
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { runAuthTransaction } from '../auth/auth-transaction.js';
import { InventoryAccess, type InventoryContext } from './inventory-access.service.js';
import { InventoryEvidence } from './inventory-evidence.service.js';
import { InventoryError } from './inventory.errors.js';
import { sourceDeletion } from './inventory-source-deletion.js';
import { inventoryEmployeeNames, inventorySkuLabels } from './inventory-list-projection.js';
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
  const skuScope=q.skuScope??'current';
  if(skuScope!=='all')clauses.push(skuScope==='history'?Prisma.sql`s.retired_at IS NOT NULL`:Prisma.sql`s.retired_at IS NULL`);
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
  return this.db.$transaction(async tx=>{
   const rows=await tx.inventorySource.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(q.page-1)*q.pageSize,take:q.pageSize});
   const items=await Promise.all(rows.map(async row=>({...row,...await sourceDeletion(tx,row.id)})));
   const total=await tx.inventorySource.count({where});return {items,total,page:q.page,pageSize:q.pageSize};
  },readOptions);
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
  return {...row,...await sourceDeletion(tx,row.id),lines:result,evidence:await this.evidence.list(tx,'INVENTORY_SOURCE',id)};
 }
 async adjustments(q:InventoryQueryDto){
  if(q.from&&q.to&&new Date(q.from)>new Date(q.to))throw new InventoryError('VALIDATION_FAILED');
  return this.db.$transaction(async tx=>{
   const clauses=[Prisma.sql`true`];
   if(q.status)clauses.push(Prisma.sql`a.status::text=${q.status}`);
   if(q.type)clauses.push(Prisma.sql`a.type::text=${q.type}`);
   if(q.from)clauses.push(Prisma.sql`a.created_at>=${new Date(q.from)}`);
   if(q.to)clauses.push(Prisma.sql`a.created_at<=${new Date(q.to)}`);
   if(q.assigneeId)clauses.push(Prisma.sql`EXISTS(SELECT 1 FROM task t WHERE t.business_type='INVENTORY_ADJUSTMENT' AND t.business_id=a.id AND t.status='CLAIMED' AND t.assignee_id=${q.assigneeId}::uuid)`);
   const productClauses=[Prisma.sql`true`];
   if(q.productId)productClauses.push(Prisma.sql`p.id=${q.productId}::uuid`);
   if(q.categoryId)productClauses.push(Prisma.sql`EXISTS(SELECT 1 FROM category c WHERE c.id=p.category_id AND c.deleted_at IS NULL AND ${q.categoryId}::uuid=ANY(c.path_ids))`);
   if(q.productId||q.categoryId)clauses.push(Prisma.sql`EXISTS(SELECT 1 FROM inventory_adjustment_line l JOIN sku s ON s.id=l.sku_id JOIN product p ON p.id=s.product_id WHERE l.adjustment_id=a.id AND ${Prisma.join(productClauses,' AND ')})`);
   if(q.keyword){const keyword='%'+q.keyword.replace(/[\\%_]/g,'\\$&')+'%';clauses.push(Prisma.sql`(a.number ILIKE ${keyword} OR a.reason ILIKE ${keyword} OR EXISTS(SELECT 1 FROM inventory_adjustment_line l JOIN sku s ON s.id=l.sku_id JOIN product p ON p.id=s.product_id JOIN inventory_source_line sl ON sl.id=l.source_line_id JOIN inventory_source src ON src.id=sl.source_id WHERE l.adjustment_id=a.id AND (p.name ILIKE ${keyword} OR p.product_code ILIKE ${keyword} OR s.code ILIKE ${keyword} OR src.reference ILIKE ${keyword})))`);}
   const from=Prisma.sql`FROM inventory_adjustment a WHERE ${Prisma.join(clauses,' AND ')}`;
   const [count]=await tx.$queryRaw<{total:string}[]>(Prisma.sql`SELECT count(*)::text AS total ${from}`);
   const selected=await tx.$queryRaw<{id:string}[]>(Prisma.sql`SELECT a.id ${from} ORDER BY a.created_at DESC,a.id DESC OFFSET ${(q.page-1)*q.pageSize} LIMIT ${q.pageSize}`);
   const ids=selected.map(r=>r.id),rows=await tx.inventoryAdjustment.findMany({where:{id:{in:ids}}});
   const lines=await tx.inventoryAdjustmentLine.findMany({where:{adjustmentId:{in:ids}},orderBy:{id:'asc'}});
   const labels=await inventorySkuLabels(tx,lines.map(l=>l.skuId));
   const sourceLines=await tx.inventorySourceLine.findMany({where:{id:{in:lines.map(l=>l.sourceLineId)}},select:{id:true,sourceId:true}});
   const sources=await tx.inventorySource.findMany({where:{id:{in:sourceLines.map(l=>l.sourceId)}},select:{id:true,reference:true}});
   const references=new Map(sourceLines.map(l=>[l.id,sources.find(s=>s.id===l.sourceId)?.reference??'']));
   const tasks=await tx.task.findMany({where:{businessType:'INVENTORY_ADJUSTMENT',businessId:{in:ids},status:{in:['OPEN','CLAIMED']}},select:{id:true,businessId:true,stage:true,status:true,assigneeId:true}});
   const names=await inventoryEmployeeNames(tx,[...rows.map(r=>r.createdById),...tasks.map(t=>t.assigneeId)]);
   const mapped=new Map(rows.map(row=>{const task=tasks.find(t=>t.businessId===row.id&&t.stage===(row.checkRequired?'INVENTORY_RECONCILE':'INVENTORY_POST'));
    return [row.id,{...row,createdByName:names.get(row.createdById)??'员工',task:task?{id:task.id,status:task.status,assigneeId:task.assigneeId,assigneeName:task.assigneeId?names.get(task.assigneeId)??'员工':null}:null,
     lines:lines.filter(l=>l.adjustmentId===row.id).map(l=>({...labels.get(l.skuId)!,id:l.id,skuId:l.skuId,batchKey:l.batchKey,sourceReference:references.get(l.sourceLineId)??'',deltaA:l.type==='CORRECTION'?l.signedDeltaA!:l.type==='AVAILABLE_LOSS'?-l.quantity!:l.quantity!}))}];}));
   return {items:ids.map(id=>mapped.get(id)!),total:Number(count!.total),page:q.page,pageSize:q.pageSize};
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
  if(q.from&&q.to&&new Date(q.from)>new Date(q.to))throw new InventoryError('VALIDATION_FAILED');
  return this.db.$transaction(async tx=>{
   const clauses=[Prisma.sql`true`];
   if(q.skuId)clauses.push(Prisma.sql`l.sku_id=${q.skuId}::uuid`);
   if(q.productId)clauses.push(Prisma.sql`p.id=${q.productId}::uuid`);
   if(q.categoryId)clauses.push(Prisma.sql`EXISTS(SELECT 1 FROM category c WHERE c.id=p.category_id AND c.deleted_at IS NULL AND ${q.categoryId}::uuid=ANY(c.path_ids))`);
   if(q.keyword){const keyword='%'+q.keyword.replace(/[\\%_]/g,'\\$&')+'%';clauses.push(Prisma.sql`(p.name ILIKE ${keyword} OR p.product_code ILIKE ${keyword} OR s.code ILIKE ${keyword})`);}
   if(q.eventType)clauses.push(Prisma.sql`l.event_type=${q.eventType}`);
   if(q.actorEmployeeId)clauses.push(Prisma.sql`l.actor_employee_id=${q.actorEmployeeId}::uuid`);
   if(q.businessNumber)clauses.push(Prisma.sql`l.business_number ILIKE ${'%'+q.businessNumber.replace(/[\\%_]/g,'\\$&')+'%'}`);
   if(q.from)clauses.push(Prisma.sql`l.created_at>=${new Date(q.from)}`);
   if(q.to)clauses.push(Prisma.sql`l.created_at<=${new Date(q.to)}`);
   const matched=Prisma.sql`SELECT l.id,l.created_at,l.sequence,s.product_id FROM inventory_ledger l JOIN sku s ON s.id=l.sku_id JOIN product p ON p.id=s.product_id WHERE ${Prisma.join(clauses,' AND ')}`;
   const [count]=await tx.$queryRaw<{records:string;products:string}[]>(Prisma.sql`WITH matched AS (${matched}) SELECT count(*)::text AS records,count(DISTINCT product_id)::text AS products FROM matched`);
   const grouped=q.groupBy==='product',paging=Prisma.sql`OFFSET ${(q.page-1)*q.pageSize} LIMIT ${q.pageSize}`;
   const groups=grouped?await tx.$queryRaw<{productId:string;recordCount:number}[]>(Prisma.sql`WITH matched AS (${matched}) SELECT product_id AS "productId",count(*)::int AS "recordCount" FROM matched GROUP BY product_id ORDER BY max(created_at) DESC,product_id ${paging}`):[];
   // 商品视图每款预览最近 5 笔；查看整款历史时切换为该商品的流水分页，避免组被页边界截断。
   const selected=grouped?(groups.length?await tx.$queryRaw<{id:string}[]>(Prisma.sql`WITH matched AS (${matched}),ranked AS (SELECT *,row_number() OVER(PARTITION BY product_id ORDER BY created_at DESC,id DESC) AS rank FROM matched WHERE product_id IN (${Prisma.join(groups.map(g=>Prisma.sql`${g.productId}::uuid`))})) SELECT id FROM ranked WHERE rank<=5 ORDER BY created_at DESC,id DESC`):[]):await tx.$queryRaw<{id:string}[]>(Prisma.sql`WITH matched AS (${matched}) SELECT id FROM matched ORDER BY created_at DESC,id DESC ${paging}`);
   const ids=selected.map(r=>r.id),rows=await tx.inventoryLedger.findMany({where:{id:{in:ids}}});
   const labels=await inventorySkuLabels(tx,rows.map(r=>r.skuId)),names=await inventoryEmployeeNames(tx,rows.map(r=>r.actorEmployeeId));
   const mapped=new Map(rows.map(row=>[row.id,{...row,...labels.get(row.skuId)!,actorName:row.actorEmployeeId?names.get(row.actorEmployeeId)??'员工':row.actorType==='CUSTOMER'?'顾客':'系统'}]));
   return {items:ids.map(id=>mapped.get(id)!),groups,total:Number(grouped?count!.products:count!.records),recordTotal:Number(count!.records),productTotal:Number(count!.products),groupBy:grouped?'product' as const:'sku' as const,page:q.page,pageSize:q.pageSize};
  },readOptions);
 }
 async action(id:string){const action=await this.db.inventoryAction.findUnique({where:{id}});if(!action)throw new InventoryError('INVENTORY_NOT_FOUND');
  // 未来动作要由真实订单/售后领域提供读取范围，当前不凭inventory.read越过其授权。
  if(action.businessType!=='ADJUSTMENT')throw new InventoryError('INVENTORY_DOMAIN_NOT_READY');return {...action,ledger:await this.db.inventoryLedger.findMany({where:{actionId:id},orderBy:[{skuId:'asc'},{sequence:'asc'}]})};
 }
}
