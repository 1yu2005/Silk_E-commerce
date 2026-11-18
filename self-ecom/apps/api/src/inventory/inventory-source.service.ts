// 作用：规范凭据身份与核实数量；仅无业务引用的来源可删除，不提供换SKU入口。
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { runAuthTransaction } from '../auth/auth-transaction.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { Clock } from '../common/time/clock.js';
import { InventoryAccess, type InventoryContext } from './inventory-access.service.js';
import { InventoryEvidence } from './inventory-evidence.service.js';
import { InventoryError } from './inventory.errors.js';
import { integer, lockStock, normalize, text, MAX } from './inventory-support.js';
import type { InventoryReasonDto, SourceAddLineDto, SourceCreateDto, SourceVerifyDto } from './inventory.dto.js';
import { sourceDeletion } from './inventory-source-deletion.js';
@Injectable()
export class InventorySources {
 constructor(@Inject(PrismaService) private readonly db:PrismaService,@Inject(InventoryAccess) private readonly access:InventoryAccess,
  @Inject(InventoryEvidence) private readonly evidence:InventoryEvidence,@Inject(AuditService) private readonly audit:AuditService,@Inject(Clock) private readonly clock:Clock){}
 async remove(ctx:InventoryContext,id:string,input:InventoryReasonDto){
  try{return await runAuthTransaction(this.db,async tx=>{
   const actor=await this.access.actor(tx,ctx,['inventory.source.manage']);
   // 来源维护先锁父凭据，再锁来源行；登记建单持来源行锁，引用判断在等待结束后重新读取。
   await tx.$queryRaw`SELECT id FROM inventory_source WHERE id=${id}::uuid FOR UPDATE`;
   const row=await tx.inventorySource.findUnique({where:{id}});if(!row)throw new InventoryError('SOURCE_NOT_FOUND');
   if(row.version!==input.expectedVersion||row.version===MAX)throw new InventoryError('VERSION_CONFLICT');
   await tx.$queryRaw`SELECT id FROM inventory_source_line WHERE source_id=${row.id}::uuid ORDER BY id FOR UPDATE`;
   if(!(await sourceDeletion(tx,row.id)).canDelete)throw new InventoryError('SOURCE_IN_USE');
   const reason=text(input.reason,500);
   const refs=await tx.fileReference.findMany({where:{ownerType:'INVENTORY_SOURCE',ownerId:row.id},select:{fileAssetId:true}});
   const files=[...new Set(refs.map(ref=>ref.fileAssetId))].sort();
   if(files.length)await tx.$queryRaw(Prisma.sql`SELECT id FROM file_asset WHERE id IN (${Prisma.join(files.map(file=>Prisma.sql`${file}::uuid`))}) ORDER BY id FOR UPDATE`);
   // 只移除此来源的明细和图片关联；文件实体、库存余额、流水与审计均保留。
   await tx.fileReference.deleteMany({where:{ownerType:'INVENTORY_SOURCE',ownerId:row.id}});
   await tx.inventorySourceLine.deleteMany({where:{sourceId:row.id}});
   await tx.inventorySource.delete({where:{id:row.id}});
   await this.audit.appendAudit(tx,{actor:{type:'EMPLOYEE',id:actor.subjectId},action:'inventory.source',targetId:row.id,requestId:ctx.requestId,reason,
    before:{inventoryVersion:row.version},after:{inventoryOperation:'DELETE',inventoryVersion:row.version+1,inventoryQuantity:0}});
   return {id:row.id,deleted:true};
  });}catch(error){if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2003')throw new InventoryError('SOURCE_IN_USE');throw error;}
 }
 async create(ctx:InventoryContext,input:SourceCreateDto){
  const namespace=normalize(text(input.namespace,80)),reference=text(input.reference??`INTERNAL-${randomUUID()}`,100),note=text(input.note,2000,true);
  if(!note&&!input.evidenceFileIds?.length)throw new InventoryError('VALIDATION_FAILED');
  const lines=input.lines.map(l=>({lineKey:normalize(text(l.lineKey,64)),skuId:l.skuId,verifiedQuantity:integer(l.verifiedQuantity,1)}));
  if(!lines.length||lines.length>200||new Set(lines.map(l=>l.lineKey)).size!==lines.length)throw new InventoryError('VALIDATION_FAILED');
  try{return await runAuthTransaction(this.db,async tx=>{
   const actor=await this.access.actor(tx,ctx,['inventory.source.manage']);await lockStock(tx,lines.map(l=>l.skuId));
   const now=this.clock.now();
   const row=await tx.inventorySource.create({data:{createdAt:now,updatedAt:now,sourceType:input.sourceType,namespace,reference,normalizedReference:normalize(reference),note:note||null,createdById:actor.subjectId}});
   await tx.inventorySourceLine.createMany({data:lines.map(line=>({...line,sourceId:row.id,createdAt:now,updatedAt:now}))});
   await this.evidence.bind(tx,ctx,'INVENTORY_SOURCE',row.id,input.evidenceFileIds,'create');
   await this.access.actor(tx,ctx,['inventory.source.manage'],false);
   await this.audit.appendAudit(tx,{actor:{type:'EMPLOYEE',id:actor.subjectId},action:'inventory.source',targetId:row.id,requestId:ctx.requestId,reason:note.slice(0,500)||'来源图片核实',after:{inventoryOperation:'CREATE',inventoryVersion:0,inventoryQuantity:lines.length}});
   return {...row,changed:true};
  });}catch(e){if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2002')throw new InventoryError('SOURCE_ALREADY_EXISTS');throw e;}
 }
 async addLine(ctx:InventoryContext,id:string,input:SourceAddLineDto){
  try{return await runAuthTransaction(this.db,async tx=>{
   const actor=await this.access.actor(tx,ctx,['inventory.source.manage']);await lockStock(tx,[input.skuId]);
   await tx.$queryRaw`SELECT id FROM inventory_source WHERE id=${id}::uuid FOR UPDATE`;
   const source=await tx.inventorySource.findUnique({where:{id}});if(!source)throw new InventoryError('SOURCE_NOT_FOUND');
   if(source.version===MAX)throw new InventoryError('INVENTORY_LIMIT_EXCEEDED');
   if(source.version!==input.expectedSourceVersion)throw new InventoryError('VERSION_CONFLICT');
   const now=this.clock.now();
   const line=await tx.inventorySourceLine.create({data:{createdAt:now,updatedAt:now,sourceId:id,lineKey:normalize(text(input.lineKey,64)),skuId:input.skuId,verifiedQuantity:integer(input.verifiedQuantity,1)}});
   const updated=await tx.inventorySource.update({where:{id},data:{updatedAt:now,version:{increment:1}}});
   await this.audit.appendAudit(tx,{actor:{type:'EMPLOYEE',id:actor.subjectId},action:'inventory.source',targetId:id,requestId:ctx.requestId,reason:text(input.reason,500),after:{inventoryOperation:'EDIT',inventoryVersion:updated.version,inventoryQuantity:input.verifiedQuantity}});
   return {...line,sourceVersion:updated.version,changed:true};
  });}catch(e){if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2002')throw new InventoryError('SOURCE_ALREADY_EXISTS');throw e;}
 }
 verify(ctx:InventoryContext,id:string,input:SourceVerifyDto){return runAuthTransaction(this.db,async tx=>{
  const actor=await this.access.actor(tx,ctx,['inventory.source.manage']);
  const candidate=await tx.inventorySourceLine.findUnique({where:{id}});if(!candidate)throw new InventoryError('SOURCE_NOT_FOUND');
  await lockStock(tx,[candidate.skuId]);await tx.$queryRaw`SELECT id FROM inventory_source WHERE id=${candidate.sourceId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM inventory_source_line WHERE id=${id}::uuid FOR UPDATE`;
  const line=await tx.inventorySourceLine.findUniqueOrThrow({where:{id}});if(line.version!==input.expectedVersion)throw new InventoryError('VERSION_CONFLICT');
  const source=await tx.inventorySource.findUniqueOrThrow({where:{id:line.sourceId}});
  if(line.version===MAX||source.version===MAX)throw new InventoryError('INVENTORY_LIMIT_EXCEEDED');
  const quantity=integer(input.verifiedQuantity,1);if(quantity<line.netPostedQuantity)throw new InventoryError('SOURCE_QUANTITY_BELOW_POSTED');
  const now=this.clock.now();
  const updated=await tx.inventorySourceLine.update({where:{id},data:{updatedAt:now,verifiedQuantity:quantity,version:{increment:1}}});
  await tx.inventorySource.update({where:{id:line.sourceId},data:{updatedAt:now,version:{increment:1},note:text(input.evidenceNote,2000)}});
  await this.evidence.bind(tx,ctx,'INVENTORY_SOURCE',line.sourceId,input.evidenceFileIds,`verify:${id}:${line.version}`);
  await this.audit.appendAudit(tx,{actor:{type:'EMPLOYEE',id:actor.subjectId},action:'inventory.source',targetId:line.sourceId,requestId:ctx.requestId,reason:text(input.reason,500),
   before:{inventoryOperation:'VERIFY',inventoryVersion:line.version,inventoryQuantity:line.verifiedQuantity},after:{inventoryOperation:'VERIFY',inventoryVersion:updated.version,inventoryQuantity:quantity}});
  return {...updated,changed:true};
 });}
}
