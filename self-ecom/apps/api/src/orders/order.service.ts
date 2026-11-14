// 作用：服务器报价与幂等建单。订单、快照、占用、购物车、引用和审计只在同一事务提交。
import {Inject,Injectable} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {Prisma,type CheckoutQuote,type Order} from '@prisma/client';
import {canonicalJson,validateIdempotencyKey} from '@shop/shared';
import {PrismaService} from '../prisma/prisma.service.js';
import {runAuthTransaction,postgresErrorCode} from '../auth/auth-transaction.js';
import {CustomerAccessService,type CustomerContext} from '../customers/customer-access.service.js';
import {CartService} from '../customers/cart.service.js';
import {StoreSettingsService} from '../settings/store-settings.service.js';
import {Clock} from '../common/time/clock.js';
import {InventoryKernel} from '../inventory/inventory-kernel.service.js';
import {lockStock} from '../inventory/inventory-support.js';
import {FileBindingService} from '../files/file-binding.service.js';
import {StateHistoryService} from '../records/state-history.service.js';
import {AuditService} from '../audit/audit.service.js';
import {addressSnapshot,createFingerprint,orderAmounts,pricingRule,purchaseItems,type CreateOrderInput,type PurchaseInput} from './order.rules.js';
import {OrderError,type OrderErrorCode} from './order.errors.js';

const skuInclude={product:{include:{images:{where:{slot:'MAIN' as const},take:1}}},balance:true,choices:{include:{dimension:true,value:true},orderBy:{dimension:{sortOrder:'asc' as const}}}} satisfies Prisma.SkuInclude;
export const orderResult=(o:Order,replayed:boolean)=>({orderId:o.id,number:o.number,status:o.status,goodsAmountCents:o.goodsAmountCents,shippingFeeCents:o.shippingFeeCents,payableCents:o.payableCents,paymentDeadline:o.paymentDeadline,version:o.version,replayed});
export const orderNumber=()=> 'O'+Date.now().toString(36).toUpperCase()+randomUUID().replaceAll('-','').slice(0,12).toUpperCase();
const lockedError=(e:unknown)=>e instanceof Prisma.PrismaClientKnownRequestError&&(['P2028','P2002'].includes(e.code)||(e.code==='P2010'&&['55P03','57014'].includes(postgresErrorCode(e)??'')));
// pg的连接池取连接超时是普通Error；它发生在事务开始之前，不代表业务失败或已经提交。
const poolBusy=(e:unknown)=>e instanceof Error&&e.message==='timeout exceeded when trying to connect';
@Injectable()
export class OrderService {
 constructor(@Inject(PrismaService)private readonly db:PrismaService,@Inject(CustomerAccessService)private readonly access:CustomerAccessService,
  @Inject(CartService)private readonly cart:CartService,@Inject(StoreSettingsService)private readonly settings:StoreSettingsService,@Inject(Clock)private readonly clock:Clock,
  @Inject(InventoryKernel)private readonly stock:InventoryKernel,@Inject(FileBindingService)private readonly files:FileBindingService,
  @Inject(StateHistoryService)private readonly history:StateHistoryService,@Inject(AuditService)private readonly audit:AuditService){}
 private async current(tx:Prisma.TransactionClient,ctx:CustomerContext,input:PurchaseInput){
  const items=purchaseItems(input.items);const address=await tx.address.findFirst({where:{id:input.addressId.toLowerCase(),customerId:ctx.actor.subjectId}});if(!address)throw new OrderError('ADDRESS_NOT_FOUND');
  const carts=await tx.cartItem.findMany({where:{customerId:ctx.actor.subjectId,id:{in:items.map(i=>i.cartItemId)}}});
  if(carts.length!==items.length||items.some(i=>!carts.some(c=>c.id===i.cartItemId&&c.skuId===i.skuId&&c.quantity>=i.quantity)))throw new OrderError('CART_CHANGED');
  const skus=await tx.sku.findMany({where:{id:{in:items.map(i=>i.skuId)}},include:skuInclude});if(skus.length!==items.length)throw new OrderError('PRODUCT_UNAVAILABLE');
  for(const item of items){const sku=skus.find(s=>s.id===item.skuId)!;
   if(!sku.enabled||sku.retiredAt||sku.product.archivedAt||sku.product.status!=='ON_SALE'||sku.priceCents===null||sku.priceCents<1||sku.priceCents>1000000)throw new OrderError('PRODUCT_UNAVAILABLE');
   if(sku.balance?.purchaseBlocked)throw new OrderError('PURCHASE_BLOCKED');if(!sku.balance||sku.balance.available<item.quantity)throw new OrderError('STOCK_INSUFFICIENT');
  }
  const setting=await this.settings.requireCurrent(tx);const rule=pricingRule(setting);
  const lines=items.map(i=>{const sku=skus.find(s=>s.id===i.skuId)!;return {...i,unitPriceCents:sku.priceCents!,sku};});
  return {address,setting,rule,lines,...orderAmounts(lines,rule)};
 }
 private quoteView(q:CheckoutQuote,lines:readonly {cartItemId:string;skuId:string;quantity:number;unitPriceCents:number;productName?:string}[]){return {
  quoteId:q.id,serverTime:this.clock.now(),expiresAt:q.expiresAt,addressId:q.addressIdSnapshot,address:q.addressSnapshot,
  items:lines.map(l=>({cartItemId:l.cartItemId,skuId:l.skuId,quantity:l.quantity,unitPriceCents:l.unitPriceCents,lineAmountCents:l.unitPriceCents*l.quantity,...(l.productName?{productName:l.productName}:{})})),
  goodsAmountCents:q.goodsAmountCents,shippingFeeCents:q.shippingFeeCents,payableCents:q.payableCents,shippingRule:q.pricingRuleSnapshot,simulationNotice:'模拟交易，不发生真实资金流转'};}
 async preview(ctx:CustomerContext,input:PurchaseInput){return this.db.$transaction(async tx=>{
  await this.access.customer(tx,ctx);const state=await this.current(tx,ctx,input);const now=this.clock.now();
  const quote=await tx.checkoutQuote.create({data:{customerId:ctx.actor.subjectId,addressIdSnapshot:state.address.id,addressVersion:state.address.version,
   addressSnapshot:addressSnapshot(state.address),settingVersionId:state.setting.id,pricingRuleSnapshot:state.rule,
   goodsAmountCents:state.goodsAmountCents,shippingFeeCents:state.shippingFeeCents,payableCents:state.payableCents,createdAt:now,expiresAt:new Date(+now+300000),
   items:{create:state.lines.map(l=>({cartItemIdSnapshot:l.cartItemId,skuId:l.skuId,quantity:l.quantity,unitPriceCents:l.unitPriceCents,lineAmountCents:l.unitPriceCents*l.quantity}))}}});
  return this.quoteView(quote,state.lines.map(l=>({...l,productName:l.sku.product.name})));
 },{isolationLevel:'RepeatableRead',timeout:5000});}
 private async replay(tx:Prisma.TransactionClient,ctx:CustomerContext,key:string,fingerprint:string){
  const row=await tx.idempotencyRecord.findUnique({where:{customerId_actionCode_key:{customerId:ctx.actor.subjectId,actionCode:'CREATE_ORDER',key}}});
  if(!row)return null;if(row.fingerprint!==fingerprint)throw new OrderError('IDEMPOTENCY_PAYLOAD_CONFLICT');
  if(row.status!=='SUCCESS'||!row.resultOrderId)throw new OrderError('REQUEST_IN_PROGRESS');
  const order=await tx.order.findFirst({where:{id:row.resultOrderId,customerId:ctx.actor.subjectId}});if(!order)throw new OrderError('ORDER_NOT_FOUND');return orderResult(order,true);
 }
 async create(ctx:CustomerContext,input:CreateOrderInput,rawKey:unknown){
  const key=validateIdempotencyKey(rawKey),fingerprint=createFingerprint(ctx.actor.subjectId,input);let conflict:OrderErrorCode|undefined;
  try{return await runAuthTransaction(this.db,async tx=>{
   await tx.$executeRawUnsafe("SET LOCAL lock_timeout='500ms'");await tx.$executeRawUnsafe("SET LOCAL statement_timeout='700ms'");
   await this.access.customer(tx,ctx);const prior=await this.replay(tx,ctx,key,fingerprint);if(prior)return prior;
   const customer=await tx.customer.findUniqueOrThrow({where:{id:ctx.actor.subjectId}});if(customer.status==='TRADE_RESTRICTED')throw new OrderError('CUSTOMER_TRADE_RESTRICTED');
   const quote=await tx.checkoutQuote.findFirst({where:{id:input.quoteId.toLowerCase(),customerId:ctx.actor.subjectId},include:{items:true}});if(!quote)throw new OrderError('QUOTE_NOT_FOUND');
   const items=purchaseItems(input.items);const confirmed=quote.items.map(i=>({cartItemId:i.cartItemIdSnapshot,skuId:i.skuId,quantity:i.quantity}));
   if(input.addressId.toLowerCase()!==quote.addressIdSnapshot||JSON.stringify(items)!==JSON.stringify(purchaseItems(confirmed)))throw new OrderError('IDEMPOTENCY_PAYLOAD_CONFLICT');
   if(+this.clock.now()>=+quote.expiresAt)throw new OrderError('QUOTE_EXPIRED');
   await tx.idempotencyRecord.create({data:{customerId:ctx.actor.subjectId,key,fingerprint,status:'PENDING'}});
   await lockStock(tx,items.map(i=>i.skuId));
   // 设置附属锁最后取得；设置写者不会反向取得商品/顾客锁。
   await tx.$queryRaw`SELECT id FROM store_setting_head WHERE id=1 FOR SHARE`;
   const state=await this.current(tx,ctx,input);
   if(state.address.version!==quote.addressVersion||canonicalJson(addressSnapshot(state.address))!==canonicalJson(quote.addressSnapshot))throw new OrderError('ADDRESS_CHANGED');
   if(state.lines.some(l=>quote.items.find(i=>i.skuId===l.skuId)?.unitPriceCents!==l.unitPriceCents)||canonicalJson(state.rule)!==canonicalJson(quote.pricingRuleSnapshot)
    ||state.payableCents!==quote.payableCents)throw new OrderError('PRICE_CHANGED');
   if(+this.clock.now()>=+quote.expiresAt)throw new OrderError('QUOTE_EXPIRED');await this.access.customer(tx,ctx);
   const now=this.clock.now(),id=randomUUID();const order=await tx.order.create({data:{id,number:orderNumber(),customerId:ctx.actor.subjectId,quoteId:quote.id,sourceAddressId:state.address.id,
    ...addressSnapshot(state.address),goodsAmountCents:state.goodsAmountCents,shippingFeeCents:state.shippingFeeCents,payableCents:state.payableCents,
    shippingRuleSnapshot:state.rule,paymentRuleSnapshot:{amount:state.setting.paymentMinutes,unit:'MINUTE',settingVersionId:state.setting.id,algorithm:'elapsed-minutes-v1'},
    settingVersionId:state.setting.id,paymentDeadline:new Date(+now+state.setting.paymentMinutes*60000),createdAt:now,updatedAt:now,
    items:{create:state.lines.map(l=>({skuId:l.skuId,productId:l.sku.productId,productNameSnapshot:l.sku.product.name,productCodeSnapshot:l.sku.product.productCode,
     skuCodeSnapshot:l.sku.code,specSnapshot:l.sku.choices.map(c=>({dimensionId:c.dimensionId,valueId:c.valueId,dimension:c.dimension.name,value:c.value.name})),
     imageAssetId:l.sku.product.images[0]?.assetId,unitPriceCents:l.unitPriceCents,unitCostCents:l.sku.costCents,quantity:l.quantity,lineAmountCents:l.unitPriceCents*l.quantity}))}},include:{items:true}});
   await this.stock.execute(tx,{businessType:'ORDER',businessId:id,businessNumber:order.number,actionType:'RESERVE',actionKey:'RESERVE:'+id,
    semantic:{orderId:id,items},actor:{type:'CUSTOMER',id:ctx.actor.subjectId},requestId:ctx.requestId,reason:'订单确认预占',effects:items.map(i=>({skuId:i.skuId,deltaA:-i.quantity,deltaR:i.quantity,eventType:'RESERVE'}))});
   await this.cart.consumePurchased(tx,ctx,items);
   for(const item of [...order.items].sort((a,b)=>(a.imageAssetId??'').localeCompare(b.imageAssetId??'')))await this.files.retainOrderImage(tx,item.id);
   await this.history.appendStateHistory(tx,{type:'CUSTOMER',id:ctx.actor.subjectId},{aggregateType:'ORDER',aggregateId:id,dimension:'status',commandKey:'create:'+id,fromState:null,toState:'WAIT_PAYMENT',requestId:ctx.requestId,publicText:'订单已创建，等待模拟付款'});
   await this.audit.appendAudit(tx,{actor:{type:'CUSTOMER',id:ctx.actor.subjectId},action:'order.create',targetId:id,requestId:ctx.requestId,after:{orderStatus:order.status,orderVersion:order.version,amountCents:order.payableCents}});
   await tx.idempotencyRecord.update({where:{customerId_actionCode_key:{customerId:ctx.actor.subjectId,actionCode:'CREATE_ORDER',key}},data:{status:'SUCCESS',resultOrderId:id,completedAt:now}});
   return orderResult(order,false);
  });}catch(e){
   if(e instanceof OrderError&&['QUOTE_EXPIRED','PRICE_CHANGED','ADDRESS_CHANGED'].includes(e.code))conflict=e.code;
   else if(lockedError(e)||poolBusy(e)){
    try{return await this.db.$transaction(async tx=>{await this.access.customer(tx,ctx,false);return await this.replay(tx,ctx,key,fingerprint)??Promise.reject(new OrderError('REQUEST_IN_PROGRESS'));});}
    catch(recoveryError){if(lockedError(recoveryError)||poolBusy(recoveryError))throw new OrderError('REQUEST_IN_PROGRESS');throw recoveryError;}
   }
   else throw e;
  }
  // 新报价在原失败事务退出后生成；返回给用户明确确认，不自动再次建单。
  let newQuote:Awaited<ReturnType<OrderService['preview']>>|undefined;
  try{newQuote=await this.preview(ctx,input);}catch{/* 当前资格/库存不足时只返回原冲突，不能伪造可下单报价。 */}
  throw new OrderError(conflict!,{reason:conflict,requiresConfirmation:true,...(newQuote?{newQuote}:{})});
 }
}
