// 作用：顾客资料筛选和稳定分页，列表只显示脱敏手机号。
import {useMemo} from 'react';
import {Alert,Button,Pagination,Spin,Table,Tag} from 'antd';
import {Link,useSearchParams} from 'react-router-dom';
import {customerQueries} from '../services/api';
import {useEmployeeQuery} from '../employees/use-employee-query';
import {AuthError} from '../auth/AuthError';
import {date,statuses,type CustomerQuery,type Customers} from '../customers/model';
function parse(search:string):CustomerQuery|null{
 const p=new URLSearchParams(search),q:CustomerQuery={page:1,pageSize:20};
 for(const [k,v] of p){if(p.getAll(k).length!==1)return null;
  if(k==='page'){if(!/^[1-9]\d*$/.test(v)||!Number.isSafeInteger(Number(v)))return null;q.page=Number(v);}
  else if(k==='phone'&&/^1[3-9]\d{9}$/.test(v))q.phone=v;
  else if(k==='nickname'&&v.trim().length>0&&v.length<=40)q.nickname=v;
  else if(k==='status'&&Object.hasOwn(statuses,v))q.status=v as CustomerQuery['status'];
  else if((k==='registeredFrom'||k==='registeredTo')&&!Number.isNaN(Date.parse(v)))q[k]=v;
  else return null;
 }return q;
}
export function CustomerListPage(){const [params,setParams]=useSearchParams();const search=params.toString();const q=useMemo(()=>parse(search),[search]);return <section className="employee-panel"><span className="eyebrow">CUSTOMERS / 顾客</span><h1>顾客资料</h1><p>客服可查资料和地址；账号限制仅由超级管理员处理。</p>{q?<CustomerList key={search} query={q} setParams={setParams}/>:<Alert type="error" title="筛选地址不正确" action={<Button onClick={()=>setParams({})}>重置筛选</Button>}/>}</section>;}
function CustomerList({query,setParams}:{query:CustomerQuery;setParams:(p:URLSearchParams)=>void}){
 const state=useEmployeeQuery(customerQueries.list,JSON.stringify(query),query);const reload=()=>void customerQueries.list.read(JSON.stringify(query),query,true);
 const columns=[{title:'昵称',key:'nickname',render:(_:unknown,r:Customers['items'][number])=><Link to={'/customers/'+r.id}>{r.nickname}</Link>},{title:'手机号',dataIndex:'phoneMasked'},{title:'状态',key:'status',render:(_:unknown,r:Customers['items'][number])=><Tag color={r.status==='NORMAL'?'green':'orange'}>{statuses[r.status]}</Tag>},{title:'注册时间',key:'createdAt',render:(_:unknown,r:Customers['items'][number])=>date(r.createdAt)},{title:'最近登录',key:'lastLoginAt',render:(_:unknown,r:Customers['items'][number])=>date(r.lastLoginAt)}];
 return <><form className="catalog-filter" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget),p=new URLSearchParams();for(const k of ['phone','nickname','status']){const v=String(f.get(k)??'').trim();if(v)p.set(k,v);}for(const k of ['registeredFrom','registeredTo']){const v=String(f.get(k)??'');if(v)p.set(k,new Date(v).toISOString());}setParams(p);}}><label>完整手机号<input name="phone" pattern="1[3-9][0-9]{9}" maxLength={11} defaultValue={query.phone}/></label><label>昵称<input name="nickname" maxLength={40} defaultValue={query.nickname}/></label><label>账号状态<select name="status" defaultValue={query.status??''}><option value="">全部状态</option>{Object.entries(statuses).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>注册开始<input type="datetime-local" name="registeredFrom" defaultValue={local(query.registeredFrom)}/></label><label>注册截止<input type="datetime-local" name="registeredTo" defaultValue={local(query.registeredTo)}/></label><Button htmlType="submit" type="primary">筛选顾客</Button><Button onClick={()=>setParams(new URLSearchParams())}>重置</Button></form>
 {state.status!=='ready'||!state.data?<><AuthError error={state.error}/>{!state.error?<Spin/>:null}<Button onClick={reload}>重新读取顾客</Button></>:<><Table rowKey="id" columns={columns} dataSource={state.data.items} pagination={false} scroll={{x:760}}/><Pagination current={query.page} total={state.data.total} pageSize={20} showSizeChanger={false} onChange={page=>{const p=new URLSearchParams();for(const [k,v] of Object.entries({...query,page}))if(k!=='pageSize'&&v!==undefined)p.set(k,String(v));setParams(p);}}/></>}</>;
}
function local(value?:string){if(!value)return '';const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
