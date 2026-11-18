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
export function nextSourceLineKey(lines:readonly {lineKey:string}[]){
 const used=new Set(lines.map(line=>line.lineKey.trim()));
 let next=1;while(used.has(String(next)))next++;
 return String(next);
}

export const inventoryEvents:Record<string,string>={INITIALIZATION:'初始化入库',ARRIVAL:'到货入库',AVAILABLE_LOSS:'可售损耗',CORRECTION:'差额更正',RESERVE:'下单占用',PAY:'付款扣占用',CLOSE:'关单释放',RETURN_RESTOCK:'退货回库',UNSHIPPED_REFUND_RESTOCK:'未发货退款回库',PAID_PREPARATION_LOSS:'备货损耗',ALLOCATE_REPLACEMENT:'换补货分配',REFUNDED_AVAILABLE_LOSS:'退款后可售损耗'};
