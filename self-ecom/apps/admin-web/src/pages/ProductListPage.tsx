// 作用：后台商品筛选、草稿创建和批量逐项上下架；版本取自本次列表。
import { useMemo, useState } from 'react';
import { Alert, Button, Empty, Pagination, Table, Tag } from 'antd';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { catalog,catalogQueries } from '../services/api';
import { useEmployeeQuery } from '../employees/use-employee-query';
import { useEmployeeAuth } from '../auth/use-employee-auth';
import { flatten,statuses,yuanToCents,centsToYuan,type Category,type ProductQuery,type Products } from '../catalog/model';
import { CatalogQueryState } from '../catalog/CatalogQueryState';
import { CatalogFeedback } from '../catalog/CatalogFeedback';
import { useCatalogCommand } from '../catalog/use-catalog-command';
import type { ApiOperations } from '@shop/api-client';
type Batch=ApiOperations['batchProductStatus']['responses'][200]['content']['application/json']['data'];
function parse(search:string):ProductQuery|null{
  const p=new URLSearchParams(search);const query:ProductQuery={page:1,pageSize:20};
  for(const [key,v]of p){if(p.getAll(key).length!==1)return null;
    if(['page','minPriceCents','maxPriceCents'].includes(key)){const n=Number(v);if(!/^[1-9]\d*$/.test(v)||!Number.isSafeInteger(n)||n>(key==='page'?Number.MAX_SAFE_INTEGER:1000000))return null;Object.assign(query,{[key]:n});}
    else if(key==='keyword'&&v.length<=50)query.keyword=v;
    else if(key==='categoryId'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v))query.categoryId=v;
    else if(key==='status'&&Object.hasOwn(statuses,v))query.status=v as ProductQuery['status'];
    else if(key==='archived'&&['true','false'].includes(v))query.archived=v==='true';else return null;
  }return query;
}
export function ProductListPage(){
  const [params,setParams]=useSearchParams();const search=params.toString();const query=useMemo(()=>parse(search),[search]);
  return <section className="catalog-panel"><div className="catalog-heading"><div><span className="eyebrow">CATALOG / 商品</span><h1>每一款，都有清晰的资料</h1><p>维护款式、颜色与尺码；初始数量草稿在库存登记确认后才生效。</p></div><Link to="/categories">管理分类 →</Link></div>
    {query?<ProductList key={search} query={query} setParams={setParams}/>:<Alert type="error" title="筛选地址不正确" action={<Button onClick={()=>setParams({})}>重置筛选</Button>}/>}
  </section>;
}
function ProductList({query,setParams}:{query:ProductQuery;setParams:(p:URLSearchParams|Record<string,string>)=>void}){
  const navigate=useNavigate();const {permissions}=useEmployeeAuth();const has=(p:string)=>permissions?.effectivePermissions.includes(p);
  const list=useEmployeeQuery(catalogQueries.products,JSON.stringify(query),query);const tree=useEmployeeQuery(catalogQueries.categories,'categories',undefined);
  const [selected,setSelected]=useState<string[]>([]),[results,setResults]=useState<Batch|null>(null);
  const reload=()=>{setSelected([]);void catalogQueries.products.invalidate();};const cmd=useCatalogCommand(reload);
  const page=(n:number)=>{const p=new URLSearchParams();for(const [k,v]of Object.entries(query))if(v!==undefined&&k!=='pageSize')p.set(k,String(v));p.set('page',String(n));setParams(p);};
  async function batch(form:HTMLFormElement){const f=new FormData(form);await cmd.run(async()=>{const items=(list.data?.items??[]).filter(p=>selected.includes(p.id)).map(p=>({id:p.id,expectedVersion:p.version}));const {data}=await catalog.batchProductStatus({body:{action:f.get('action') as 'PUBLISH'|'UNPUBLISH',items,reason:String(f.get('reason'))}});setResults(data);});}
  const columns=[{title:'款式',key:'name',render:(_:unknown,p:Products['items'][number])=><div className="product-name-cell">{p.mainImageUrl?<img src={p.mainImageUrl} alt=""/>:<span className="image-placeholder">衣</span>}<div><Link to={'/products/'+p.id}>{p.name}</Link><small>{p.brand??'未填写品牌'}</small></div></div>},{title:'状态',key:'status',render:(_:unknown,p:Products['items'][number])=><Tag color={p.status==='ON_SALE'?'green':'default'}>{p.archivedAt?'归档':statuses[p.status]}</Tag>},{title:'最低售价',key:'price',render:(_:unknown,p:Products['items'][number])=>p.priceFromCents===null?'待填价':'¥'+centsToYuan(p.priceFromCents)},{title:'可售数量 A',dataIndex:'availableQuantity'},{title:'新购',key:'buy',render:(_:unknown,p:Products['items'][number])=>p.purchasable?'可购买':p.availableQuantity==='0'?'缺货':'暂不可购买'}];
  return <><form className="catalog-filter" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget),p=new URLSearchParams();for(const k of ['keyword','categoryId','status','archived'])if(f.get(k))p.set(k,String(f.get(k)));for(const [name,key]of [['minPrice','minPriceCents'],['maxPrice','maxPriceCents']] as const){const v=String(f.get(name));if(v){const n=yuanToCents(v,1000000);if(n===null||n<1){e.currentTarget.reportValidity();return;}p.set(key,String(n));}}setParams(p);}}>
    <label>商品名称<input name="keyword" maxLength={50} defaultValue={query.keyword}/></label><label>分类<select aria-label="分类" name="categoryId" defaultValue={query.categoryId??''}><option value="">全部分类</option>{flatten((tree.data??[]) as Category[]).map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
    <label>状态<select aria-label="状态" name="status" defaultValue={query.status??''}><option value="">全部状态</option>{Object.entries(statuses).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
    <label>归档<select aria-label="归档" name="archived" defaultValue={String(query.archived??false)}><option value="false">未归档</option><option value="true">已归档</option></select></label>
    <label>最低价（元）<input name="minPrice" type="number" min="0.01" max="10000" step="0.01" defaultValue={query.minPriceCents===undefined?'':centsToYuan(query.minPriceCents)}/></label><label>最高价（元）<input name="maxPrice" type="number" min="0.01" max="10000" step="0.01" defaultValue={query.maxPriceCents===undefined?'':centsToYuan(query.maxPriceCents)}/></label><Button htmlType="submit">筛选</Button><Button onClick={()=>setParams({})}>重置</Button></form>
    <CatalogFeedback {...cmd} reload={reload}/>
    {has('product.manage')?<form className="catalog-create" onSubmit={e=>{e.preventDefault();const name=String(new FormData(e.currentTarget).get('name'));void cmd.run(async()=>{const {data}=await catalog.createProduct({body:{name}});navigate('/products/'+data.id);});}}><label>新款工作名称<input name="name" placeholder="例如：日常纯棉T恤" required maxLength={120}/></label><Button htmlType="submit" type="primary" disabled={cmd.busy||cmd.blocked}>新建商品草稿</Button></form>:null}
    {list.status==='ready'&&list.data?<><Table rowKey="id" columns={columns} dataSource={list.data.items} pagination={false} locale={{emptyText:<Empty description="没有符合条件的商品"/>}} scroll={{x:760}} rowSelection={has('product.publish')?{selectedRowKeys:selected,onChange:keys=>setSelected(keys.map(String))}:undefined}/><Pagination current={query.page??1} pageSize={20} total={list.data.total} onChange={page} showSizeChanger={false}/>
      {has('product.publish')?<form className="catalog-batch" onSubmit={e=>{e.preventDefault();void batch(e.currentTarget);}}><strong>已选 {selected.length} 项</strong><label>批量操作<select name="action" aria-label="批量操作"><option value="PUBLISH">上架</option><option value="UNPUBLISH">下架</option></select></label><label>原因<input name="reason" required maxLength={500}/></label><Button htmlType="submit" disabled={!selected.length||cmd.busy||cmd.blocked}>逐项执行</Button></form>:null}</>:<CatalogQueryState error={list.error} onRetry={reload}/>}
    {results?<Alert type="info" title="批量结果" description={<ul>{results.items.map(p=><li key={p.id}>{p.id}：{p.success?'已保存':p.message+'（'+p.code+'）'}</li>)}</ul>}/>:null}
  </>;
}
