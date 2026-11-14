// 作用：证据只追加保留，来源与登记各自拥有附件，不跨聚合复制绑定。
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { FileBindingService } from '../files/file-binding.service.js';
import { InventoryError } from './inventory.errors.js';
import type { InventoryContext } from './inventory-access.service.js';
@Injectable()
export class InventoryEvidence {
 constructor(@Inject(FileBindingService) private readonly bindings:FileBindingService){}
 async bind(tx:Prisma.TransactionClient,ctx:InventoryContext,ownerType:'INVENTORY_SOURCE'|'INVENTORY_ADJUSTMENT',ownerId:string,ids:string[]|undefined,key:string){
  if(!ids?.length)return;
  const old=await tx.fileReference.findMany({where:{ownerType,ownerId},select:{fileAssetId:true}});
  if(new Set([...old.map(r=>r.fileAssetId),...ids]).size>5)throw new InventoryError('VALIDATION_FAILED');
  await this.bindings.bindFiles(tx,{identity:ctx.actor,token:ctx.token},{ownerType,ownerId,slot:'evidence',audience:'INTERNAL',fileIds:ids,commandKey:key});
 }
 async list(tx:Prisma.TransactionClient,ownerType:'INVENTORY_SOURCE'|'INVENTORY_ADJUSTMENT',ownerId:string){
  const refs=await tx.fileReference.findMany({where:{ownerType,ownerId},orderBy:{createdAt:'asc'},select:{fileAssetId:true}});
  return refs.map(ref=>({id:ref.fileAssetId,contentUrl:`/api/v1/files/${ref.fileAssetId}/content`}));
 }
}
