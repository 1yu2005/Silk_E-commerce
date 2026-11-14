// 作用：唯一的数量写入内核；仅供已验证真实业务事实的领域服务在同一事务调用，不提供HTTP。
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { requireSessionTransaction } from '../auth/session-support.js';
import { AuditService, type AuditActor } from '../audit/audit.service.js';
import { InventoryError } from './inventory.errors.js';
import { fingerprint, integer, MAX } from './inventory-support.js';
export interface InventoryEffect {
 skuId:string;deltaA:number;deltaR:number;eventType:string;
 sourceLineId?:string;rootAdjustmentLineId?:string;quantityReleased?:number;quantityDamaged?:number;
}
export interface InventoryCommand {
 businessType:'ADJUSTMENT'|'ORDER'|'PAYMENT'|'RETURN_INSPECTION'|'REFUND'; businessId:string;businessNumber:string;
 actionType:'MANUAL_POST'|'RESERVE'|'PAY'|'CLOSE'|'RETURN_RESTOCK'|'UNSHIPPED_REFUND_RESTOCK'|'PAID_PREPARATION_LOSS'|'ALLOCATE_REPLACEMENT';
 actionKey:string;semantic:unknown;actor:AuditActor;requestId:string;reason:string;effects:InventoryEffect[];
}
@Injectable()
export class InventoryKernel {
 constructor(@Inject(AuditService) private readonly audit:AuditService){}
 async replay(tx:Prisma.TransactionClient,key:string,semantic:unknown) {
  requireSessionTransaction(tx);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))::text AS locked`;
  const prior=await tx.inventoryAction.findUnique({where:{actionKey:key}});
  if(prior&&prior.requestFingerprint!==fingerprint(semantic))throw new InventoryError('INVENTORY_ACTION_CONFLICT');return prior;
 }
 /** 调用方先按全局顺序锁定员工/业务父/商品/SKU；失败不被本函数捕获，整条事务回滚。 */
 async execute(tx:Prisma.TransactionClient,command:InventoryCommand) {
  const prior=await this.replay(tx,command.actionKey,command.semantic);if(prior)return {changed:false,action:prior};
  const actionId=randomUUID(),effects=command.effects,ledgerIds=effects.map(()=>randomUUID());
  if(!effects.length&&!['RETURN_RESTOCK','UNSHIPPED_REFUND_RESTOCK'].includes(command.actionType))throw new InventoryError('VALIDATION_FAILED');
  const actor={actorType:command.actor.type,actorEmployeeId:command.actor.type==='EMPLOYEE'?command.actor.id:null,
   actorCustomerId:command.actor.type==='CUSTOMER'?command.actor.id:null};
  const action=await tx.inventoryAction.create({data:{id:actionId,businessType:command.businessType,businessId:command.businessId,
   actionType:command.actionType,actionKey:command.actionKey,requestFingerprint:fingerprint(command.semantic),
   adjustmentId:command.businessType==='ADJUSTMENT'?command.businessId:null,resultSummary:{actionId,ledgerIds},...actor,requestId:command.requestId}});
  const sequence=new Map<string,number>();
  for(const [index,effect]of effects.entries()){
   integer(effect.deltaA,-MAX);integer(effect.deltaR,-MAX);
   if(effect.deltaA===0&&effect.deltaR===0&&command.actionType!=='PAID_PREPARATION_LOSS')throw new InventoryError('VALIDATION_FAILED');
   const before=await tx.inventoryBalance.findUnique({where:{skuId:effect.skuId}});if(!before)throw new InventoryError('INVENTORY_NOT_FOUND');
   const a=BigInt(before.available)+BigInt(effect.deltaA),r=BigInt(before.reserved)+BigInt(effect.deltaR);
   if(a<0n||r<0n)throw new InventoryError('STOCK_INSUFFICIENT');if(a>BigInt(MAX)||r>BigInt(MAX)||before.version===MAX)throw new InventoryError('INVENTORY_LIMIT_EXCEEDED');
   const changed=await tx.$executeRaw`UPDATE inventory_balance SET available=(available::bigint+${effect.deltaA}::bigint)::integer,
    reserved=(reserved::bigint+${effect.deltaR}::bigint)::integer, version=version+1,updated_at=clock_timestamp()
    WHERE sku_id=${effect.skuId}::uuid AND version=${before.version} AND version<2147483647
    AND available::bigint+${effect.deltaA}::bigint BETWEEN 0 AND 2147483647
    AND reserved::bigint+${effect.deltaR}::bigint BETWEEN 0 AND 2147483647`;
   if(changed!==1)throw new InventoryError('VERSION_CONFLICT');
   const seq=(sequence.get(effect.skuId)??0)+1;sequence.set(effect.skuId,seq);
   await tx.inventoryLedger.create({data:{id:ledgerIds[index]!,actionId,skuId:effect.skuId,sequence:seq,eventType:effect.eventType,
    beforeA:before.available,beforeR:before.reserved,afterA:Number(a),afterR:Number(r),deltaA:effect.deltaA,deltaR:effect.deltaR,
    quantityReleased:effect.quantityReleased,quantityDamaged:effect.quantityDamaged,sourceLineId:effect.sourceLineId,
    rootAdjustmentLineId:effect.rootAdjustmentLineId,businessType:command.businessType,businessId:command.businessId,
    businessNumber:command.businessNumber,reason:command.reason,...actor,requestId:command.requestId}});
  }
  await this.audit.appendAudit(tx,{actor:command.actor,action:'inventory.action',targetId:action.id,requestId:command.requestId,reason:command.reason,
   after:{inventoryOperation:command.actionType,inventoryVersion:0,inventoryQuantity:effects.length}});
  return {changed:true,action};
 }
}
