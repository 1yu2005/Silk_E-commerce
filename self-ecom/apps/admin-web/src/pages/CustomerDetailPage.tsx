// 作用：后台只读顾客资料/地址/消费可用性，敏感状态命令与历史清晰分离。
import {useMemo,useState,useSyncExternalStore} from 'react';
import {Alert,Button,Descriptions,Empty,Pagination,Spin,Tag} from 'antd';
import {Link,useParams} from 'react-router-dom';
import {customerQueries,customers,session} from '../services/api';
import {useEmployeeQuery} from '../employees/use-employee-query';
import {useEmployeeAuth} from '../auth/use-employee-auth';
import {AuthError} from '../auth/AuthError';
import {CatalogFeedback} from '../catalog/CatalogFeedback';
import {useCatalogCommand} from '../catalog/use-catalog-command';
import {amount,date,statuses,type Customer} from '../customers/model';
export function CustomerDetailPage(){const {id=''}=useParams();const {revision}=useSyncExternalStore(session.subscribe,session.getSnapshot);const [epoch,setEpoch]=useState(0);return <section className="employee-panel"><Link to="/customers">返回顾客列表</Link><h1>顾客详情</h1>{/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)?<CustomerDetail key={id+':'+revision+':'+epoch} id={id} reload={()=>{void customerQueries.detail.invalidate();void customerQueries.history.invalidate();setEpoch(n=>n+1);}}/>:<Alert type="error" title="顾客编号不正确"/>}</section>;}
function CustomerDetail({id,reload}:{id:string;reload:()=>void}){
 const state=useEmployeeQuery(customerQueries.detail,id,id),addresses=useEmployeeQuery(customerQueries.addresses,id,id),consumption=useEmployeeQuery(customerQueries.consumption,id,id);
 const [page,setPage]=useState(1);const input=useMemo(()=>({id,page}),[id,page]);const history=useEmployeeQuery(customerQueries.history,id+':'+page,input);
 const c=state.data;
 return <>{!c||state.status!=='ready'?<><AuthError error={state.error}/>{!state.error?<Spin/>:null}<Button onClick={reload}>重新读取资料</Button></>:<>
 <div className="customer-admin-heading">{c.avatarUrl?<img className="customer-admin-avatar" src={c.avatarUrl} alt="顾客头像"/>:null}<h2>{c.nickname}</h2><Tag color={c.status==='NORMAL'?'green':'orange'}>{statuses[c.status]}</Tag><Button onClick={reload}>刷新详情</Button></div>
 <Descriptions bordered column={{xs:1,md:2}} items={[{key:'phone',label:'手机号',children:c.phone},{key:'statusVersion',label:'状态版本',children:c.statusVersion},{key:'created',label:'注册时间',children:date(c.createdAt)},{key:'login',label:'最近登录',children:date(c.lastLoginAt)}]}/>
 <Link to={'/orders?customerId='+c.id}>查看此顾客订单 →</Link><StatusManagement customer={c} reload={reload}/>
 <section className="customer-admin-section"><h2>累计净消费</h2>{consumption.data?<><p>{consumption.data.availability==='NOT_READY'?'统计待接通':amount(consumption.data.amountCents!)}</p><p className="muted">统计完成且未全额退款的订单实付金额。未完成收货的模拟付款不计入消费。</p></>:<><AuthError error={consumption.error}/>{!consumption.error?<Spin/>:null}<Button onClick={()=>void customerQueries.consumption.read(id,id,true)}>重读消费统计</Button></>}</section>
 <section className="customer-admin-section"><h2>地址簿 · 只读</h2><p className="muted">地址由顾客本人维护，不代表历史订单的收货快照。</p>{addresses.data?addresses.data.items.length?<div className="customer-admin-addresses">{addresses.data.items.map(a=><article key={a.id}><strong>{a.receiver}</strong> {a.isDefault?<Tag color="green">默认</Tag>:null}<p>{a.phone}</p><p>{a.province} {a.city} {a.district} {a.detail}</p></article>)}</div>:<Empty description="尚无收货地址"/>:<><AuthError error={addresses.error}/>{!addresses.error?<Spin/>:null}<Button onClick={()=>void customerQueries.addresses.read(id,id,true)}>重读地址簿</Button></>}</section>
 <section className="customer-admin-section"><h2>账号状态历史</h2>{history.data?<><ol className="customer-status-history">{history.data.items.map(h=><li key={h.id}><strong>{statuses[h.fromStatus]} → {statuses[h.toStatus]}</strong><p>{h.reason}</p><small>{date(h.createdAt)} · 操作员工 {h.actorEmployeeId} · 状态版本 {h.toVersion}</small><p className="muted">请求编号 {h.requestId}</p></li>)}</ol>{!history.data.total?<Empty description="尚无状态变更"/>:null}<Pagination current={page} pageSize={10} total={history.data.total} showSizeChanger={false} onChange={setPage}/></>:<><AuthError error={history.error}/>{!history.error?<Spin/>:null}<Button onClick={()=>void customerQueries.history.read(id+':'+page,input,true)}>重读状态历史</Button></>}</section>
 </>}</>;
}
function StatusManagement({customer:c,reload}:{customer:Customer;reload:()=>void}){
 const {employee,permissions}=useEmployeeAuth();const cmd=useCatalogCommand(reload);const [action,setAction]=useState('restrict');
 if(employee?.role!=='SUPER_ADMIN'||!permissions?.effectivePermissions.includes('customer.status.manage'))return <p className="muted">当前账号可只读查看顾客资料。</p>;
 const messages={restrict:'限制后仍能登录、管理资料地址和购物车，只禁止新建订单；不取消旧单。',freeze:'冻结后全部旧会话失效，禁止新登录；不自动取消订单、退款或清理购物车。',restore:'恢复正常后可以重新登录，之前冻结撤销的会话仍然无效。'};
 return <section className="customer-admin-section"><h2>管理账号状态</h2><CatalogFeedback error={cmd.error} blocked={cmd.blocked} reload={reload}/><form className="customer-status-form" onSubmit={e=>{e.preventDefault();if(!window.confirm(messages[action as keyof typeof messages]+' 确认执行？'))return;const body={expectedVersion:c.statusVersion,reason:String(new FormData(e.currentTarget).get('reason')).trim()};void cmd.run(()=>action==='freeze'?customers.freezeCustomerLogin({path:{id:c.id},body}):action==='restore'?customers.restoreCustomer({path:{id:c.id},body}):customers.restrictCustomerTrade({path:{id:c.id},body}));}}><fieldset disabled={cmd.busy||cmd.blocked}><label>操作<select name="action" value={action} onChange={e=>setAction(e.target.value)}><option value="restrict">限制交易</option><option value="freeze">冻结登录</option><option value="restore">恢复正常</option></select></label><Alert type="warning" title={messages[action as keyof typeof messages]}/><label>原因<textarea name="reason" required minLength={1} maxLength={500} rows={3}/></label><p className="muted">仅填写必要业务原因，不填写密码、完整地址或其他敏感信息。</p><Button htmlType="submit" danger={action==='freeze'} type="primary" loading={cmd.busy}>确认状态操作</Button></fieldset></form></section>;
}
