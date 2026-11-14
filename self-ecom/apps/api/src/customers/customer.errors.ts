// 作用：顾客、地址、购物车的受控业务错误；不携带原始SQL或私人资料。
const messages = {
 CUSTOMER_NOT_FOUND:'顾客不存在', ADDRESS_NOT_FOUND:'地址不存在', CART_ITEM_NOT_FOUND:'购物车项目不存在',
 VERSION_CONFLICT:'资料已发生变化，请刷新后重新确认', ADDRESS_LIMIT_REACHED:'最多保存20条地址',
 PRODUCT_UNAVAILABLE:'商品当前不可购买', SKU_UNAVAILABLE:'该规格当前不可购买', PRICE_UNAVAILABLE:'商品价格暂不可用',
 PURCHASE_BLOCKED:'该规格暂停新购', CART_QUANTITY_LIMIT:'同一规格最多99件', STOCK_INSUFFICIENT:'可售库存不足',
 CART_ITEM_INVALID:'该项目当前不可选中，请先处理失效或库存不足', CART_CHANGED:'购物车已变化，请重新确认购买清单',
 CUSTOMER_CONSUMPTION_UNAVAILABLE:'消费统计暂不可用', VALIDATION_FAILED:'请求参数不合法',
} as const;
export type CustomerErrorCode=keyof typeof messages;
export class CustomerError extends Error {
 readonly status:number;
 constructor(readonly code:CustomerErrorCode){super(messages[code]);this.status=code==='VALIDATION_FAILED'?400:code.endsWith('_NOT_FOUND')?404:code==='CUSTOMER_CONSUMPTION_UNAVAILABLE'?503:409;}
}
