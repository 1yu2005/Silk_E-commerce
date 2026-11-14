// 作用：库存页面从生成契约派生类型，避免另写一套数量或状态定义。
import type { ApiOperations } from '@shop/api-client';
export type Balances=ApiOperations['listInventoryBalances']['responses'][200]['content']['application/json']['data'];
export type Balance=ApiOperations['getInventoryBalance']['responses'][200]['content']['application/json']['data'];
export type Source=ApiOperations['getInventorySource']['responses'][200]['content']['application/json']['data'];
export type Sources=ApiOperations['listInventorySources']['responses'][200]['content']['application/json']['data'];
export type Adjustment=ApiOperations['getInventoryAdjustment']['responses'][200]['content']['application/json']['data'];
export type Adjustments=ApiOperations['listInventoryAdjustments']['responses'][200]['content']['application/json']['data'];
export type Ledger=ApiOperations['listInventoryLedger']['responses'][200]['content']['application/json']['data'];
export type BalanceQuery=NonNullable<ApiOperations['listInventoryBalances']['parameters']['query']>;
export type SourceQuery=NonNullable<ApiOperations['listInventorySources']['parameters']['query']>;
export type AdjustmentQuery=NonNullable<ApiOperations['listInventoryAdjustments']['parameters']['query']>;
export type LedgerQuery=NonNullable<ApiOperations['listInventoryLedger']['parameters']['query']>;
export const inventoryTypes={INITIALIZATION:'初始化',ARRIVAL:'到货',AVAILABLE_LOSS:'可售损耗',CORRECTION:'差额更正'} as const;
export const inventoryStatuses={PENDING:'待确认',POSTED:'已入账',VOID:'已作废'} as const;
export const signed=(n:number)=>n>0?'+'+n:String(n);
export const time=(value:string|null)=>value?new Date(value).toLocaleString('zh-CN'):'—';
