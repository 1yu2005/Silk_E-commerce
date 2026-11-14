// 作用：确认前完整验算来源、原根净量、批次与逐笔余额；核实失败之前不写成功动作。
import { Injectable } from '@nestjs/common';
import type { InventoryAdjustment, InventoryAdjustmentLine, Prisma } from '@prisma/client';
import type { InventoryEffect } from './inventory-kernel.service.js';
import { InventoryError } from './inventory.errors.js';
import { MAX } from './inventory-support.js';
export interface PostingPlan {effects:InventoryEffect[];sourceDeltas:Map<string,number>;batches:{sourceLineId:string;batchKey:string;rootAdjustmentLineId:string}[]}
@Injectable()
export class InventoryPosting {
 async plan(tx:Prisma.TransactionClient,adjustment:InventoryAdjustment,lines:InventoryAdjustmentLine[]):Promise<PostingPlan>{
  if(!lines.length)throw new InventoryError('VALIDATION_FAILED');
  const result:PostingPlan={effects:[],sourceDeltas:new Map(),batches:[]};const balances=new Map<string,{a:bigint;r:bigint}>();
  for(const line of [...lines].sort((a,b)=>a.skuId.localeCompare(b.skuId)||a.id.localeCompare(b.id))){
   const source=await tx.inventorySourceLine.findUnique({where:{id:line.sourceLineId}});
   if(!source||source.skuId!==line.skuId)throw new InventoryError('SOURCE_NOT_FOUND');
   const parent=await tx.inventorySource.findUniqueOrThrow({where:{id:source.sourceId}});
   let deltaA:number,rootId=line.id;
   if(adjustment.type==='CORRECTION'){
    const root=await tx.inventoryAdjustmentLine.findUnique({where:{id:line.rootLineId!}});
    const original=root?await tx.inventoryAdjustment.findUnique({where:{id:root.adjustmentId}}):null;
    if(!root||!original||original.status!=='POSTED'||root.type==='CORRECTION'||root.skuId!==line.skuId||root.sourceLineId!==line.sourceLineId)throw new InventoryError('CORRECTION_NOT_ALLOWED');
    const [sum]=await tx.$queryRaw<{net:string}[]>`SELECT COALESCE(SUM(delta_a::bigint),0)::text AS net FROM inventory_ledger WHERE root_adjustment_line_id=${root.id}::uuid`;
    deltaA=line.signedDeltaA!;const net=BigInt(sum!.net)+BigInt(deltaA);
    if((root.type==='AVAILABLE_LOSS'&&net>0n)||(root.type!=='AVAILABLE_LOSS'&&net<0n))throw new InventoryError('CORRECTION_NOT_ALLOWED');rootId=root.id;
   }else{
    if((adjustment.type==='AVAILABLE_LOSS')!==(parent.sourceType==='LOSS'))throw new InventoryError('VALIDATION_FAILED');
    deltaA=adjustment.type==='AVAILABLE_LOSS'?-line.quantity!:line.quantity!;
    if(adjustment.type!=='AVAILABLE_LOSS'){
     const prior=await tx.inventoryReceiptBatch.findUnique({where:{sourceLineId_batchKey:{sourceLineId:source.id,batchKey:line.batchKey!}}});
     if(prior){const oldLine=await tx.inventoryAdjustmentLine.findUniqueOrThrow({where:{id:prior.rootAdjustmentLineId}});const old=await tx.inventoryAdjustment.findUniqueOrThrow({where:{id:oldLine.adjustmentId}});
      throw new InventoryError('SOURCE_BATCH_ALREADY_POSTED',{adjustmentId:old.id,number:old.number});}
     result.batches.push({sourceLineId:source.id,batchKey:line.batchKey!,rootAdjustmentLineId:line.id});
    }
   }
   const sourceDelta=parent.sourceType==='LOSS'?-deltaA:deltaA;
   result.sourceDeltas.set(source.id,(result.sourceDeltas.get(source.id)??0)+sourceDelta);
   if(!balances.has(line.skuId)){const balance=await tx.inventoryBalance.findUniqueOrThrow({where:{skuId:line.skuId}});balances.set(line.skuId,{a:BigInt(balance.available),r:BigInt(balance.reserved)});}
   const balance=balances.get(line.skuId)!;balance.a+=BigInt(deltaA);
   if(balance.a<0n)throw new InventoryError('STOCK_INSUFFICIENT');if(balance.a>BigInt(MAX))throw new InventoryError('INVENTORY_LIMIT_EXCEEDED');
   result.effects.push({skuId:line.skuId,deltaA,deltaR:0,eventType:adjustment.type,sourceLineId:source.id,rootAdjustmentLineId:rootId});
  }
  for(const [id,delta]of result.sourceDeltas){const source=await tx.inventorySourceLine.findUniqueOrThrow({where:{id}});const net=BigInt(source.netPostedQuantity)+BigInt(delta);
   if(net<0n)throw new InventoryError('CORRECTION_NOT_ALLOWED');if(net>BigInt(source.verifiedQuantity))throw new InventoryError('SOURCE_QUANTITY_EXCEEDED');}
  return result;
 }
 async applySources(tx:Prisma.TransactionClient,plan:PostingPlan){
  for(const [id,delta]of plan.sourceDeltas){const count=await tx.$executeRaw`UPDATE inventory_source_line SET net_posted_quantity=(net_posted_quantity::bigint+${delta}::bigint)::integer,
   version=version+1,updated_at=clock_timestamp() WHERE id=${id}::uuid AND version<2147483647
   AND net_posted_quantity::bigint+${delta}::bigint BETWEEN 0 AND verified_quantity::bigint`;
   if(count!==1)throw new InventoryError('SOURCE_QUANTITY_EXCEEDED');}
  for(const batch of plan.batches)await tx.inventoryReceiptBatch.create({data:batch});
 }
}
