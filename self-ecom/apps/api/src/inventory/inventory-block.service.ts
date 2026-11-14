// 作用：以异常来源分别暂停新购，解除一项不会清除其它来源；仅由领域核实流程调用。
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService, type AuditActor } from '../audit/audit.service.js';
import { InventoryError } from './inventory.errors.js';
import { requireSessionTransaction } from '../auth/session-support.js';
@Injectable()
export class InventoryBlocks {
 constructor(@Inject(AuditService) private readonly audit:AuditService){}
 async open(tx:Prisma.TransactionClient,skuId:string,sourceType:string,sourceId:string,reasonCode:string,actor:AuditActor,requestId:string){
  requireSessionTransaction(tx);
  const old=await tx.inventoryPurchaseBlock.findFirst({where:{skuId,sourceType,sourceId,active:true}});if(old)return old;
  const row=await tx.inventoryPurchaseBlock.create({data:{skuId,sourceType,sourceId,reasonCode,createdByEmployeeId:actor.type==='EMPLOYEE'?actor.id:null}});
  const changed=await tx.inventoryBalance.updateMany({where:{skuId,version:{lt:2147483647}},data:{purchaseBlocked:true,version:{increment:1}}});
  if(changed.count!==1)throw new InventoryError('INVENTORY_LIMIT_EXCEEDED');
  await this.audit.appendAudit(tx,{actor,action:'inventory.block',targetId:row.id,requestId,reason:reasonCode,after:{inventoryOperation:'BLOCK',inventoryVersion:0,inventoryQuantity:1}});return row;
 }
 async resolve(tx:Prisma.TransactionClient,skuId:string,sourceType:string,sourceId:string,actor:AuditActor,requestId:string,reason:string){
  requireSessionTransaction(tx);
  const rows=await tx.inventoryPurchaseBlock.findMany({where:{skuId,sourceType,sourceId,active:true}});
  for(const row of rows){
   await tx.inventoryPurchaseBlock.update({where:{id:row.id},data:{active:false,releasedAt:new Date(),version:{increment:1}}});
   await this.audit.appendAudit(tx,{actor,action:'inventory.block',targetId:row.id,requestId,reason,after:{inventoryOperation:'UNBLOCK',inventoryVersion:row.version+1,inventoryQuantity:0}});
  }
  if(rows.length){const active=await tx.inventoryPurchaseBlock.count({where:{skuId,active:true}});
   const changed=await tx.inventoryBalance.updateMany({where:{skuId,version:{lt:2147483647}},data:{purchaseBlocked:active>0,version:{increment:1}}});
   if(changed.count!==1)throw new InventoryError('INVENTORY_LIMIT_EXCEEDED');}
 }
}
