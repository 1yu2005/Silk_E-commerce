// 作用：管理员审计检索及安全差异详情；只读GET、不展示原始JSON或自由文本载荷。
import {useMemo,useState} from 'react';
import {Alert,Button,Empty,Pagination,Spin,Tag} from 'antd';
import {Link,useParams,useSearchParams} from 'react-router-dom';
import {useEmployeeAuth} from '../auth/use-employee-auth';
import {AuthError} from '../auth/AuthError';
import {useEmployeeQuery} from '../employees/use-employee-query';
import {auditQueries,type AuditItem,type AuditOptions} from '../audit/data';
import {auditBusinessLabels,auditDate,auditIdIssue,auditLocalTime,auditSearchParams,auditTimeFromInput,auditValue,canReadAudit,parseAuditSearch,type AuditSearch} from '../audit/query';
function Actor({actor}:{actor:AuditItem['actor']}){
  if(actor.type==='SYSTEM')return <>系统</>;
  if(actor.type==='CUSTOMER')return <>顾客 · {actor.id}</>;
  return <>{actor.employee?.username??actor.employee?.displayName??'员工'}{actor.employee?.disabled?<Tag>当前停用</Tag>:null}<small> · {actor.id}</small></>;
}
function References({row}:{row:AuditItem}){
  const {permissions}=useEmployeeAuth(),codes=permissions?.effectivePermissions??[];
  return <>{row.businessReferences.length?row.businessReferences.map((ref,i)=>{
    const allowed=ref.businessType==='ORDER'?codes.some(p=>p==='order.service.read'||p==='order.fulfillment.read'):ref.businessType==='AFTER_SALE'?codes.some(p=>p==='after-sale.service.read'||p==='after-sale.inspection.read'):ref.businessType==='OFFLINE_CASE'?codes.includes('offline-case.manage'):ref.businessType==='INVENTORY_ADJUSTMENT'?codes.includes('inventory.read'):false;
    const route=ref.businessType==='ORDER'?'/orders/':ref.businessType==='AFTER_SALE'?'/after-sales/':ref.businessType==='OFFLINE_CASE'?'/offline-cases/':'/inventory/adjustments/';
    const label=`${auditBusinessLabels[ref.businessType]??'业务'} · ${ref.businessNo??ref.businessId??'标识已隐藏'}`;
    return <p key={`${ref.businessType}:${ref.businessId??i}`} className="muted">{allowed&&ref.businessId?<Link to={route+ref.businessId}>{label}</Link>:label}</p>;
  }):<span className="muted">无已确定的业务引用</span>}</>;
}
function Filters({query,options,onSearch,onActorSearch}:{query:AuditSearch;options:AuditOptions|null;onSearch:(p:URLSearchParams)=>void;onActorSearch:(value:string)=>void}){
  const [actorKeyword,setActorKeyword]=useState(''),[formError,setFormError]=useState('');
  return <><form className="catalog-form" onSubmit={event=>{event.preventDefault();const f=new FormData(event.currentTarget),p=new URLSearchParams({page:'1',pageSize:String(query.pageSize)});
    for(const [key,raw] of f){const value=String(raw).trim();if(value){try{p.set(key,key==='from'||key==='to'?auditTimeFromInput(value)!:value);}catch{setFormError('时间格式不合法');return;}}}
    const parsed=parseAuditSearch(p.toString());if(!parsed.query){setFormError(parsed.error);return;}setFormError('');onSearch(auditSearchParams(parsed.query));}}>
    <label>主体类型<select name="actorType" defaultValue={query.actorType??''}><option value="">全部主体</option><option value="EMPLOYEE">员工</option><option value="CUSTOMER">顾客</option><option value="SYSTEM">系统</option></select></label>
    <label>员工<select name="actorEmployeeId" defaultValue={query.actorEmployeeId??''}><option value="">全部员工</option>{query.actorEmployeeId&&!options?.employees.some(e=>e.id===query.actorEmployeeId)?<option value={query.actorEmployeeId}>已选员工 {query.actorEmployeeId}</option>:null}{options?.employees.map(e=><option key={e.id} value={e.id}>{e.username??e.displayName}{e.disabled?'（当前停用）':''} · {e.id.slice(0,8)}</option>)}</select></label>
    <label>顾客编号<input name="actorCustomerId" defaultValue={query.actorCustomerId} placeholder="精确顾客UUID"/></label>
    <label>操作动作<select name="action" defaultValue={query.action??''}><option value="">全部动作（含旧历史）</option>{query.action&&!options?.actions.some(a=>a.value===query.action)?<option value={query.action}>{query.action}</option>:null}{options?.actions.map(a=><option key={a.value} value={a.value}>{a.label}</option>)}</select></label>
    <label>对象类型<select name="targetType" defaultValue={query.targetType??''}><option value="">全部对象</option>{options?.targetTypes.map(t=><option key={t} value={t}>{t}</option>)}</select></label>
    <label>对象编号<input name="targetId" defaultValue={query.targetId} maxLength={100}/></label>
    <label>关联业务<select name="businessType" defaultValue={query.businessType??''}><option value="">全部业务类型</option>{Object.entries(auditBusinessLabels).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label>
    <label>精确业务单号<input name="businessNo" defaultValue={query.businessNo} maxLength={100} placeholder="订单/售后/退款/工单号"/></label>
    <label>请求编号<input name="requestId" defaultValue={query.requestId} maxLength={64}/></label>
    <label>开始时间（北京，含）<input name="from" type="datetime-local" step="1" defaultValue={auditLocalTime(query.from)}/></label>
    <label>结束时间（北京，不含）<input name="to" type="datetime-local" step="1" defaultValue={auditLocalTime(query.to)}/></label>
    {formError?<Alert type="error" title={formError}/>:null}<div><Button htmlType="submit" type="primary">查询审计</Button> <Button onClick={()=>onSearch(new URLSearchParams())}>重置筛选</Button></div>
  </form><div className="catalog-toolbar"><label>查找员工候选<input value={actorKeyword} maxLength={50} onChange={e=>setActorKeyword(e.target.value)} placeholder="工作账号或显示名"/></label><Button onClick={()=>onActorSearch(actorKeyword.trim())}>查找员工</Button><small>最多100名；停用员工历史保留，显示当前工作标识。</small></div></>;
}
function AuditList({query,setParams}:{query:AuditSearch;setParams:(p:URLSearchParams)=>void}){
  const [keyword,setKeyword]=useState(''),input=useMemo(()=>({...(keyword?{actorKeyword:keyword}:{}),limit:100}),[keyword]);
  const state=useEmployeeQuery(auditQueries.list,JSON.stringify(query),query),options=useEmployeeQuery(auditQueries.options,JSON.stringify(input),input);
  const search=auditSearchParams(query).toString();
  return <><Alert type="info" title="全店操作记录，只读查看" description="默认最近7个北京日期，最多366天、定位10000条。历史业务号仅覆盖已经确定的引用；原因等自由文本在此隐藏，业务详情仍按原权限查看。"/>
    <Filters key={search} query={query} options={options.data} onSearch={setParams} onActorSearch={setKeyword}/><AuthError error={options.error}/>
    <div className="employee-result-heading"><span>{state.data?`共 ${state.data.total} 条记录 · 截至 ${auditDate(state.data.asOf)}`:'审计结果'}</span><Button disabled={state.status==='loading'} onClick={()=>void auditQueries.list.read(JSON.stringify(query),query,true)}>刷新审计</Button></div>
    {state.data?<p className="muted">北京范围：{auditDate(state.data.from)}（含）～{auditDate(state.data.to)}（不含）</p>:null}<AuthError error={state.error}/>{state.status==='loading'?<Spin/>:null}
    {state.data?.items.length===0?<Empty description="没有符合条件的审计记录，请调整筛选"/>:null}
    {state.data?.items.map(row=><article className="catalog-card" key={row.id}><h2><Link to={`/audit-logs/${row.id}?${search}`}>{row.actionLabel} →</Link></h2><p>{auditDate(row.createdAt)} · <Actor actor={row.actor}/></p><p>对象 {row.targetType} · {row.targetId??'标识已隐藏'}</p><References row={row}/><p className="muted">{row.detailNotice}</p></article>)}
    {state.data?<Pagination current={query.page} total={Math.min(state.data.total,10000)} pageSize={query.pageSize} showSizeChanger pageSizeOptions={[10,20,50,100]} onChange={(page,pageSize)=>setParams(auditSearchParams({...query,page:pageSize===query.pageSize?page:1,pageSize}))}/>:null}
  </>;
}
export function AuditPage(){
  const {permissions}=useEmployeeAuth(),[params,setParams]=useSearchParams(),search=params.toString(),parsed=useMemo(()=>parseAuditSearch(search),[search]);
  if(!canReadAudit(permissions))return <Alert type="error" title="当前没有全店审计查询权限"/>;
  return <section className="catalog-panel"><h1>操作审计</h1>{parsed.query?<AuditList query={parsed.query} setParams={setParams}/>:<><Alert type="error" title={parsed.error}/><Button onClick={()=>setParams(new URLSearchParams())}>重置筛选</Button></>}</section>;
}
export function AuditDetailPage(){
  const {id=''}=useParams(),[params]=useSearchParams(),{permissions}=useEmployeeAuth(),allowed=canReadAudit(permissions),issue=auditIdIssue(id),state=useEmployeeQuery(auditQueries.detail,id,id,allowed&&!issue),row=state.data;
  if(!allowed)return <Alert type="error" title="当前没有全店审计查询权限"/>;
  return <section className="catalog-panel"><Link to={`/audit-logs?${params.toString()}`}>返回审计列表</Link><h1>审计详情</h1>{issue?<Alert type="error" title={issue}/>:null}<AuthError error={state.error}/>{state.status==='loading'&&!issue?<Spin/>:null}
    <Button disabled={!!issue||state.status==='loading'} onClick={()=>void auditQueries.detail.read(id,id,true)}>刷新详情</Button>
    {row?<><h2>{row.actionLabel}</h2><p>记录于 {auditDate(row.createdAt)} · <Actor actor={row.actor}/></p><p>对象 {row.targetType} · {row.targetId??'标识已隐藏'}</p><p>请求编号：{row.requestId??'不展示历史非规范标识'}</p>
      <Alert type={row.detailsAvailable?'info':'warning'} title={row.detailNotice}/><p>{row.reason??'无操作原因记录'}</p><h2>必要差异</h2>{row.changes.length?row.changes.map(change=><article className="catalog-card" key={change.field}><strong>{change.label}</strong><p>{auditValue(change.field,change.before)} → {auditValue(change.field,change.after)}</p></article>):<Empty description="没有可安全展示的字段差异"/>}<h2>关联业务</h2><References row={row}/></>:null}
  </section>;
}
