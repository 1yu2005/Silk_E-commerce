// 作用：履约输入、整单数量和真实来源校验；不修改库存账户。
import type {Prisma,OrderItem,Order} from '@prisma/client';
import {OrderError} from './order.errors.js';
export type PackingLine={orderItemId:string;checkedQuantity:number};
export function checkWholeOrder(items:Pick<OrderItem,'id'|'quantity'>[],lines:PackingLine[]){
 if(!Array.isArray(lines)||lines.length!==items.length||new Set(lines.map(l=>l.orderItemId)).size!==lines.length||lines.some(l=>!items.some(i=>i.id===l.orderItemId&&i.quantity===l.checkedQuantity)))throw new OrderError('VALIDATION_FAILED');
 return lines.map(l=>({orderItemId:l.orderItemId,checkedQuantity:l.checkedQuantity})).sort((a,b)=>a.orderItemId.localeCompare(b.orderItemId));
}
export async function shipmentBlocked(tx:Prisma.TransactionClient,id:string){return !!await tx.orderBlock.count({where:{orderId:id,active:true,blocksShipment:true}});}
export async function pendingHandover(tx:Prisma.TransactionClient,id:string){return tx.handoverAttempt.findFirst({where:{orderId:id,status:{in:['IN_PROGRESS','UNCERTAIN']}},orderBy:{attemptNo:'desc'}});}
export async function validPacking(tx:Prisma.TransactionClient,o:Order){const f=await tx.fulfillment.findUnique({where:{orderId:o.id}});const p=f?.currentPackingCheckId?await tx.packingCheck.findUnique({where:{id:f.currentPackingCheckId}}):null;return p&&p.orderId===o.id&&p.checkedPhysicalVersion===o.stockPhysicalVersion?p:null;}
export async function sourceBelongs(tx:Prisma.TransactionClient,id:string,type:string,sourceId:string){
 if(type==='STOCK_EXCEPTION')return !!await tx.stockIncidentItem.count({where:{incidentId:sourceId,orderItem:{orderId:id}}});
 if(type==='SHIPMENT_EXCEPTION')return !!await tx.shipmentException.count({where:{id:sourceId,orderId:id}});
 if(type==='HANDOVER_UNCERTAIN')return !!await tx.handoverAttempt.count({where:{id:sourceId,orderId:id}});
 return false;
}
