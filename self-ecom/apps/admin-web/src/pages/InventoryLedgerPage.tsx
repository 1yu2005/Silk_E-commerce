// 作用：按商品预览最新流水，按时间或指定商品查看完整分页历史。
import { useState } from 'react';
import { Button, Segmented, Tag } from 'antd';
import { Link } from 'react-router-dom';
import { inventoryQueries } from '../services/api';
import { useEmployeeQuery } from '../employees/use-employee-query';
import { useEmployeeAuth } from '../auth/use-employee-auth';
import { InventoryNav, InventoryPager, InventoryState } from '../inventory/InventoryCommon';
import { InventoryCategoryField, InventoryQuantityChange, InventoryRecordEmpty, InventorySkuIdentity } from '../inventory/InventoryRecordCommon';
import { inventoryEvents, time, type Ledger, type LedgerQuery } from '../inventory/model';
import '../inventory/inventory-records.css';

const emptyFilters={keyword:'',categoryId:'',eventType:'',businessNumber:'',from:'',to:'',skuId:'',actorEmployeeId:''};
type Row=Ledger['items'][number];

export function InventoryLedgerPage(){
 const [q,setQ]=useState<LedgerQuery>({page:1,pageSize:10,groupBy:'product'}),[draft,setDraft]=useState(emptyFilters),[selectedProduct,setSelectedProduct]=useState<{id:string;name:string}|null>(null);
 const {permissions}=useEmployeeAuth(),query=useEmployeeQuery(inventoryQueries.ledger,JSON.stringify(q),q),data=query.status==='ready'?query.data:null;
 const reload=()=>void inventoryQueries.ledger.invalidate();
 const reset=()=>{setDraft(emptyFilters);setSelectedProduct(null);setQ({page:1,pageSize:10,groupBy:'product'});};
 const viewProduct=(row:Row)=>{setSelectedProduct({id:row.productId,name:row.productName});setQ({...q,productId:row.productId,page:1,pageSize:20,groupBy:'sku'});};
 const rowsByProduct=new Map<string,Row[]>();
 for(const row of data?.items??[]){const rows=rowsByProduct.get(row.productId);if(rows)rows.push(row);else rowsByProduct.set(row.productId,[row]);}
 return <section className="catalog-panel inventory-records">
  <header className="inventory-records-heading"><div><h1>库存数量流水</h1><p>从商品找到每一次库存变化，追溯来源和业务单据。</p></div><Button onClick={reload}>刷新流水</Button></header><InventoryNav/>
  <form className="inventory-record-filters" onSubmit={e=>{e.preventDefault();setQ({page:1,pageSize:q.groupBy==='product'?10:20,groupBy:q.groupBy,productId:selectedProduct?.id,keyword:draft.keyword.trim()||undefined,categoryId:draft.categoryId||undefined,eventType:draft.eventType||undefined,businessNumber:draft.businessNumber.trim()||undefined,skuId:draft.skuId||undefined,actorEmployeeId:draft.actorEmployeeId||undefined,from:draft.from?new Date(draft.from).toISOString():undefined,to:draft.to?new Date(draft.to).toISOString():undefined});}}>
   <div className="inventory-record-filter-grid"><label>商品 / SKU<input name="keyword" maxLength={120} placeholder="商品名称、商品编号或 SKU" value={draft.keyword} onChange={e=>setDraft({...draft,keyword:e.target.value})}/></label>
    <InventoryCategoryField value={draft.categoryId} onChange={categoryId=>setDraft({...draft,categoryId})}/>
    <label>流水类型<select name="eventType" value={draft.eventType} onChange={e=>setDraft({...draft,eventType:e.target.value})}><option value="">全部类型</option>{Object.entries(inventoryEvents).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <label>业务单号<input name="businessNumber" maxLength={64} placeholder="登记单、订单或售后单号" value={draft.businessNumber} onChange={e=>setDraft({...draft,businessNumber:e.target.value})}/></label>
    <label>起始时间<input type="datetime-local" name="from" max={draft.to||undefined} value={draft.from} onChange={e=>setDraft({...draft,from:e.target.value})}/></label><label>截止时间<input type="datetime-local" name="to" min={draft.from||undefined} value={draft.to} onChange={e=>setDraft({...draft,to:e.target.value})}/></label>
    <div className="inventory-record-filter-actions"><Button type="primary" htmlType="submit">查询流水</Button><Button onClick={reset}>清除筛选</Button></div>
   </div>
   <details className="inventory-record-advanced"><summary>精确筛选（SKU / 员工 ID）{draft.skuId||draft.actorEmployeeId?' · 已填写':''}</summary><div><label>SKU ID<input name="skuId" pattern="[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}" value={draft.skuId} onChange={e=>setDraft({...draft,skuId:e.target.value})}/></label><label>操作员工 ID<input name="actorEmployeeId" pattern="[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}" value={draft.actorEmployeeId} onChange={e=>setDraft({...draft,actorEmployeeId:e.target.value})}/></label></div></details>
  </form>
  {selectedProduct?<div className="inventory-record-selection"><span>正在查看：<strong>{selectedProduct.name}</strong></span><Button size="small" onClick={()=>{setSelectedProduct(null);setQ({...q,productId:undefined,page:1});}}>取消商品限定</Button></div>:null}
  <div className="inventory-record-results"><div><h2>{selectedProduct?'商品流水历史':'流水记录'}</h2>{data?<p>当前条件共 <strong>{data.recordTotal}</strong> 笔流水，涉及 <strong>{data.productTotal}</strong> 款商品</p>:null}</div><Segmented aria-label="流水查看方式" value={q.groupBy==='product'?'product':'sku'} options={[{label:'按商品查看',value:'product'},{label:'按时间查看',value:'sku'}]} onChange={value=>setQ({...q,groupBy:value as 'product'|'sku',page:1,pageSize:value==='product'?10:20})}/></div>
  <p className="inventory-record-explainer">{q.groupBy==='product'?'商品按最近变动排序，每款预览符合筛选条件的最近 5 笔；完整历史可进入该商品查看。':'按发生时间倒序展示全部匹配流水。'} A 为可供新订单使用的数量，R 为待付款占用。</p>
  {data?data.total===0?<InventoryRecordEmpty label="库存流水" reset={reset}/>:<>
   {data.groupBy==='product'?<div className="inventory-ledger-groups">{data.groups.map(group=>{const rows=rowsByProduct.get(group.productId)??[],product=rows[0];return product?<article className="inventory-ledger-group" key={group.productId} aria-label={product.productName}><header><div><p>{product.categoryPath.join(' / ')||'未分类'}</p><h3><Link to={'/products/'+product.productId}>{product.productName}</Link></h3><small>商品编号：{product.productCode}</small></div><div className="inventory-ledger-group-actions"><span>{group.recordCount} 笔流水</span><Button size="small" onClick={()=>viewProduct(product)}>查看该商品全部流水</Button></div></header><LedgerTable rows={rows} canOrder={permissions?.effectivePermissions.some(p=>['order.fulfillment.read','order.service.read'].includes(p))??false} canAfterSale={permissions?.effectivePermissions.some(p=>['after-sale.inspection.read','after-sale.service.read'].includes(p))??false}/></article>:null;})}</div>:<LedgerTable rows={data.items} showProduct canOrder={permissions?.effectivePermissions.some(p=>['order.fulfillment.read','order.service.read'].includes(p))??false} canAfterSale={permissions?.effectivePermissions.some(p=>['after-sale.inspection.read','after-sale.service.read'].includes(p))??false}/>}
   <InventoryPager page={data.page} size={data.pageSize} total={data.total} unit={data.groupBy==='product'?'款商品':'笔流水'} onPage={page=>setQ({...q,page})}/>
  </>:<InventoryState error={query.error} reload={reload}/>}
  <p className="inventory-record-footnote">流水记录保留每笔发生时的余额；入库数量与已售数量分别留痕，更正通过新的差额流水体现。</p>
 </section>;
}

function LedgerTable({rows,showProduct=false,canOrder,canAfterSale}:{rows:Row[];showProduct?:boolean;canOrder:boolean;canAfterSale:boolean}){
 return <div className="inventory-record-table-wrap"><table className="inventory-ledger-table"><caption className="inventory-record-sr-only">{showProduct?'库存流水明细':rows[0]?.productName+'流水明细'}</caption><colgroup><col className="inventory-ledger-spec-col"/><col className="inventory-ledger-event-col"/><col/><col/><col className="inventory-ledger-business-col"/></colgroup><thead><tr><th scope="col">{showProduct?'商品 / 规格':'颜色 / 尺码'}</th><th scope="col">业务与时间</th><th scope="col">可用 A 变化</th><th scope="col">占用 R 变化</th><th scope="col">单据与操作依据</th></tr></thead><tbody>{rows.map(row=>{
  const href=row.businessType==='ADJUSTMENT'?'/inventory/adjustments/'+row.businessId:row.businessType==='ORDER'&&canOrder?'/orders/'+row.businessId:row.businessType==='AFTER_SALE'&&canAfterSale?'/after-sales/'+row.businessId:null;
  return <tr key={row.id}><td><InventorySkuIdentity row={row} showProduct={showProduct}/></td><td><Tag color={row.deltaA>0?'cyan':row.deltaA<0?'orange':undefined}>{inventoryEvents[row.eventType]??row.eventType}</Tag><time dateTime={row.createdAt}>{time(row.createdAt)}</time></td><td><InventoryQuantityChange before={row.beforeA} after={row.afterA} delta={row.deltaA}/></td><td><InventoryQuantityChange before={row.beforeR} after={row.afterR} delta={row.deltaR}/></td><td><div className="inventory-record-business">{href?<Link to={href}>{row.businessNumber}</Link>:<span>{row.businessNumber}</span>}<p>{row.reason}</p><small>操作人：{row.actorName}</small>{row.quantityReleased!==null?<small>释放 {row.quantityReleased} 件 / 受损 {row.quantityDamaged??0} 件</small>:null}</div></td></tr>;
 })}</tbody></table></div>;
}
