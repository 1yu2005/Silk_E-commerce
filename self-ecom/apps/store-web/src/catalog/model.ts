// 作用：公开页面只使用生成的公开结构，不从后台DTO派生成本等内部字段。
import type { ApiOperations } from '@shop/api-client';
export type Products=ApiOperations['listStoreProducts']['responses'][200]['content']['application/json']['data'];
export type Product=ApiOperations['getStoreProduct']['responses'][200]['content']['application/json']['data'];
export type ProductQuery=NonNullable<ApiOperations['listStoreProducts']['parameters']['query']>;
export type Categories=ApiOperations['getStoreCategoryTree']['responses'][200]['content']['application/json']['data'];
export interface Category{id:string;name:string;parentId:string|null;children:Category[]}
export const flatten=(nodes:Category[],level=0):{id:string;name:string;level:number}[]=>nodes.flatMap(n=>[{id:n.id,name:n.name,level},...flatten(n.children,level+1)]);
export const price=(cents:number|null)=>cents===null?'暂无可售规格':'¥'+(cents/100).toFixed(2);
export function parseSearch(search:string):ProductQuery|null{
  const p=new URLSearchParams(search),query:ProductQuery={page:1,pageSize:12,sort:'NEWEST'};
  for(const [key,value]of p){if(p.getAll(key).length!==1)return null;
    if(key==='page'&&/^[1-9]\d*$/.test(value)&&Number.isSafeInteger(Number(value)))query.page=Number(value);
    else if(key==='keyword'&&value.length<=50)query.keyword=value;
    else if(key==='categoryId'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value))query.categoryId=value;
    else if(key==='sort'&&['NEWEST','PRICE_ASC','PRICE_DESC','SALES_DESC'].includes(value))query.sort=value as ProductQuery['sort'];else return null;
  }return query;
}
