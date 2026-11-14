// 作用：从既有数量草稿读取数量快照并生成待确认登记；转换与实际入账严格分开。
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { runAuthTransaction } from '../auth/auth-transaction.js';
import { InventoryAccess, type InventoryContext } from './inventory-access.service.js';
import { InventoryAdjustments } from './inventory-adjustment.service.js';
import { InventoryError } from './inventory.errors.js';
import { fingerprint, lockSources, lockStock, normalize, text } from './inventory-support.js';
import type { InitialConvertDto } from './inventory.dto.js';
@Injectable()
export class InventoryConversion {
 constructor(@Inject(PrismaService) private readonly db:PrismaService,@Inject(InventoryAccess) private readonly access:InventoryAccess,
  @Inject(InventoryAdjustments) private readonly adjustments:InventoryAdjustments){}
 convert(ctx:InventoryContext,productId:string,input:InitialConvertDto){return runAuthTransaction(this.db,async tx=>{
  await this.access.actor(tx,ctx,['inventory.adjustment.create','product.manage']);
  await tx.$queryRaw`SELECT id FROM product WHERE id=${productId}::uuid FOR UPDATE`;
  const product=await tx.product.findUnique({where:{id:productId}});if(!product)throw new InventoryError('INVENTORY_NOT_FOUND');
  const draft=await tx.initialInventoryDraft.findFirst({where:{productId},orderBy:{createdAt:'desc'},include:{lines:true}});
  if(!draft)throw new InventoryError('INITIAL_DRAFT_NOT_EDITABLE');
  const mappings=input.mappings.map(m=>({...m,batchKey:normalize(text(m.batchKey,80))})).sort((a,b)=>a.skuId.localeCompare(b.skuId));
  if(new Set(mappings.map(m=>m.skuId)).size!==mappings.length)throw new InventoryError('VALIDATION_FAILED');
  const prior=await tx.inventoryAdjustment.findUnique({where:{conversionKey:draft.conversionKey}});
  const quantities=prior?(prior.conversionSnapshot as {quantities:Prisma.JsonValue}).quantities:
   draft.lines.filter(l=>l.quantity>0).map(l=>({skuId:l.skuId,quantity:l.quantity})).sort((a,b)=>a.skuId.localeCompare(b.skuId));
  const semantic={draftId:draft.id,quantities,sourceId:input.sourceId,mappings,reason:text(input.reason,500),evidenceNote:text(input.evidenceNote,2000,true),evidenceFileIds:[...(input.evidenceFileIds??[])].sort()};
  const digest=fingerprint(semantic);
  if(prior){if(prior.conversionFingerprint!==digest)throw new InventoryError('INITIAL_CONVERSION_CONFLICT');return {id:prior.id,changed:false,converted:true};}
  if(product.version!==input.expectedProductVersion||draft.version!==input.expectedDraftVersion)throw new InventoryError('VERSION_CONFLICT');
  if(draft.status!=='EDITABLE'||product.archivedAt)throw new InventoryError('INITIAL_DRAFT_NOT_EDITABLE');
  const nonzero=draft.lines.filter(l=>l.quantity>0);if(!nonzero.length)throw new InventoryError('INITIAL_DRAFT_EMPTY');
  if(nonzero.length!==mappings.length||nonzero.some(l=>!mappings.some(m=>m.skuId===l.skuId)))throw new InventoryError('VALIDATION_FAILED');
  await lockStock(tx,nonzero.map(l=>l.skuId));await lockSources(tx,mappings.map(m=>m.sourceLineId));
  const source=await tx.inventorySource.findUnique({where:{id:input.sourceId}});if(!source||source.sourceType!=='RECEIPT')throw new InventoryError('SOURCE_NOT_FOUND');
  const sourceLines=await tx.inventorySourceLine.findMany({where:{id:{in:mappings.map(m=>m.sourceLineId)},sourceId:source.id}});
  if(sourceLines.length!==mappings.length||mappings.some(m=>!sourceLines.some(l=>l.id===m.sourceLineId&&l.skuId===m.skuId)))throw new InventoryError('SOURCE_NOT_FOUND');
  const row=await this.adjustments.createInTransaction(tx,ctx,'INITIALIZATION',semantic.reason,input.evidenceNote,input.evidenceFileIds,
   nonzero.map(l=>{const m=mappings.find(m=>m.skuId===l.skuId)!;return {skuId:l.skuId,sourceLineId:m.sourceLineId,batchKey:m.batchKey,quantity:l.quantity};}),
   {key:draft.conversionKey,fingerprint:digest,snapshot:semantic as Prisma.InputJsonValue});
  await tx.initialInventoryDraft.update({where:{id:draft.id},data:{status:'CONVERTED',adjustmentId:row.id,version:{increment:1}}});
  await tx.product.update({where:{id:productId},data:{version:{increment:1},updatedById:ctx.actor.subjectId}});
  return {id:row.id,changed:true,converted:true};
 });}
}
