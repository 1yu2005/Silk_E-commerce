// 作用：购物车实时投影当前商品/价格/A；父锁内合并与版本变更，不写任何库存动作。
import {Inject,Injectable} from '@nestjs/common';
import {Prisma,type CartItem} from '@prisma/client';
import {PrismaService} from '../prisma/prisma.service.js';
import {AuditService} from '../audit/audit.service.js';
import {runAuthTransaction} from '../auth/auth-transaction.js';
import {requireSessionTransaction} from '../auth/session-support.js';
import {CustomerAccessService,type CustomerContext} from './customer-access.service.js';
import {CustomerError,type CustomerErrorCode} from './customer.errors.js';
import type {CartAddDto,CartUpdateDto,CartBatchDto,CartSelectionDto,VersionDto} from './customer.dto.js';
import type {PaginationDto} from '../common/http/pagination.dto.js';
const include={sku:{select:{id:true,code:true,enabled:true,retiredAt:true,priceCents:true,
 product:{select:{id:true,name:true,status:true,archivedAt:true,images:{where:{slot:'MAIN' as const},select:{assetId:true},take:1}}},
 balance:{select:{available:true,purchaseBlocked:true}},choices:{select:{dimension:{select:{name:true,sortOrder:true}},value:{select:{name:true}}},orderBy:{dimension:{sortOrder:'asc' as const}}}}}} satisfies Prisma.CartItemInclude;
type Row=Prisma.CartItemGetPayload<{include:typeof include}>;
export const cartValidityMessages={VALID:'可以购买',PRODUCT_UNAVAILABLE:'商品已下架或归档',SKU_DISABLED:'规格已停用',PRICE_UNAVAILABLE:'价格暂不可用',PURCHASE_BLOCKED:'该规格暂停新购',OUT_OF_STOCK:'暂时缺货',STOCK_INSUFFICIENT:'当前库存不足'} as const;
export function cartValidity(row:{quantity:number;sku:{enabled:boolean;retiredAt:Date|null;priceCents:number|null;product:{status:string;archivedAt:Date|null};balance:{available:number;purchaseBlocked:boolean}|null}}){
 const s=row.sku;if(s.product.status!=='ON_SALE'||s.product.archivedAt)return 'PRODUCT_UNAVAILABLE';
 if(!s.enabled||s.retiredAt)return 'SKU_DISABLED';if(s.priceCents===null||!Number.isSafeInteger(s.priceCents)||s.priceCents<1||s.priceCents>1000000)return 'PRICE_UNAVAILABLE';
 if(s.balance?.purchaseBlocked)return 'PURCHASE_BLOCKED';if(!s.balance||s.balance.available===0)return 'OUT_OF_STOCK';if(row.quantity>s.balance.available)return 'STOCK_INSUFFICIENT';return 'VALID';
}
function projection(row:Row){const validity=cartValidity(row);const s=row.sku;const price=s.priceCents;
 const amount=price!==null&&Number.isSafeInteger(price)&&price>0&&price<=1000000?price*row.quantity:null;
 return {id:row.id,skuId:row.skuId,productId:s.product.id,productName:s.product.name,skuCode:s.code,
 mainImageUrl:s.product.images[0]?'/api/v1/files/'+s.product.images[0].assetId+'/content':null,
 choices:s.choices.map(c=>({dimension:c.dimension.name,value:c.value.name})),unitPriceCents:price,available:s.balance?.available??0,
 quantity:row.quantity,selected:row.selected,version:row.version,validity,purchasable:validity==='VALID',validityMessage:cartValidityMessages[validity],lineAmountCents:amount===null?null:String(amount)};
}
@Injectable()
export class CartService {
 constructor(@Inject(PrismaService)private readonly db:PrismaService,@Inject(CustomerAccessService)private readonly access:CustomerAccessService,@Inject(AuditService)private readonly audit:AuditService){}
 private async stock(tx:Prisma.TransactionClient,ids:string[]){const unique=[...new Set(ids)].sort();if(!unique.length)return;const skus=await tx.sku.findMany({where:{id:{in:unique}},select:{id:true,productId:true}});if(skus.length!==unique.length)throw new CustomerError('SKU_UNAVAILABLE');
  for(const id of [...new Set(skus.map(s=>s.productId))].sort())await tx.$queryRaw`SELECT id FROM product WHERE id=${id}::uuid FOR UPDATE`;
  for(const id of unique){await tx.$queryRaw`SELECT id FROM sku WHERE id=${id}::uuid FOR UPDATE`;await tx.$queryRaw`SELECT sku_id FROM inventory_balance WHERE sku_id=${id}::uuid FOR UPDATE`;}
 }
 private async record(tx:Prisma.TransactionClient,ctx:CustomerContext,row:CartItem,deleted=false){await this.audit.appendAudit(tx,{actor:{type:'CUSTOMER',id:ctx.actor.subjectId},action:'cart.change',targetId:row.id,requestId:ctx.requestId,after:{skuId:row.skuId,quantity:row.quantity,selected:row.selected,cartVersion:row.version,...(deleted?{deleted:true}:{})}});}
 private checkVersion(row:CartItem,version:number){if(row.version!==version||row.version>=2147483647)throw new CustomerError('VERSION_CONFLICT');}
 private purchasable(row:Parameters<typeof cartValidity>[0]){const validity=cartValidity(row);if(validity==='VALID')return;const codes:Record<Exclude<typeof validity,'VALID'>,CustomerErrorCode>={PRODUCT_UNAVAILABLE:'PRODUCT_UNAVAILABLE',SKU_DISABLED:'SKU_UNAVAILABLE',PRICE_UNAVAILABLE:'PRICE_UNAVAILABLE',PURCHASE_BLOCKED:'PURCHASE_BLOCKED',OUT_OF_STOCK:'STOCK_INSUFFICIENT',STOCK_INSUFFICIENT:'STOCK_INSUFFICIENT'};throw new CustomerError(codes[validity]);}
 list(ctx:CustomerContext,q:PaginationDto){return this.db.$transaction(async tx=>{const actor=await this.access.customer(tx,ctx,false);const all=await tx.cartItem.findMany({where:{customerId:actor.subjectId},include,orderBy:[{updatedAt:'desc'},{id:'asc'}]});
  const projected=all.map(projection);const selected=projected.filter(r=>r.selected);const invalidSelectedCount=selected.filter(r=>!r.purchasable).length;
  const selectedSubtotalCents=invalidSelectedCount?null:selected.reduce((sum,r)=>sum+BigInt(r.lineAmountCents!),0n).toString();
  const start=BigInt(q.page-1)*BigInt(q.pageSize);const items=start>=BigInt(projected.length)?[]:projected.slice(Number(start),Number(start)+q.pageSize);
  return {items,total:all.length,page:q.page,pageSize:q.pageSize,summary:{totalItemCount:all.length,selectedItemCount:selected.length,invalidSelectedCount,selectedSubtotalCents,canCheckout:selected.length>0&&invalidSelectedCount===0}};
 },{isolationLevel:'RepeatableRead'});}
 add(ctx:CustomerContext,input:CartAddDto){return runAuthTransaction(this.db,async tx=>{await this.access.customer(tx,ctx);await this.stock(tx,[input.skuId]);
  const existing=await tx.cartItem.findUnique({where:{customerId_skuId:{customerId:ctx.actor.subjectId,skuId:input.skuId}}});
  const quantity=(existing?.quantity??0)+input.quantity;if(quantity>99)throw new CustomerError('CART_QUANTITY_LIMIT');
  const sku=await tx.sku.findUnique({where:{id:input.skuId},select:include.sku.select});if(!sku)throw new CustomerError('SKU_UNAVAILABLE');this.purchasable({quantity,sku});
  if(existing)this.checkVersion(existing,existing.version);
  const row=existing?await tx.cartItem.update({where:{id:existing.id},data:{quantity,version:{increment:1}},include}):await tx.cartItem.create({data:{customerId:ctx.actor.subjectId,skuId:input.skuId,quantity},include});
  await this.record(tx,ctx,row);return {item:projection(row),created:!existing};
 });}
 update(ctx:CustomerContext,id:string,input:CartUpdateDto){return runAuthTransaction(this.db,async tx=>{await this.access.customer(tx,ctx);const before=await tx.cartItem.findFirst({where:{id,customerId:ctx.actor.subjectId}});if(!before)throw new CustomerError('CART_ITEM_NOT_FOUND');this.checkVersion(before,input.expectedVersion);
  if(input.quantity===undefined&&input.selected===undefined)throw new CustomerError('VALIDATION_FAILED');
  if(input.quantity!==undefined||input.selected===true)await this.stock(tx,[before.skuId]);
  const row=await tx.cartItem.findUniqueOrThrow({where:{id},include});const quantity=input.quantity??row.quantity;const target={...row,quantity};
  if(quantity>row.quantity)this.purchasable(target);if(input.selected===true&&cartValidity(target)!=='VALID')throw new CustomerError('CART_ITEM_INVALID');
  const selected=input.selected??row.selected;if(quantity===row.quantity&&selected===row.selected)return {item:projection(row),changed:false};
  const updated=await tx.cartItem.update({where:{id},data:{quantity,selected,version:{increment:1}},include});await this.record(tx,ctx,updated);return {item:projection(updated),changed:true};
 });}
 remove(ctx:CustomerContext,id:string,input:VersionDto){return this.batch(ctx,{items:[{id,expectedVersion:input.expectedVersion}]});}
 selection(ctx:CustomerContext,input:CartSelectionDto){return this.batch(ctx,input,input.selected);}
 batch(ctx:CustomerContext,input:CartBatchDto,selected?:boolean){return runAuthTransaction(this.db,async tx=>{await this.access.customer(tx,ctx);
  if(new Set(input.items.map(i=>i.id.toLowerCase())).size!==input.items.length)throw new CustomerError('VALIDATION_FAILED');
  const ids=input.items.map(i=>i.id.toLowerCase());const rows=await tx.cartItem.findMany({where:{id:{in:ids},customerId:ctx.actor.subjectId},include});if(rows.length!==ids.length)throw new CustomerError('CART_ITEM_NOT_FOUND');
  for(const row of rows)this.checkVersion(row,input.items.find(i=>i.id.toLowerCase()===row.id)!.expectedVersion);
  if(selected===true){await this.stock(tx,rows.map(r=>r.skuId));const fresh=await tx.cartItem.findMany({where:{id:{in:ids}},include});if(fresh.some(r=>cartValidity(r)!=='VALID'))throw new CustomerError('CART_ITEM_INVALID');}
  const items=[];for(const row of rows.sort((a,b)=>a.id.localeCompare(b.id))){
   if(selected===undefined){await tx.cartItem.delete({where:{id:row.id}});await this.record(tx,ctx,row,true);items.push({id:row.id,version:row.version,selected:row.selected,deleted:true});}
   else if(selected!==row.selected){const updated=await tx.cartItem.update({where:{id:row.id},data:{selected,version:{increment:1}}});await this.record(tx,ctx,updated);items.push({id:row.id,version:updated.version,selected,deleted:false});}
   else items.push({id:row.id,version:row.version,selected,deleted:false});
  }return {items};
 });}
 /** 后续订单仅在自己的事务中调用：先取Customer锁，随后商品/SKU锁，再调用本端口；不开放HTTP。 */
 async consumePurchased(tx:Prisma.TransactionClient,ctx:CustomerContext,items:readonly {cartItemId:string;skuId:string;quantity:number}[]){
  requireSessionTransaction(tx);await this.access.customer(tx,ctx);
  if(!items.length||items.length>100||new Set(items.map(i=>i.cartItemId.toLowerCase())).size!==items.length||items.some(i=>!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>99))throw new CustomerError('VALIDATION_FAILED');
  const rows=await tx.cartItem.findMany({where:{customerId:ctx.actor.subjectId,id:{in:items.map(i=>i.cartItemId.toLowerCase())}}});
  if(rows.length!==items.length)throw new CustomerError('CART_CHANGED');
  for(const item of items){const row=rows.find(r=>r.id===item.cartItemId.toLowerCase());if(!row||row.skuId!==item.skuId.toLowerCase()||row.quantity<item.quantity)throw new CustomerError('CART_CHANGED');}
  for(const item of items){const row=rows.find(r=>r.id===item.cartItemId.toLowerCase())!;if(row.quantity===item.quantity){await tx.cartItem.delete({where:{id:row.id}});await this.record(tx,ctx,row,true);}else{this.checkVersion(row,row.version);const updated=await tx.cartItem.update({where:{id:row.id},data:{quantity:{decrement:item.quantity},version:{increment:1}}});await this.record(tx,ctx,updated);}}
 }
}
