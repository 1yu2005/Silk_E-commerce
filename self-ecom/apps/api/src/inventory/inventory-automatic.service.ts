// 作用：把受信任的订单/实物事实翻译为固定库存规则；生产无父领域时默认拒绝，不暴露HTTP。
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuditActor } from '../audit/audit.service.js';
import { requireSessionTransaction } from '../auth/session-support.js';
import { InventoryKernel, type InventoryCommand, type InventoryEffect } from './inventory-kernel.service.js';
import { InventoryError } from './inventory.errors.js';
import { integer, lockStock } from './inventory-support.js';
export type AutomaticOperation=Exclude<InventoryCommand['actionType'],'MANUAL_POST'>;
export interface InventoryFactLine {
 readonly skuId:string;readonly quantity:number;readonly damaged:number|null;readonly saleable:number;readonly received:number;
 readonly replacementQuantity:number;readonly unfilledQuantity:number;
}
export interface InventoryDomainFacts {
 readonly factId:string;readonly businessId:string;readonly number:string;readonly state:'NEW'|'UNPAID'|'PAID'|'CLOSED'|'REFUNDED'|'INSPECTED';
 readonly lines:readonly InventoryFactLine[];readonly actor:AuditActor;readonly deadline:Date|null;readonly paymentBlocked:boolean;
 readonly paymentSucceeded:boolean;readonly refundSucceeded:boolean;readonly handover:'NONE'|'UNKNOWN'|'HANDED';
 readonly finalInspection:boolean;readonly exceptionApproved:boolean;readonly completeReceived:boolean;readonly finalPhysicalCheck:boolean;
 readonly afterSaleId:string|null;readonly checkedAfterSaleId:string|null;readonly physicalVersion:number;readonly checkedPhysicalVersion:number;
 readonly restockedByOtherPath:boolean;
}
/** lockAndAuthorize须依序锁主体/顾客/真实父单并验证当前会话和业务归属；缺父单必须拒绝。
 * readLocked复核事实，apply同事务写成功支付/关闭/验收、分配与实物版本失效，不能请求后异步补写。
 * 每个事实事件保存不可变的数量/核实版本快照供成功重放；当前状态/版本仍独立校验首次动作。
 */
export interface InventoryDomainPort {
 lockAndAuthorize(tx:Prisma.TransactionClient,operation:AutomaticOperation,factId:string,access:unknown):Promise<InventoryDomainFacts>;
 readLocked(tx:Prisma.TransactionClient,operation:AutomaticOperation,factId:string):Promise<InventoryDomainFacts>;
 apply(tx:Prisma.TransactionClient,operation:AutomaticOperation,facts:InventoryDomainFacts,actionId:string):Promise<void>;
}
@Injectable()
export class InventoryDomainPorts {
 private readonly ports=new Map<AutomaticOperation,InventoryDomainPort>();
 register(operation:AutomaticOperation,port:InventoryDomainPort){if(this.ports.has(operation))throw new Error('自动库存领域端口重复');this.ports.set(operation,port);}
 require(operation:AutomaticOperation){const port=this.ports.get(operation);if(!port)throw new InventoryError('INVENTORY_DOMAIN_NOT_READY');return port;}
}
@Injectable()
export class InventoryAutomatic {
 constructor(@Inject(InventoryDomainPorts) private readonly ports:InventoryDomainPorts,@Inject(InventoryKernel) private readonly kernel:InventoryKernel){}
 async execute(tx:Prisma.TransactionClient,operation:AutomaticOperation,factId:string,access:unknown,requestId:string){
  requireSessionTransaction(tx);const port=this.ports.require(operation);const candidate=await port.lockAndAuthorize(tx,operation,factId,access);
  await lockStock(tx,candidate.lines.map(l=>l.skuId));const facts=await port.readLocked(tx,operation,factId);
  if(facts.factId!==factId||candidate.businessId!==facts.businessId||JSON.stringify(candidate.lines)!==JSON.stringify(facts.lines))throw new InventoryError('VERSION_CONFLICT');
  const semantic={operation,factId,businessId:facts.businessId,lines:facts.lines,afterSaleId:facts.afterSaleId,checkedAfterSaleId:facts.checkedAfterSaleId,
   physicalVersion:facts.physicalVersion,checkedPhysicalVersion:facts.checkedPhysicalVersion};
  const actionKey=`${operation}:${factId}`;const prior=await this.kernel.replay(tx,actionKey,semantic);if(prior)return {changed:false,action:prior};
  if(!facts.lines.length||new Set(facts.lines.map(l=>l.skuId)).size!==facts.lines.length)throw new InventoryError('VALIDATION_FAILED');
  const effects:InventoryEffect[]=[];
  const physical=()=>{if(!facts.afterSaleId||facts.afterSaleId!==facts.checkedAfterSaleId||facts.physicalVersion!==facts.checkedPhysicalVersion)throw new InventoryError('PHYSICAL_CHECK_STALE');};
  for(const line of facts.lines){
   const q=integer(line.quantity,1),s=integer(line.saleable),received=integer(line.received);if(s>received||received>q)throw new InventoryError('RESTOCK_NOT_ALLOWED');
   let deltaA=0,deltaR=0;
   if(operation==='RESERVE'){
    if(facts.state!=='NEW')throw new InventoryError('RESTOCK_NOT_ALLOWED');const sku=await tx.sku.findUniqueOrThrow({where:{id:line.skuId},include:{product:true,balance:true}});
    if(!sku.enabled||sku.retiredAt||sku.product.status!=='ON_SALE'||sku.product.archivedAt||!sku.priceCents||sku.balance?.purchaseBlocked)throw new InventoryError('ORDER_STOCK_BLOCKED');
    deltaA=-q;deltaR=q;
   }else if(operation==='PAY'){
    if(facts.state!=='UNPAID'||!facts.paymentSucceeded||!facts.deadline||facts.deadline.getTime()<=Date.now()||facts.paymentBlocked)throw new InventoryError('ORDER_STOCK_BLOCKED');deltaR=-q;
   }else if(operation==='CLOSE'){
    if(facts.state!=='UNPAID'||line.damaged===null)throw new InventoryError('ORDER_STOCK_BLOCKED');const d=integer(line.damaged,0,q);deltaA=q-d;deltaR=-q;
   }else if(operation==='PAID_PREPARATION_LOSS'){
    if(facts.state!=='PAID'||facts.handover!=='NONE'||line.damaged===null||integer(line.damaged,1,q)<1)throw new InventoryError('RESTOCK_NOT_ALLOWED');
    // 实物事件的版本由父领域在apply内递增并使旧核实失效；A/R保持原事实，只保存零差额流水。
   }else if(operation==='ALLOCATE_REPLACEMENT'){
    if(!['PAID','UNPAID'].includes(facts.state)||facts.handover!=='NONE')throw new InventoryError('RESTOCK_NOT_ALLOWED');deltaA=-integer(line.replacementQuantity,1,integer(line.unfilledQuantity,1,q));
   }else if(operation==='UNSHIPPED_REFUND_RESTOCK'){
    physical();if(!facts.refundSucceeded||facts.state!=='PAID'||facts.handover!=='NONE'||!facts.finalPhysicalCheck||line.damaged===null||s+integer(line.damaged,0,q)!==q||received!==q||facts.restockedByOtherPath)throw new InventoryError('RESTOCK_NOT_ALLOWED');deltaA=s;
   }else if(operation==='RETURN_RESTOCK'){
    physical();if(!facts.finalInspection||facts.handover==='UNKNOWN'||facts.restockedByOtherPath||(!(facts.completeReceived&&received===q)&&!(facts.exceptionApproved&&facts.finalPhysicalCheck)))throw new InventoryError('RESTOCK_NOT_ALLOWED');deltaA=s;
   }else throw new InventoryError('INVENTORY_DOMAIN_NOT_READY');
   if(deltaA!==0||deltaR!==0||operation==='PAID_PREPARATION_LOSS')effects.push({skuId:line.skuId,deltaA,deltaR,eventType:operation,
    ...(operation==='CLOSE'?{quantityReleased:q,quantityDamaged:line.damaged!}:{})});
  }
  const businessType=operation==='PAY'?'PAYMENT':operation==='RETURN_RESTOCK'?'RETURN_INSPECTION':operation==='UNSHIPPED_REFUND_RESTOCK'?'REFUND':'ORDER';
  const result=await this.kernel.execute(tx,{businessType,businessId:facts.businessId,businessNumber:facts.number,actionType:operation,actionKey,semantic,actor:facts.actor,requestId,reason:'已核实业务事实：'+operation,effects});
  await port.apply(tx,operation,facts,result.action.id);return result;
 }
}
