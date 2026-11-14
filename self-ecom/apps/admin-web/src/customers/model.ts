// 作用：全部类型取自已生成契约，避免页面与接口各写一套顾客结构。
import type {ApiOperations} from '@shop/api-client';
type Data<K extends keyof ApiOperations>=ApiOperations[K]['responses'] extends {200:{content:{'application/json':{data:infer D}}}}?D:never;
export type Customers=Data<'listCustomers'>;
export type Customer=Data<'getCustomer'>;
export type Addresses=Data<'getCustomerAddresses'>;
export type History=Data<'getCustomerStatusHistory'>;
export type Consumption=Data<'getCustomerConsumption'>;
export type CustomerQuery=NonNullable<ApiOperations['listCustomers']['parameters']['query']>;
export const statuses={NORMAL:'正常',TRADE_RESTRICTED:'交易受限',LOGIN_FROZEN:'登录冻结'};
export const date=(value:string|null)=>value?new Intl.DateTimeFormat('zh-CN',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'暂无';
export function amount(cents:string){const n=BigInt(cents);return '¥'+(n/100n).toString()+'.'+(n%100n).toString().padStart(2,'0');}
