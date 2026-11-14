// 作用：规范凭据身份与核实数量；待确认登记不占来源额度，来源不提供删除或换SKU入口。
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { runAuthTransaction } from '../auth/auth-transaction.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { InventoryAccess, type InventoryContext } from './inventory-access.service.js';
import { InventoryEvidence } from './inventory-evidence.service.js';
import { InventoryError } from './inventory.errors.js';
import { integer, lockStock, normalize, text, MAX } from './inventory-support.js';
import type { SourceAddLineDto, SourceCreateDto, SourceVerifyDto } from './inventory.dto.js';
@Injectable()
export class InventorySources {
 constructor(@Inject(PrismaService) private readonly db:PrismaService,@Inject(InventoryAccess) private readonly access:InventoryAccess,
  @Inject(InventoryEvidence) private readonly evidence:InventoryEvidence,@Inject(AuditService) private readonly audit:AuditService){}
 async create(ctx:InventoryContext,input:SourceCreateDto){
  const namespace=normalize(text(input.namespace,80)),reference=text(input.reference??`INTERNAL-${randomUUID()}`,100),note=text(input.note,2000,true);
  if(!note&&!input.evidenceFileIds?.length)throw new InventoryError('VALIDATION_FAILED');
  const lines=input.lines.map(l=>({lineKey:normalize(text(l.lineKey,64)),skuId:l.skuId,verifiedQuantity:integer(l.verifiedQuantity,1)}));
  if(!lines.length||lines.length>200||new Set(lines.map(l=>l.lineKey)).size!==lines.length)throw new InventoryError('VALIDATION_FAILED');
  try{return await runAuthTransaction(this.db,async tx=>{
   const actor=await this.access.actor(tx,ctx,['inventory.source.manage']);await lockStock(tx,lines.map(l=>l.skuId));
   const row=await tx.inventorySource.create({data:{sourceType:input.sourceType,namespace,reference,normalizedReference:normalize(reference),note:note||null,createdById:actor.subjectId}});
   await tx.inventorySourceLine.createMany({data:lines.map(line=>({...line,sourceId:row.id}))});
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
   const line=await tx.inventorySourceLine.create({data:{sourceId:id,lineKey:normalize(text(input.lineKey,64)),skuId:input.skuId,verifiedQuantity:integer(input.verifiedQuantity,1)}});
   const updated=await tx.inventorySource.update({where:{id},data:{version:{increment:1}}});
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
  const updated=await tx.inventorySourceLine.update({where:{id},data:{verifiedQuantity:quantity,version:{increment:1}}});
  await tx.inventorySource.update({where:{id:line.sourceId},data:{version:{increment:1},note:text(input.evidenceNote,2000)}});
  await this.evidence.bind(tx,ctx,'INVENTORY_SOURCE',line.sourceId,input.evidenceFileIds,`verify:${id}:${line.version}`);
  await this.audit.appendAudit(tx,{actor:{type:'EMPLOYEE',id:actor.subjectId},action:'inventory.source',targetId:line.sourceId,requestId:ctx.requestId,reason:text(input.reason,500),
   before:{inventoryOperation:'VERIFY',inventoryVersion:line.version,inventoryQuantity:line.verifiedQuantity},after:{inventoryOperation:'VERIFY',inventoryVersion:updated.version,inventoryQuantity:quantity}});
  return {...updated,changed:true};
 });}
}
