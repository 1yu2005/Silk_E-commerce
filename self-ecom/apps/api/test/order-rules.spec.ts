// 作用：独立校验交易金额边界和购买确认指纹，不连接业务数据库。
import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {createFingerprint,orderAmounts,purchaseItems} from '../src/orders/order.rules.js';
const rule={shippingFeeCents:800,freeShippingEnabled:true,freeShippingThresholdCents:20000};
it.each([
 [19999,rule,800],[20000,rule,0],
 [1,{...rule,freeShippingThresholdCents:0},0],
 [20000,{...rule,freeShippingEnabled:false},800],
])('商品金额%s按有效规则计算运费', (price,shipping,expected)=>{
 expect(orderAmounts([{unitPriceCents:price as number,quantity:1}],shipping as typeof rule).shippingFeeCents).toBe(expected);
});
it.each([0,1000001,1.5,NaN,Infinity])('非法单价%s不能下单',price=>{
 expect(()=>orderAmounts([{unitPriceCents:price,quantity:1}],rule)).toThrow();
});
it.each([0,100,1.5,NaN])('非法数量%s不能通过金额校验',quantity=>{
 expect(()=>orderAmounts([{unitPriceCents:1,quantity}],rule)).toThrow();
});
it('订单上限包含运费，恰好一亿元分可用，超过一分拒绝',()=>{
 const lines=[{unitPriceCents:1000000,quantity:99},{unitPriceCents:999200,quantity:1}];
 expect(orderAmounts(lines,{...rule,freeShippingEnabled:false}).payableCents).toBe(100000000);
 expect(()=>orderAmounts([...lines,{unitPriceCents:1,quantity:1}],{...rule,freeShippingEnabled:false})).toThrow();
});
it('确认清单最多100行，不允许用重复SKU或购物车身份突破限额',()=>{
 const rows=Array.from({length:100},()=>({skuId:randomUUID(),cartItemId:randomUUID(),quantity:99}));
 expect(purchaseItems(rows)).toHaveLength(100);
 expect(()=>purchaseItems([...rows,{skuId:randomUUID(),cartItemId:randomUUID(),quantity:1}])).toThrow();
 expect(()=>purchaseItems([rows[0]!,{...rows[0]!,cartItemId:randomUUID()}])).toThrow();
 expect(()=>purchaseItems([rows[0]!,{...rows[0]!,skuId:randomUUID()}])).toThrow();
});
it('集合重排保持幂等语义，更换报价、顾客、地址或数量必须冲突',()=>{
 const customerId=randomUUID(),body={quoteId:randomUUID(),addressId:randomUUID(),items:Array.from({length:2},()=>({skuId:randomUUID(),cartItemId:randomUUID(),quantity:1}))};
 const fingerprint=createFingerprint(customerId,body);
 expect(createFingerprint(customerId,{...body,items:[...body.items].reverse()})).toBe(fingerprint);
 expect(createFingerprint(randomUUID(),body)).not.toBe(fingerprint);
 for(const changed of [{...body,quoteId:randomUUID()},{...body,addressId:randomUUID()},{...body,items:body.items.map(i=>({...i,quantity:2}))}])expect(createFingerprint(customerId,changed)).not.toBe(fingerprint);
});
