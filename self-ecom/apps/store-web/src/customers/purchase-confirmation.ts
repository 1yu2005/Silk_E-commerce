// 作用：只持久化本次确认键和ID/数量载荷，刷新后恢复原请求；不保存密码、令牌或收货全文。
import type {ApiOperations} from '@shop/api-client';
export type CreateBody=NonNullable<ApiOperations['createOrder']['requestBody']>['content']['application/json'];
export interface PurchaseConfirmation {customerId:string;key:string;body:CreateBody}
export const PURCHASE_KEY='self-ecom.customer.purchase-confirmation';
const uuid=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export function readConfirmation(storage:Pick<Storage,'getItem'|'removeItem'>,customerId:string):PurchaseConfirmation|null{
 try{const raw=storage.getItem(PURCHASE_KEY);if(!raw)return null;const r=JSON.parse(raw) as PurchaseConfirmation;if(r.customerId!==customerId||!/^[A-Za-z0-9_-]{16,128}$/.test(r.key)||!uuid.test(r.body.addressId)||!uuid.test(r.body.quoteId)||!Array.isArray(r.body.items)||!r.body.items.length||r.body.items.length>100||r.body.items.some(i=>!uuid.test(i.skuId)||!uuid.test(i.cartItemId)||!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>99))throw new Error('invalid');return r;}catch{storage.removeItem(PURCHASE_KEY);return null;}
}
