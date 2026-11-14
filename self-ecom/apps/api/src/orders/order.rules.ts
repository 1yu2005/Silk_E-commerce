// 作用：报价只用安全整数分；购买清单集合语义与HTTP请求号无关。
import {commandFingerprint} from '../common/command-fingerprint.js';
import {OrderError} from './order.errors.js';
export const ORDER_STATUSES=['WAIT_PAYMENT','WAIT_SHIPMENT','SHIPPED','COMPLETED','CLOSED','REFUNDED'] as const;
export interface PurchaseItem {cartItemId:string;skuId:string;quantity:number}
export interface PurchaseInput {addressId:string;items:PurchaseItem[]}
export interface CreateOrderInput extends PurchaseInput {quoteId:string}
export function purchaseItems(items:readonly PurchaseItem[]):PurchaseItem[]{
 if(!Array.isArray(items)||!items.length||items.length>100)throw new OrderError('VALIDATION_FAILED');
 const normalized=items.map(i=>({cartItemId:i.cartItemId.toLowerCase(),skuId:i.skuId.toLowerCase(),quantity:i.quantity}));
 if(new Set(normalized.map(i=>i.skuId)).size!==items.length||new Set(normalized.map(i=>i.cartItemId)).size!==items.length||normalized.some(i=>!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>99))throw new OrderError('VALIDATION_FAILED');
 return normalized.sort((a,b)=>a.cartItemId.localeCompare(b.cartItemId)||a.skuId.localeCompare(b.skuId));
}
export interface ShippingRule {shippingFeeCents:number;freeShippingEnabled:boolean;freeShippingThresholdCents:number}
export function pricingRule(setting:ShippingRule){return {algorithm:'fixed-shipping-v1',shippingFeeCents:setting.shippingFeeCents,freeShippingEnabled:setting.freeShippingEnabled,freeShippingThresholdCents:setting.freeShippingThresholdCents};}
export function orderAmounts(lines:readonly {unitPriceCents:number;quantity:number}[],rule:ShippingRule){
 let goods=0;for(const l of lines){if(!Number.isInteger(l.unitPriceCents)||l.unitPriceCents<1||l.unitPriceCents>1000000||!Number.isInteger(l.quantity)||l.quantity<1||l.quantity>99)throw new OrderError('ORDER_AMOUNT_LIMIT');goods+=l.unitPriceCents*l.quantity;if(!Number.isSafeInteger(goods)||goods>100000000)throw new OrderError('ORDER_AMOUNT_LIMIT');}
 const shipping=rule.freeShippingEnabled&&goods>=rule.freeShippingThresholdCents?0:rule.shippingFeeCents;
 const payable=goods+shipping;if(!Number.isSafeInteger(payable)||payable<1||payable>100000000)throw new OrderError('ORDER_AMOUNT_LIMIT');
 return {goodsAmountCents:goods,shippingFeeCents:shipping,payableCents:payable};
}
export function createFingerprint(customerId:string,input:CreateOrderInput){return commandFingerprint({command:'order.create',version:1,actor:{type:'CUSTOMER',id:customerId},payload:{quoteId:input.quoteId.toLowerCase(),addressId:input.addressId.toLowerCase(),items:purchaseItems(input.items)}});}
export const addressSnapshot=(a:{receiver:string;phone:string;province:string;city:string;district:string;detail:string})=>({receiver:a.receiver,phone:a.phone,province:a.province,city:a.city,district:a.district,detail:a.detail});
