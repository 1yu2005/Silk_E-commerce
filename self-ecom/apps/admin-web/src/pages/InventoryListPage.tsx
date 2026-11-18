// 作用：库存余额/低库存、来源、登记与流水列表共用既有会话隔离查询和显式筛选。
import { useState } from 'react';
import { Button } from 'antd';
import { Link } from 'react-router-dom';
import { inventoryQueries } from '../services/api';
import { useEmployeeQuery } from '../employees/use-employee-query';
import { useEmployeeAuth } from '../auth/use-employee-auth';
import { InventoryNav,InventoryPager,InventoryState } from '../inventory/InventoryCommon';
import { time,type SourceQuery,type Sources } from '../inventory/model';
import { SourceDeleteDialog } from '../inventory/SourceDeleteDialog';
export { InventoryListPage } from './InventoryBalancesPage';
export function InventorySourcesPage(){
 const [q,setQ]=useState<SourceQuery>({page:1,pageSize:20}),query=useEmployeeQuery(inventoryQueries.sources,JSON.stringify(q),q);const {permissions}=useEmployeeAuth(),reload=()=>void inventoryQueries.sources.invalidate();
 const [deleting,setDeleting]=useState<Sources['items'][number]|null>(null),manage=permissions?.effectivePermissions.includes('inventory.source.manage');
 return <section className="catalog-panel"><h1>库存来源凭据</h1><InventoryNav/><p>初始化与到货共用来源和实际批次。损耗单不会腾出原到货的入账额度。</p>{permissions?.effectivePermissions.includes('inventory.source.manage')?<Link className="ant-btn" to="/inventory/sources/new">新建核实来源</Link>:null}
 <form className="catalog-batch" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);setQ({page:1,pageSize:20,keyword:String(f.get('keyword'))||undefined,sourceType:(String(f.get('sourceType'))||undefined) as SourceQuery['sourceType']});}}><label>凭据 / 来源范围<input name="keyword"/></label><label>来源类型<select name="sourceType"><option value="">全部</option><option value="RECEIPT">收货</option><option value="LOSS">可售损耗</option></select></label><Button htmlType="submit">筛选</Button><Button onClick={reload}>刷新</Button></form>
 <p>误建且未被库存登记引用的来源可以删除；已有登记引用的凭据（含已作废登记）需保留。</p>
 {query.status==='ready'&&query.data?<><div className="catalog-table-wrap"><table className="catalog-table"><thead><tr><th>来源范围</th><th>凭据编号</th><th>类型</th><th>核实说明</th><th>创建时间</th>{manage?<th>操作</th>:null}</tr></thead><tbody>{query.data.items.map(r=><tr key={r.id}><td>{r.namespace}</td><td><Link to={'/inventory/sources/'+r.id}>{r.reference}</Link></td><td>{r.sourceType==='RECEIPT'?'收货':'损耗'}</td><td>{r.note}</td><td>{time(r.createdAt)}</td>{manage?<td><Button danger size="small" disabled={!r.canDelete} onClick={()=>setDeleting(r)} aria-label={'删除来源凭据 '+r.reference}>删除凭据</Button>{r.deleteBlockedReason?<p className="catalog-muted">{r.deleteBlockedReason}</p>:null}</td>:null}</tr>)}</tbody></table></div><InventoryPager page={q.page??1} total={query.data.total} onPage={page=>setQ({...q,page})}/></>:<InventoryState error={query.error} reload={reload}/>}
 {manage&&deleting?<SourceDeleteDialog key={deleting.id+':'+deleting.version} source={deleting} onClose={()=>setDeleting(null)} onDeleted={()=>{setDeleting(null);if(query.data?.items.length===1&&(q.page??1)>1)setQ({...q,page:(q.page??1)-1});}} reload={()=>{setDeleting(null);reload();}}/>:null}</section>;
}
export { InventoryAdjustmentsPage } from './InventoryAdjustmentsPage';
export { InventoryLedgerPage } from './InventoryLedgerPage';
