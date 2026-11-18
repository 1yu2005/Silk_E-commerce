// 作用：管理员审计检索及安全差异详情；只读GET、不展示原始JSON或自由文本载荷。
import {useMemo,useState} from 'react';
import {Alert,Button,Empty,Pagination,Spin,Tag} from 'antd';
import {Link,useParams,useSearchParams} from 'react-router-dom';
import {useEmployeeAuth} from '../auth/use-employee-auth';
import {AuthError} from '../auth/AuthError';
import {useEmployeeQuery} from '../employees/use-employee-query';
import {auditQueries,type AuditItem,type AuditOptions} from '../audit/data';
import {auditBusinessLabels,auditDate,auditIdIssue,auditLocalTime,auditSearchParams,auditTargetLabel,auditTimeFromInput,auditValue,canReadAudit,parseAuditSearch,type AuditSearch} from '../audit/query';
import './audit-page.css';
function Actor({actor}:{actor:AuditItem['actor']}){
  return <div className="audit-actor"><div><strong>{actor.type==='SYSTEM'?'系统':actor.type==='CUSTOMER'?'顾客':actor.employee?.username??actor.employee?.displayName??'员工'}</strong>{actor.type==='EMPLOYEE'&&actor.employee?.disabled?<Tag>当前停用</Tag>:null}</div>{actor.type!=='SYSTEM'?<small className="audit-identifier">{actor.id}</small>:null}</div>;
}
function References({row}:{row:AuditItem}){
  const {permissions}=useEmployeeAuth(),codes=permissions?.effectivePermissions??[];
  return <>{row.businessReferences.length?row.businessReferences.map((ref,i)=>{
    const allowed=ref.businessType==='ORDER'?codes.some(p=>p==='order.service.read'||p==='order.fulfillment.read'):ref.businessType==='AFTER_SALE'?codes.some(p=>p==='after-sale.service.read'||p==='after-sale.inspection.read'):ref.businessType==='OFFLINE_CASE'?codes.includes('offline-case.manage'):ref.businessType==='INVENTORY_ADJUSTMENT'?codes.includes('inventory.read'):false;
    const route=ref.businessType==='ORDER'?'/orders/':ref.businessType==='AFTER_SALE'?'/after-sales/':ref.businessType==='OFFLINE_CASE'?'/offline-cases/':'/inventory/adjustments/';
    const label=`${auditBusinessLabels[ref.businessType]??'业务'} · ${ref.businessNo??ref.businessId??'标识已隐藏'}`;
    return <p key={`${ref.businessType}:${ref.businessId??i}`} className="audit-reference">{allowed&&ref.businessId?<Link to={route+ref.businessId}>{label}</Link>:label}</p>;
  }):<span className="audit-muted">无已确定的业务引用</span>}</>;
}
function Filters({query,options,onSearch,onActorSearch}:{query:AuditSearch;options:AuditOptions|null;onSearch:(p:URLSearchParams)=>void;onActorSearch:(value:string)=>void}){
  const [actorKeyword,setActorKeyword]=useState(''),[formError,setFormError]=useState('');
  const [moreOpen,setMoreOpen]=useState(!!(query.actorCustomerId||query.targetType||query.targetId||query.businessType||query.requestId));
  return <section className="audit-filters" aria-label="审计筛选"><div className="audit-section-heading"><h2>筛选记录</h2><span>时间按北京时间查询</span></div><form className="catalog-form" onSubmit={event=>{event.preventDefault();const f=new FormData(event.currentTarget),p=new URLSearchParams({page:'1',pageSize:String(query.pageSize)});
    for(const [key,raw] of f){const value=String(raw).trim();if(value){try{p.set(key,key==='from'||key==='to'?auditTimeFromInput(value)!:value);}catch{setFormError('时间格式不合法');return;}}}
    const parsed=parseAuditSearch(p.toString());if(!parsed.query){setFormError(parsed.error);return;}setFormError('');onSearch(auditSearchParams(parsed.query));}}>
    <div className="audit-filter-grid">
    <label>操作动作<select name="action" defaultValue={query.action??''}><option value="">全部动作（含旧历史）</option>{query.action&&!options?.actions.some(a=>a.value===query.action)?<option value={query.action}>{query.action}</option>:null}{options?.actions.map(a=><option key={a.value} value={a.value}>{a.label}</option>)}</select></label>
    <label>主体类型<select name="actorType" defaultValue={query.actorType??''}><option value="">全部主体</option><option value="EMPLOYEE">员工</option><option value="CUSTOMER">顾客</option><option value="SYSTEM">系统</option></select></label>
    <label>员工<select name="actorEmployeeId" defaultValue={query.actorEmployeeId??''}><option value="">全部员工</option>{query.actorEmployeeId&&!options?.employees.some(e=>e.id===query.actorEmployeeId)?<option value={query.actorEmployeeId}>已选员工 {query.actorEmployeeId}</option>:null}{options?.employees.map(e=><option key={e.id} value={e.id}>{e.username??e.displayName}{e.disabled?'（当前停用）':''} · {e.id.slice(0,8)}</option>)}</select></label>
    <label>精确业务单号<input name="businessNo" defaultValue={query.businessNo} maxLength={100} placeholder="订单/售后/退款/工单号"/></label>
    <label>开始时间（北京，含）<input name="from" type="datetime-local" step="1" defaultValue={auditLocalTime(query.from)}/></label>
    <label>结束时间（北京，不含）<input name="to" type="datetime-local" step="1" defaultValue={auditLocalTime(query.to)}/></label>
    </div>
    <details className="audit-more-filters" open={moreOpen} onToggle={e=>setMoreOpen(e.currentTarget.open)}><summary>更多筛选<span>顾客、操作对象、业务类型与请求编号</span></summary><div className="audit-filter-grid">
      <label>顾客编号<input name="actorCustomerId" defaultValue={query.actorCustomerId} placeholder="精确顾客UUID"/></label>
      <label>对象类型<select name="targetType" defaultValue={query.targetType??''}><option value="">全部对象</option>{query.targetType&&!options?.targetTypes.includes(query.targetType)?<option value={query.targetType}>{auditTargetLabel(query.targetType)}</option>:null}{options?.targetTypes.map(t=><option key={t} value={t}>{auditTargetLabel(t)}</option>)}</select></label>
      <label>对象编号<input name="targetId" defaultValue={query.targetId} maxLength={100} placeholder="精确操作对象编号"/></label>
      <label>关联业务<select name="businessType" defaultValue={query.businessType??''}><option value="">全部业务类型</option>{Object.entries(auditBusinessLabels).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label>
      <label>请求编号<input name="requestId" defaultValue={query.requestId} maxLength={64} placeholder="定位同一次请求"/></label>
    </div><div className="audit-employee-search"><label>查找员工候选<input value={actorKeyword} maxLength={50} onChange={e=>setActorKeyword(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();onActorSearch(actorKeyword.trim());}}} placeholder="工作账号或显示名"/></label><Button htmlType="button" onClick={()=>onActorSearch(actorKeyword.trim())}>查找员工</Button><small>最多100名，停用员工的历史记录仍可查询。</small></div></details>
    {formError?<Alert type="error" title={formError}/>:null}<div className="audit-filter-actions"><Button htmlType="submit" type="primary">查询审计</Button><Button onClick={()=>onSearch(new URLSearchParams())}>重置筛选</Button></div>
  </form></section>;
}
function AuditList({query,setParams}:{query:AuditSearch;setParams:(p:URLSearchParams)=>void}){
  const [keyword,setKeyword]=useState(''),input=useMemo(()=>({...(keyword?{actorKeyword:keyword}:{}),limit:100}),[keyword]);
  const state=useEmployeeQuery(auditQueries.list,JSON.stringify(query),query),options=useEmployeeQuery(auditQueries.options,JSON.stringify(input),input);
  const search=auditSearchParams(query).toString();
  return <><div className="audit-query-notice"><Tag>只读记录</Tag><p>默认查询最近7个北京日期，时间范围最多366天，可定位前10000条记录。</p><details><summary>记录展示范围</summary><p>历史业务号仅覆盖已经确定的引用；原因等自由文本在此隐藏，业务详情仍按原权限查看。</p></details></div>
    <Filters key={search} query={query} options={options.data} onSearch={setParams} onActorSearch={setKeyword}/><AuthError error={options.error}/>
    <div className="audit-result-heading"><div><h2>操作记录{state.data?<span>共 {state.data.total} 条</span>:null}</h2>{state.data?<p>北京范围：{auditDate(state.data.from)}（含）至 {auditDate(state.data.to)}（不含）</p>:null}</div><Button disabled={state.status==='loading'} onClick={()=>void auditQueries.list.read(JSON.stringify(query),query,true)}>刷新审计</Button></div>
    <AuthError error={state.error}/>{state.status==='loading'?<div className="audit-loading" role="status"><Spin/><span>正在读取审计记录…</span></div>:null}
    {state.data?.items.length===0?<Empty description="没有符合条件的审计记录，请调整筛选"/>:null}
    {state.data?.items.length?<div className="audit-table-wrap"><table className="audit-log-table"><thead><tr><th scope="col">操作时间</th><th scope="col">操作与对象</th><th scope="col">操作人</th><th scope="col">关联业务</th><th scope="col">详情</th></tr></thead><tbody>{state.data.items.map(row=><tr key={row.id}>
      <td data-label="操作时间"><time dateTime={row.createdAt}>{auditDate(row.createdAt)}</time></td>
      <td data-label="操作与对象"><Link className="audit-action-name" to={`/audit-logs/${row.id}?${search}`}>{row.actionLabel}</Link><span className="audit-target-label">{auditTargetLabel(row.targetType)}</span><span className="audit-identifier">{row.targetId??'标识已隐藏'}</span><small className="audit-record-notice">{row.detailNotice}</small></td>
      <td data-label="操作人"><Actor actor={row.actor}/></td><td data-label="关联业务"><References row={row}/></td>
      <td data-label="详情"><Link className="audit-detail-link" to={`/audit-logs/${row.id}?${search}`} aria-label={'查看'+row.actionLabel+'详情'}>查看详情</Link></td>
    </tr>)}</tbody></table></div>:null}
    {state.data?<div className="audit-pagination"><small>数据截至 {auditDate(state.data.asOf)}</small><Pagination current={query.page} total={Math.min(state.data.total,10000)} pageSize={query.pageSize} showSizeChanger pageSizeOptions={[10,20,50,100]} onChange={(page,pageSize)=>setParams(auditSearchParams({...query,page:pageSize===query.pageSize?page:1,pageSize}))}/></div>:null}
  </>;
}
export function AuditPage(){
  const {permissions}=useEmployeeAuth(),[params,setParams]=useSearchParams(),search=params.toString(),parsed=useMemo(()=>parseAuditSearch(search),[search]);
  if(!canReadAudit(permissions))return <Alert type="error" title="当前没有全店审计查询权限"/>;
  return <section className="catalog-panel audit-workspace"><div className="catalog-heading"><div><h1>操作审计</h1><p>按时间、操作人或业务单号，追溯店铺的每一次操作。</p></div></div>{parsed.query?<AuditList query={parsed.query} setParams={setParams}/>:<><Alert type="error" title={parsed.error}/><Button onClick={()=>setParams(new URLSearchParams())}>重置筛选</Button></>}</section>;
}
export function AuditDetailPage(){
  const {id=''}=useParams(),[params]=useSearchParams(),{permissions}=useEmployeeAuth(),allowed=canReadAudit(permissions),issue=auditIdIssue(id),state=useEmployeeQuery(auditQueries.detail,id,id,allowed&&!issue),row=state.data;
  if(!allowed)return <Alert type="error" title="当前没有全店审计查询权限"/>;
  return <section className="catalog-panel audit-workspace"><Link className="audit-back-link" to={`/audit-logs?${params.toString()}`}>返回审计列表</Link><div className="catalog-heading"><div><h1>审计详情</h1><p>查看操作信息、字段变化与关联业务。</p></div><Button disabled={!!issue||state.status==='loading'} onClick={()=>void auditQueries.detail.read(id,id,true)}>刷新详情</Button></div>{issue?<Alert type="error" title={issue}/>:null}<AuthError error={state.error}/>{state.status==='loading'&&!issue?<Spin/>:null}
    {row?<><div className="audit-detail-overview"><div><h2>{row.actionLabel}</h2><time dateTime={row.createdAt}>{auditDate(row.createdAt)}（北京）</time></div><Actor actor={row.actor}/></div><dl className="audit-detail-meta"><div><dt>操作对象</dt><dd>{auditTargetLabel(row.targetType)}<span className="audit-identifier">{row.targetId??'标识已隐藏'}</span></dd></div><div><dt>请求编号</dt><dd className="audit-identifier">{row.requestId??'不展示历史非规范标识'}</dd></div><div><dt>操作原因</dt><dd>{row.reason??'无操作原因记录'}</dd></div></dl>
      <Alert type={row.detailsAvailable?'info':'warning'} showIcon title={row.detailNotice}/><div className="audit-detail-sections"><section className="audit-detail-section"><h2>必要差异</h2>{row.changes.length?<div className="audit-table-wrap"><table className="audit-change-table"><thead><tr><th scope="col">字段</th><th scope="col">操作前</th><th scope="col">操作后</th></tr></thead><tbody>{row.changes.map(change=><tr key={change.field}><th scope="row">{change.label}</th><td>{auditValue(change.field,change.before)}</td><td>{auditValue(change.field,change.after)}</td></tr>)}</tbody></table></div>:<Empty description="没有可安全展示的字段差异"/>}</section><section className="audit-detail-section"><h2>关联业务</h2><References row={row}/></section></div></>:null}
  </section>;
}
