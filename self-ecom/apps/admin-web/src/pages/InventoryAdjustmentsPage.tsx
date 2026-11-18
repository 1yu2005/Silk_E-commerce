// 作用：以单据为单位展示商品、来源、处理进度与预计变化，待确认单不会被误认为已入库。
import { useState } from 'react';
import { Button, Segmented, Tag } from 'antd';
import { Link } from 'react-router-dom';
import { inventoryQueries } from '../services/api';
import { useEmployeeQuery } from '../employees/use-employee-query';
import { useEmployeeAuth } from '../auth/use-employee-auth';
import { InventoryNav, InventoryPager, InventoryState } from '../inventory/InventoryCommon';
import { InventoryCategoryField, InventoryRecordEmpty, InventorySkuIdentity } from '../inventory/InventoryRecordCommon';
import { inventoryStatuses, inventoryTypes, signed, time, type Adjustments, type AdjustmentQuery } from '../inventory/model';
import '../inventory/inventory-records.css';

const emptyFilters={keyword:'',categoryId:'',type:'',from:'',to:''};
type Row=Adjustments['items'][number];

export function InventoryAdjustmentsPage(){
 const {employee,permissions}=useEmployeeAuth();
 const [q,setQ]=useState<AdjustmentQuery>({page:1,pageSize:10}),[draft,setDraft]=useState(emptyFilters);
 const query=useEmployeeQuery(inventoryQueries.adjustments,JSON.stringify(q),q),data=query.status==='ready'?query.data:null;
 const reload=()=>void inventoryQueries.adjustments.invalidate();
 const reset=()=>{setDraft(emptyFilters);setQ({page:1,pageSize:10});};
 return <section className="catalog-panel inventory-records">
  <header className="inventory-records-heading"><div><h1>库存登记</h1><p>按单核对商品与来源，明确每笔登记的处理进度。</p></div><div><Button onClick={reload}>刷新登记</Button>{permissions?.effectivePermissions.includes('inventory.adjustment.create')?<Link className="ant-btn ant-btn-primary" to="/inventory/adjustments/new">新建库存登记</Link>:null}</div></header><InventoryNav/>
  <div className="inventory-adjustment-guide"><strong>保存待确认</strong><span aria-hidden="true">→</span><strong>领取任务</strong><span aria-hidden="true">→</span><strong>核对并确认入账</strong><p>确认入账后才更新库存。需要核实的登记须先完成问题处理。</p></div>
  <form className="inventory-record-filters" onSubmit={e=>{e.preventDefault();setQ({page:1,pageSize:10,status:q.status,assigneeId:q.assigneeId,keyword:draft.keyword.trim()||undefined,categoryId:draft.categoryId||undefined,type:(draft.type||undefined) as AdjustmentQuery['type'],from:draft.from?new Date(draft.from).toISOString():undefined,to:draft.to?new Date(draft.to).toISOString():undefined});}}>
   <div className="inventory-record-filter-grid"><label>商品 / 登记单 / 来源<input name="keyword" maxLength={120} placeholder="商品名称、单号、来源编号或原因" value={draft.keyword} onChange={e=>setDraft({...draft,keyword:e.target.value})}/></label><InventoryCategoryField value={draft.categoryId} onChange={categoryId=>setDraft({...draft,categoryId})}/><label>登记类型<select name="type" value={draft.type} onChange={e=>setDraft({...draft,type:e.target.value})}><option value="">全部类型</option>{Object.entries(inventoryTypes).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <label>起始时间<input type="datetime-local" name="from" max={draft.to||undefined} value={draft.from} onChange={e=>setDraft({...draft,from:e.target.value})}/></label><label>截止时间<input type="datetime-local" name="to" min={draft.from||undefined} value={draft.to} onChange={e=>setDraft({...draft,to:e.target.value})}/></label><div className="inventory-record-filter-actions"><Button type="primary" htmlType="submit">查询登记</Button><Button onClick={reset}>清除筛选</Button></div>
   </div>
  </form>
  <div className="inventory-record-results"><Segmented aria-label="登记状态" value={q.status??'ALL'} options={[{label:'全部登记',value:'ALL'},...Object.entries(inventoryStatuses).map(([value,label])=>({label,value}))]} onChange={value=>setQ({...q,status:value==='ALL'?undefined:value as AdjustmentQuery['status'],page:1})}/><Button disabled={!employee} type={q.assigneeId?'primary':'default'} aria-pressed={!!q.assigneeId} onClick={()=>setQ({...q,page:1,assigneeId:q.assigneeId?undefined:employee?.id})}>我已领取的任务</Button></div>
  <div className="inventory-adjustment-results-heading"><h2>{q.assigneeId?'我的登记任务':'登记记录'}</h2>{data?<span>共 {data.total} 张登记，按创建时间倒序</span>:null}</div>
  {data?data.total===0?<InventoryRecordEmpty label="库存登记" reset={reset}/>:<><div className="inventory-adjustment-list">{data.items.map(row=><AdjustmentCard key={row.id} row={row} employeeId={employee?.id}/>)}</div><InventoryPager page={data.page} size={data.pageSize} total={data.total} unit="张登记" onPage={page=>setQ({...q,page})}/></>:<InventoryState error={query.error} reload={reload}/>}
 </section>;
}

function AdjustmentCard({row,employeeId}:{row:Row;employeeId?:string}){
 const pending=row.status==='PENDING',mine=!!employeeId&&row.task?.status==='CLAIMED'&&row.task.assigneeId===employeeId;
 const productCount=new Set(row.lines.map(l=>l.productId)).size;
 const lines=[...row.lines].sort((a,b)=>a.productName.localeCompare(b.productName,'zh-CN')||a.productId.localeCompare(b.productId));
 const increase=row.lines.reduce((sum,l)=>sum+BigInt(Math.max(l.deltaA,0)),0n),decrease=row.lines.reduce((sum,l)=>sum+BigInt(Math.min(l.deltaA,0)),0n);
 const progress=!pending?'':row.task?.status==='OPEN'?'等待领取任务':row.task?.status==='CLAIMED'?mine?'你正在处理':`${row.task.assigneeName} 正在处理`:'等待任务处理';
 return <article className={'inventory-adjustment-card'+(row.checkRequired?' inventory-adjustment-card--check':'')} aria-label={row.number}>
  <header><div><div className="inventory-adjustment-title"><h3>{inventoryTypes[row.type]}登记</h3><Tag color={row.checkRequired?'orange':row.status==='POSTED'?'green':row.status==='PENDING'?'blue':undefined}>{row.checkRequired?'待核实':inventoryStatuses[row.status]}</Tag></div><Link className="inventory-adjustment-number" to={'/inventory/adjustments/'+row.id}>{row.number}</Link></div><div className="inventory-adjustment-meta"><time dateTime={row.createdAt}>{time(row.createdAt)}</time><span>创建人：{row.createdByName}</span>{progress?<strong>{progress}</strong>:null}</div></header>
  <div className="inventory-adjustment-overview"><span>{productCount} 款商品 / {row.lines.length} 行规格</span><span>{pending?'预计可用变化':row.status==='POSTED'?'已入账可用变化':'已作废，未入账'}{row.status!=='VOID'?<strong>{increase>0n?<span className="inventory-delta-positive"> +{increase.toString()}</span>:null}{decrease<0n?<span className="inventory-delta-negative"> {decrease.toString()}</span>:null}{increase===0n&&decrease===0n?' 0':null}</strong>:null}</span></div>
  <AdjustmentLines rows={lines.slice(0,3)} voided={row.status==='VOID'}/>{lines.length>3?<details className="inventory-adjustment-more"><summary>展开其余 {lines.length-3} 行规格</summary><AdjustmentLines rows={lines.slice(3)} voided={row.status==='VOID'}/></details>:null}
  <footer><div><p><strong>登记原因</strong>{row.reason}</p>{row.checkRequired?<p className="inventory-adjustment-warning">需核对实物、来源额度与已记记录；本次确认尚未入账。</p>:row.postedAt?<small>入账时间：{time(row.postedAt)}</small>:null}</div><Link className={'ant-btn'+(pending?' ant-btn-primary':'')} to={'/inventory/adjustments/'+row.id}>{pending?row.checkRequired?'处理核实':mine?'继续处理':'查看并处理':'查看登记'}</Link></footer>
 </article>;
}

function AdjustmentLines({rows,voided}:{rows:Row['lines'];voided:boolean}){
 return <div className="inventory-adjustment-card-lines">{rows.map(line=><div className="inventory-adjustment-card-line" key={line.id}><div><InventorySkuIdentity row={line} showProduct/><small className="inventory-adjustment-category">{line.categoryPath.join(' / ')||'未分类'}</small></div><div className="inventory-adjustment-line-source"><span>来源：{line.sourceReference}</span><small>批次：{line.batchKey??'沿用原单 / 损耗核实'}</small></div><strong className={voided?'inventory-delta-zero':line.deltaA>0?'inventory-delta-positive':line.deltaA<0?'inventory-delta-negative':'inventory-delta-zero'}>{signed(line.deltaA)} 件{voided?<small>原登记数量</small>:null}</strong></div>)}</div>;
}
