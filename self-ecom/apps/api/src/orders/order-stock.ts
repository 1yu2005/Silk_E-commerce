// 作用：只从真实异常和补齐历史推导当前损耗；原损耗数字永不因补齐归零。
import type {Prisma} from '@prisma/client';
import {OrderError} from './order.errors.js';
export async function currentDamage(tx:Prisma.TransactionClient,orderId:string){
 const items=await tx.orderItem.findMany({where:{orderId},include:{incidents:{where:{verificationState:{not:'SETTLED'}},include:{replenishments:true,incident:true}}},orderBy:{skuId:'asc'}});
 return items.map(i=>{const facts=i.incidents.filter(f=>f.incident.status==='OPEN');const unknown=facts.some(f=>f.damagedQuantity===null||(f.damagedQuantity===0&&f.conclusion==='WAIT_REPLACEMENT'&&f.verificationState!=='REPLENISHED'));const damaged=facts.reduce((n,f)=>n+(f.damagedQuantity??0)-f.replenishments.reduce((q,r)=>q+r.quantity,0),0);
  if(damaged<0||damaged>i.quantity)throw new OrderError('STOCK_INCIDENT_CONFLICT');return {...i,unknown,damaged};});
}
export async function refreshDamage(tx:Prisma.TransactionClient,orderId:string){const lines=await currentDamage(tx,orderId);for(const l of lines)await tx.orderItem.update({where:{id:l.id},data:{damageUnknown:l.unknown,damagedReservedQuantity:l.damaged}});
 const unknown=lines.some(l=>l.unknown),damaged=lines.some(l=>l.damaged>0);await tx.order.update({where:{id:orderId},data:{paymentBlocked:unknown||damaged,releaseBlocked:unknown}});return lines;
}
