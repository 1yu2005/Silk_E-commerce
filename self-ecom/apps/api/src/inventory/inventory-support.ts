// 作用：统一业务语义摘要、数量和稳定锁序；摘要不绑定重试者或requestId。
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { InventoryError } from './inventory.errors.js';
export const MAX=2147483647;
export function text(value:unknown,max:number,optional=false):string {
 if(optional&&(value===undefined||value===null||value===''))return '';
 if(typeof value!=='string'||!value.trim()||[...value.trim()].length>max)throw new InventoryError('VALIDATION_FAILED');
 return value.normalize('NFC').trim();
}
export const normalize=(value:string)=>value.normalize('NFC').trim().replace(/[a-z]/g,c=>c.toUpperCase());
export function integer(value:unknown,min=0,max=MAX):number {
 if(typeof value!=='number'||!Number.isInteger(value)||value<min||value>max)throw new InventoryError('VALIDATION_FAILED');return value;
}
function canonical(value:unknown):unknown {
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));
 return value;
}
export const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export async function lockStock(tx:Prisma.TransactionClient,skuIds:readonly string[]) {
 const ids=[...new Set(skuIds)].sort();if(!ids.length)return;
 const skus=await tx.sku.findMany({where:{id:{in:ids}},select:{productId:true}});
 if(skus.length!==ids.length)throw new InventoryError('INVENTORY_NOT_FOUND');
 for(const id of [...new Set(skus.map(s=>s.productId))].sort())await tx.$queryRaw`SELECT id FROM product WHERE id=${id}::uuid FOR UPDATE`;
 for(const id of ids){await tx.$queryRaw`SELECT id FROM sku WHERE id=${id}::uuid FOR UPDATE`;await tx.$queryRaw`SELECT sku_id FROM inventory_balance WHERE sku_id=${id}::uuid FOR UPDATE`;}
}
export async function lockSources(tx:Prisma.TransactionClient,ids:readonly string[]) {
 for(const id of [...new Set(ids)].sort())await tx.$queryRaw`SELECT id FROM inventory_source_line WHERE id=${id}::uuid FOR UPDATE`;
}
