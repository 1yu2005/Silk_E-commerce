// 作用：来源删除资格由真实引用决定；已作废登记、零净量历史和转换快照仍保留依据。
import type { Prisma } from '@prisma/client';

export async function sourceDeletion(tx:Prisma.TransactionClient,id:string){
 const lines=await tx.inventorySourceLine.findMany({where:{sourceId:id},select:{id:true,netPostedQuantity:true}});
 const sourceLineId={in:lines.map(line=>line.id)};
 const used=lines.some(line=>line.netPostedQuantity!==0)
  ||await tx.inventoryAdjustmentLine.count({where:{sourceLineId}})>0
  ||await tx.inventoryReceiptBatch.count({where:{sourceLineId}})>0
  ||await tx.inventoryLedger.count({where:{sourceLineId}})>0
  ||await tx.inventoryAdjustment.count({where:{conversionSnapshot:{path:['sourceId'],equals:id}}})>0;
 return {canDelete:!used,deleteBlockedReason:used?'已有库存登记、入账记录或转换记录引用，需保留来源凭据。':null};
}
