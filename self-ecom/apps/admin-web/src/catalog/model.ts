// 作用：从生成契约派生商品页面类型；金额转换复用已验证的整数分规则。
import type { ApiOperations } from '@shop/api-client';
export type Product=ApiOperations['getAdminProduct']['responses'][200]['content']['application/json']['data'];
export type Products=ApiOperations['listAdminProducts']['responses'][200]['content']['application/json']['data'];
export type ProductQuery=NonNullable<ApiOperations['listAdminProducts']['parameters']['query']>;
export type CategoryTree=ApiOperations['getAdminCategoryTree']['responses'][200]['content']['application/json']['data'];
export interface Category {id:string;name:string;parentId:string|null;iconKey:CategoryTree[number]['iconKey'];sortOrder:number;depth:number;pathIds:string[];version:number;children:Category[]}
export type Scheme=ApiOperations['saveProductSkuScheme']['requestBody']['content']['application/json']['dimensions'];
export type Draft=ApiOperations['getInitialInventoryDraft']['responses'][200]['content']['application/json']['data'];
export const flatten=(rows:Category[],prefix=''): {value:string;label:string;node:Category}[]=>rows.flatMap(node=>[{value:node.id,label:prefix+node.name,node},...flatten(node.children,prefix+'　')]);
export const statuses={DRAFT:'草稿',ON_SALE:'上架',OFF_SALE:'下架'} as const;
export { yuanToCents, centsToYuan } from '../settings/model';
