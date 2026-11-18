// 作用：流水与登记共用分类筛选、规格身份和数量变化表达。
import { Alert, Button } from 'antd';
import { Link } from 'react-router-dom';
import { catalogQueries } from '../services/api';
import { useEmployeeQuery } from '../employees/use-employee-query';
import type { Category } from '../catalog/model';
import { CategorySelect } from '../catalog/CategorySelect';
import { signed, type Ledger } from './model';

export function InventoryCategoryField({value,onChange}:{value:string;onChange:(value:string)=>void}){
 const query=useEmployeeQuery(catalogQueries.categories,'categories',undefined);
 return <div className="inventory-record-category"><label>商品分类<CategorySelect categories={(query.data??[]) as Category[]} value={value} disabled={query.status!=='ready'} onChange={onChange} placeholder={query.status==='ready'?'全部分类（含未分类）':'正在读取分类…'}/></label>{query.error?<Alert type="warning" title="分类读取失败" action={<Button size="small" onClick={()=>void catalogQueries.categories.invalidate()}>重试</Button>}/>:null}</div>;
}

export function InventorySkuIdentity({row,showProduct=false}:{row:Pick<Ledger['items'][number],'productId'|'productName'|'choices'|'skuCode'|'skuId'|'skuRetired'>;showProduct?:boolean}){
 return <div className="inventory-record-sku">{showProduct?<Link className="inventory-record-product-name" to={'/products/'+row.productId}>{row.productName}</Link>:null}<span>{row.choices.join(' / ')||'默认规格'}{row.skuRetired?<small className="inventory-history-spec">历史规格</small>:null}</span><Link className="inventory-record-code" to={'/inventory/skus/'+row.skuId}>SKU：{row.skuCode}</Link></div>;
}

export function InventoryQuantityChange({before,after,delta}:{before:number;after:number;delta:number}){
 return <div className="inventory-quantity-change"><strong className={delta>0?'inventory-delta-positive':delta<0?'inventory-delta-negative':'inventory-delta-zero'}>{signed(delta)}</strong><span aria-label={`变动前 ${before}，变动后 ${after}`}>{before}<span aria-hidden="true"> → </span>{after}</span></div>;
}

export function InventoryRecordEmpty({reset,label}:{reset:()=>void;label:string}){
 return <div className="inventory-record-empty"><h2>没有符合条件的{label}</h2><p>调整商品、分类或时间范围后重新查询。</p><Button onClick={reset}>清除筛选</Button></div>;
}
