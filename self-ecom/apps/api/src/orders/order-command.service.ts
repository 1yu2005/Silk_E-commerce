// 作用：支付/关闭串行裁决；资金事实、库存动作、销量、任务、历史和审计原子提交。
import {Inject,Injectable} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import type {Order,Payment,Prisma} from '@prisma/client';
import {PrismaService} from '../prisma/prisma.service.js';
import {runAuthTransaction} from '../auth/auth-transaction.js';
import type {CustomerContext} from '../customers/customer-access.service.js';
import {Clock} from '../common/time/clock.js';
import {InventoryKernel} from '../inventory/inventory-kernel.service.js';
import {TaskEntryService,type TaskEntryContext,type TaskActorAccess} from '../tasks/task-entry.service.js';
import {TaskSourceService} from '../tasks/task-source.service.js';
import {OrderTimerService} from '../tasks/order-timer.service.js';
import {taskAuditActor} from '../tasks/task-lifecycle.service.js';
import {StateHistoryService} from '../records/state-history.service.js';
import {AuditService} from '../audit/audit.service.js';
import {requireOrderPermission,ownedOrder} from './order-access.service.js';
import {currentDamage} from './order-stock.js';
import {OrderError} from './order.errors.js';
import {orderNumber} from './order.service.js';
const paymentView=(p:Payment,o:Order,replayed:boolean)=>({paymentId:p.id,number:p.number,amountCents:p.amountCents,method:p.method,currency:p.currency,paidAt:p.paidAt,orderId:o.id,orderStatus:o.status,replayed});
@Injectable()
export class OrderCommands {
 constructor(@Inject(PrismaService)private readonly db:PrismaService,@Inject(Clock)private readonly clock:Clock,@Inject(TaskEntryService)private readonly entry:TaskEntryService,
 @Inject(TaskSourceService)private readonly sources:TaskSourceService,@Inject(OrderTimerService)private readonly timer:OrderTimerService,@Inject(InventoryKernel)private readonly stock:InventoryKernel,@Inject(StateHistoryService)private readonly history:StateHistoryService,@Inject(AuditService)private readonly audit:AuditService){}
 private access(ctx:CustomerContext):TaskActorAccess{return {type:ctx.actor.subjectType,subjectId:ctx.actor.subjectId,token:ctx.token};}
 async pay(ctx:CustomerContext,id:string){return runAuthTransaction(this.db,tx=>this.entry.withContext(tx,this.access(ctx),[{businessType:'ORDER',businessId:id}],ctx.requestId,async context=>this.entry.inContext(context,{businessType:'ORDER',businessId:id},async scope=>{
  if(scope.actor.subjectType!=='CUSTOMER')throw new OrderError('ORDER_NOT_FOUND');const order=await ownedOrder(tx,id,scope.actor);const prior=await tx.payment.findUnique({where:{orderId:id}});if(prior)return paymentView(prior,order,true);
  if(order.status!=='WAIT_PAYMENT')throw new OrderError('ORDER_NOT_PAYABLE');if(+this.clock.now()>=+order.paymentDeadline)throw new OrderError('ORDER_PAYMENT_EXPIRED');
  const lines=await currentDamage(tx,id);if(lines.some(l=>l.unknown||l.damaged>0))throw new OrderError('ORDER_STOCK_BLOCKED');
  for(const l of lines){const b=await tx.inventoryBalance.findUnique({where:{skuId:l.skuId}});if(!b||b.reserved<l.quantity)throw new OrderError('ORDER_STOCK_CHECK_REQUIRED');}
  await scope.revalidate();const now=this.clock.now();if(+now>=+order.paymentDeadline)throw new OrderError('ORDER_PAYMENT_EXPIRED');
  const payment=await tx.payment.create({data:{number:'P'+orderNumber().slice(1),orderId:id,amountCents:order.payableCents,paidAt:now,actorCustomerId:scope.actor.subjectId,requestId:ctx.requestId}});
  await this.stock.execute(tx,{businessType:'PAYMENT',businessId:payment.id,businessNumber:payment.number,actionType:'PAY',actionKey:'PAY:'+id,semantic:{orderId:id,paymentId:payment.id,items:lines.map(l=>({skuId:l.skuId,quantity:l.quantity}))},actor:taskAuditActor(scope.actor),requestId:ctx.requestId,reason:'模拟付款成功',effects:lines.map(l=>({skuId:l.skuId,deltaA:0,deltaR:-l.quantity,eventType:'PAY'}))});
  const totals=new Map<string,number>();for(const l of lines)totals.set(l.productId,(totals.get(l.productId)??0)+l.quantity);for(const [productId,q]of [...totals].sort())await tx.product.update({where:{id:productId},data:{paidSalesCount:{increment:BigInt(q)}}});
  const updated=await tx.order.update({where:{id},data:{status:'WAIT_SHIPMENT',paidAt:now,version:{increment:1},fulfillmentStage:'UNCLAIMED',updatedAt:now}});
  await this.entry.enterStage(context,{businessType:'ORDER',businessId:id,stage:'SHIPMENT_PROCESS',entryKey:'payment:'+payment.id,reason:'模拟付款成功进入待发货'});
  await this.history.appendStateHistory(tx,taskAuditActor(scope.actor),{aggregateType:'ORDER',aggregateId:id,dimension:'status',commandKey:'pay:'+payment.id,fromState:'WAIT_PAYMENT',toState:'WAIT_SHIPMENT',requestId:ctx.requestId,publicText:'模拟付款成功，等待发货'});
  await this.audit.appendAudit(tx,{actor:taskAuditActor(scope.actor),action:'order.pay',targetId:id,requestId:ctx.requestId,after:{orderStatus:updated.status,orderVersion:updated.version,amountCents:payment.amountCents,paymentId:payment.id}});return paymentView(payment,updated,false);
 })));}
 async cancel(ctx:CustomerContext,id:string,reason='顾客取消订单'){return this.close(this.access(ctx),id,ctx.requestId,'USER_CANCELLED',reason);}
 async closeUnpaid(ctx:CustomerContext,id:string,input:{expectedVersion:number;reason:string}){return this.close(this.access(ctx),id,ctx.requestId,'ADMIN_CLOSED',input.reason,input.expectedVersion);}
 async timeout(id:string,requestId=randomUUID()){return this.close({type:'SYSTEM'},id,requestId,'PAYMENT_TIMEOUT','超过原付款截止，系统关闭');}
 private async close(access:TaskActorAccess,id:string,requestId:string,code:string,reason:string,version?:number){
  const result=await runAuthTransaction(this.db,tx=>this.entry.withContext(tx,access,[{businessType:'ORDER',businessId:id}],requestId,context=>this.closeLocked(tx,context,id,code,reason,version)));
  if('blocked' in result&&result.blocked&&code!=='PAYMENT_TIMEOUT')throw new OrderError('ORDER_STOCK_CHECK_REQUIRED');return result;
 }
 private closeLocked(tx:Prisma.TransactionClient,context:TaskEntryContext,id:string,code:string,reason:string,version?:number){return this.entry.inContext(context,{businessType:'ORDER',businessId:id},async scope=>{
  const a=scope.actor;const o=await ownedOrder(tx,id,a);
  if(code==='ADMIN_CLOSED'){const actor=requireOrderPermission(a,'order.unpaid.close');if(actor.role!=='SUPER_ADMIN')throw new OrderError('ORDER_NOT_UNPAID');}
  if(code==='USER_CANCELLED'&&a.subjectType!=='CUSTOMER')throw new OrderError('ORDER_NOT_FOUND');
  if(o.status==='CLOSED')return {orderId:id,orderStatus:o.status,closedAt:o.closedAt,closeReasonCode:o.closeReasonCode,replayed:true};
  if(o.status!=='WAIT_PAYMENT'){if(code==='PAYMENT_TIMEOUT')return {orderId:id,skipped:true};throw new OrderError('ORDER_NOT_UNPAID');}
  if(version!==undefined&&version!==o.version)throw new OrderError('VERSION_CONFLICT');if(code==='PAYMENT_TIMEOUT'&&+this.clock.now()<+o.paymentDeadline)return {orderId:id,skipped:true};
  const lines=await currentDamage(tx,id);if(lines.some(l=>l.unknown)){
   const affected=await tx.stockIncidentItem.findMany({where:{orderItem:{orderId:id},damagedQuantity:null,incident:{status:'OPEN'}},select:{incidentId:true}});
   for(const incidentId of [...new Set(affected.map(i=>i.incidentId))].sort()){
    const task=await tx.task.findFirst({where:{businessType:'ORDER',businessId:id,stage:'ADMIN_STOCK_REVIEW',status:{in:['OPEN','CLAIMED']}}});
    if(!task||!await tx.taskBusinessSource.count({where:{taskId:task.id,sourceType:'STOCK_EXCEPTION',sourceId:incidentId,status:'ACTIVE'}}))await this.sources.attach(context,{businessType:'ORDER',businessId:id,stage:'ADMIN_STOCK_REVIEW',sourceType:'STOCK_EXCEPTION',sourceId:incidentId,entryKey:'review:'+incidentId,reason:'未付订单损耗未知，安全释放待核实'});
   }
   return {orderId:id,blocked:true};
  }
  await scope.revalidate();const now=this.clock.now();await this.stock.execute(tx,{businessType:'ORDER',businessId:id,businessNumber:o.number,actionType:'CLOSE',actionKey:'CLOSE:'+id,semantic:{orderId:id,items:lines.map(l=>({skuId:l.skuId,quantity:l.quantity,damaged:l.damaged}))},actor:taskAuditActor(a),requestId:scope.requestId,reason,effects:lines.map(l=>({skuId:l.skuId,deltaA:l.quantity-l.damaged,deltaR:-l.quantity,eventType:'CLOSE',quantityReleased:l.quantity,quantityDamaged:l.damaged}))});
  const facts=await tx.stockIncidentItem.findMany({where:{orderItem:{orderId:id},verificationState:{not:'SETTLED'},allocationType:'RESERVED'}});
  for(const f of facts){await tx.stockIncidentItem.update({where:{id:f.id},data:{verificationState:'SETTLED',version:{increment:1}}});await tx.stockIncidentHistory.create({data:{incidentId:f.incidentId,incidentItemId:f.id,action:'SETTLE',actorType:a.subjectType,actorId:a.subjectType==='SYSTEM'?null:a.subjectId,reason,commandKey:'close:'+id,requestId:scope.requestId,after:{orderId:id,route:'UNPAID_CLOSE_NET_RELEASE'}}});}
  const updated=await tx.order.update({where:{id},data:{status:'CLOSED',closedAt:now,closeReasonCode:code,closeReason:reason,closedByType:a.subjectType,closedById:a.subjectType==='SYSTEM'?null:a.subjectId,paymentBlocked:false,releaseBlocked:false,version:{increment:1},updatedAt:now}});
  await tx.orderItem.updateMany({where:{orderId:id},data:{damagedReservedQuantity:0,damageUnknown:false}});
  const tasks=await tx.task.findMany({where:{businessType:'ORDER',businessId:id},select:{id:true}});
  const sources=await tx.taskBusinessSource.findMany({where:{taskId:{in:tasks.map(t=>t.id)},status:'ACTIVE'},orderBy:{taskId:'asc'}});
  for(const source of sources){const task=await tx.task.findUniqueOrThrow({where:{id:source.taskId}});await this.sources.cancel(context,{businessType:'ORDER',businessId:id,taskId:task.id,expectedVersion:task.version,sourceType:source.sourceType as 'STOCK_EXCEPTION',sourceId:source.sourceId,commandKey:'close:'+id,reason:'未付订单安全关闭，结束本单来源跟进'});}
  const blocks=await tx.orderBlock.findMany({where:{orderId:id,active:true}});for(const b of blocks)await this.timer.releaseBlock(context,id,{sourceType:b.sourceType as 'STOCK_EXCEPTION',sourceId:b.sourceId},{commandKey:'close:'+id+':'+b.sourceId,reason:'未付订单安全关闭，结束本单履约阻塞'});
  await this.history.appendStateHistory(tx,taskAuditActor(a),{aggregateType:'ORDER',aggregateId:id,dimension:'status',commandKey:'close:'+id,fromState:'WAIT_PAYMENT',toState:'CLOSED',requestId:scope.requestId,reason,publicText:code==='PAYMENT_TIMEOUT'?'付款超时，订单已关闭':code==='ADMIN_CLOSED'?'管理员关闭未付订单':'顾客取消订单'});
  await this.audit.appendAudit(tx,{actor:taskAuditActor(a),action:'order.close',targetId:id,requestId:scope.requestId,reason,after:{orderStatus:updated.status,orderVersion:updated.version,closeReasonCode:code}});
  return {orderId:id,orderStatus:updated.status,closedAt:now,closeReasonCode:code,replayed:false};
 });}
}
