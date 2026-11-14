// 作用：复用生成契约，金额只用整数/十进制字符串格式化，不以浮点元参与计算。
import type {ApiOperations} from '@shop/api-client';
export type Addresses=ApiOperations['listAddresses']['responses'][200]['content']['application/json']['data'];
export type Address=Addresses['items'][number];
export type AddressInput=NonNullable<ApiOperations['createAddress']['requestBody']>['content']['application/json'];
export type Cart=ApiOperations['getCart']['responses'][200]['content']['application/json']['data'];
export type CartItem=Cart['items'][number];
export function money(value:string|number|null){if(value===null)return '价格待确认';const n=BigInt(value);return '¥'+(n/100n).toString()+'.'+(n%100n).toString().padStart(2,'0');}
