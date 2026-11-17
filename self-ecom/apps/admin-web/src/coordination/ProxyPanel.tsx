// 作用：冻结顾客单动作人工核实、显式领单和真实员工代录，原请求与上传图片在失败后保留。
import {useState} from 'react';
import {Alert,Button,Spin,Tag} from 'antd';
import {Link} from 'react-router-dom';
import {ImageUploader} from '@shop/ui';
import {settings,session,files} from '../services/api';
import {useEmployeeAuth} from '../auth/use-employee-auth';
import {AuthError} from '../auth/AuthError';
import {EmployeeQueryController} from '../employees/query-controller';
import {useEmployeeQuery} from '../employees/use-employee-query';
import {useCoordinationCommand,type CoordinationCommand} from './useCoordinationCommand';
import {offlineTime,localOfflineTime,type OfflineCase} from './offline-data';
import type {Sale} from '../after-sales/data';

type Order=Awaited<ReturnType<typeof settings.getOrderCoordination>>['data'];
type Context=Awaited<ReturnType<typeof settings.getFrozenCustomerProxyContext>>['data'];
type Action=Context['action'];
const actions:Record<Action,string>={APPLY_AFTER_SALE:'申请原单售后',SUPPLEMENT:'补充原售后材料',RETURN_LOGISTICS:'填写或修订寄回物流',OFFLINE_RESULT:'追加线下处理结果'};
const states:Record<Context['status'],string>={VERIFIED:'已核实，待指定输入',CONSUMED:'本次核实已使用',INVALIDATED:'本次核实已失效'};
const queries={
 order:new EmployeeQueryController<string,Order>(session,(id,signal)=>settings.getOrderCoordination({path:{id},signal}),'代理所需订单资料读取失败',true),
 context:new EmployeeQueryController<string,Context>(session,(id,signal)=>settings.getFrozenCustomerProxyContext({path:{id},signal}),'人工核实详情读取失败',true),
 sale:new EmployeeQueryController<string,Sale>(session,(id,signal)=>settings.getAdminAfterSale({path:{id},signal}),'售后目标读取失败',true),
 offline:new EmployeeQueryController<string,OfflineCase>(session,(id,signal)=>settings.getOfflineCase({path:{id},signal}),'线下工单目标读取失败',true),
};
const value=(f:FormData,key:string)=>String(f.get(key)??'').trim();
const active=(status:string)=>['OPEN','CLAIMED','SUSPENDED'].includes(status);

export function ProxyPanel({orderId,customerId,customerStatusVersion,orderVersion,reload}:{orderId:string;customerId:string;customerStatusVersion:number;orderVersion:number;reload:()=>void}){
 const {employee,permissions}=useEmployeeAuth(),[selected,setSelected]=useState(''),[action,setAction]=useState<Action>('APPLY_AFTER_SALE'),[saleId,setSaleId]=useState(''),[caseId,setCaseId]=useState('');
 const allowed=['customer.frozen.proxy','customer.read','after-sale.service.read'].every(p=>permissions?.effectivePermissions.includes(p));
 const refresh=()=>{reload();void queries.order.invalidate();void queries.context.invalidate();void queries.sale.invalidate();void queries.offline.invalidate();};
 const cmd=useCoordinationCommand('proxy:'+orderId,refresh),order=useEmployeeQuery(queries.order,orderId,orderId,allowed),context=useEmployeeQuery(queries.context,selected,selected,allowed&&!!selected),p=selected?context.data:null;
 const targetSaleId=p?.afterSaleId??saleId,targetCaseId=p?.offlineCaseId??caseId,sale=useEmployeeQuery(queries.sale,targetSaleId,targetSaleId,allowed&&!!targetSaleId),offline=useEmployeeQuery(queries.offline,targetCaseId,targetCaseId,allowed&&!!targetCaseId),o=order.data;
 const task=o?.tasks.find(t=>t.businessType==='ORDER'&&t.businessId===orderId&&t.stage==='PROXY_INPUT'&&active(t.status)),mine=task?.status==='CLAIMED'&&task.assigneeId===employee?.id;
 if(!allowed)return null;
 return <section aria-label="冻结顾客人工核实代录" className="catalog-card"><h2>冻结顾客人工核实代录</h2>
  <Alert type="info" title="每次只核实并代录一个指定顾客输入" description="人工回拨或交叉核对须先真实完成；方式标签不代表技术实名认证。申请后仍须正常审核、验收和办理退款。"/>
  <AuthError error={cmd.error}/>{cmd.pending?<Alert type="warning" title="上次提交结果尚未确认" description={<><p>先沿原动作和原操作键恢复结果。</p><Button disabled={cmd.busy} onClick={()=>void cmd.retry()}>沿原操作恢复结果</Button></>}/>:null}
  <Button disabled={cmd.pending||cmd.busy} onClick={()=>{refresh();cmd.reviewed();}}>读取最新事实（保留输入）</Button>
  {[order.error,context.error,sale.error,offline.error].map((e,i)=><AuthError key={i} error={e}/>)}{order.status==='loading'?<Spin/>:null}
  {o?<><label>本次核实记录<select value={selected} disabled={cmd.blocked} onChange={e=>setSelected(e.target.value)}><option value="">创建新的单动作核实</option>{o.proxyContexts.map(c=><option key={c.id} value={c.id}>{actions[c.action as Action]??c.action} · {states[c.status as Context['status']]??c.status} · {offlineTime(c.expiresAt)}</option>)}</select></label>
   {!selected?<form className="catalog-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget),body:Parameters<typeof settings.createFrozenCustomerProxyContext>[0]['body']={orderId,action,method:value(f,'method') as 'PHONE_CALLBACK',verificationSummary:value(f,'summary'),sourceCommunicationId:value(f,'communication'),expectedCustomerStatusVersion:o.customerStatusVersion??customerStatusVersion,expectedOrderVersion:o.orderVersion??orderVersion,commandKey:crypto.randomUUID(),reason:value(f,'reason'),...(action==='SUPPLEMENT'?{afterSaleId:targetSaleId,supplementRequestId:value(f,'supplement')}:{}) ,...(action==='RETURN_LOGISTICS'?{afterSaleId:targetSaleId,...(value(f,'parcel')?{parcelId:value(f,'parcel')}:{})}:{}),...(action==='OFFLINE_RESULT'?{offlineCaseId:targetCaseId,...(offline.data?.afterSaleId?{afterSaleId:offline.data.afterSaleId}:{})}:{})};void cmd.submit('createFrozenCustomerProxyContext',{path:{id:customerId},body});}}><h3>记录已实际完成的人工核实</h3><fieldset disabled={cmd.blocked}>
    <label>顾客本次指定输入<select value={action} onChange={e=>setAction(e.target.value as Action)}>{Object.entries(actions).filter(([k])=>k!=='OFFLINE_RESULT'||permissions?.effectivePermissions.includes('offline-case.manage')).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
    {action==='SUPPLEMENT'||action==='RETURN_LOGISTICS'?<><label>本订单售后<select required value={saleId} onChange={e=>setSaleId(e.target.value)}><option value="">选择真实售后</option>{o.afterSales.filter(a=>a.active&&(action==='SUPPLEMENT'?a.status==='WAIT_SUPPLEMENT':['WAIT_RETURN','WAIT_RECEIPT','WAIT_INSPECTION','INSPECTION_EXCEPTION'].includes(a.status))).map(a=><option key={a.id} value={a.id}>{a.number} · {a.status}</option>)}</select></label>{sale.status==='loading'&&targetSaleId?<Spin/>:null}{action==='SUPPLEMENT'?<label>本次待补充请求<select name="supplement" required defaultValue="" key={targetSaleId}><option value="" disabled>选择当前待补充要求</option>{sale.data?.supplementRequests.filter(r=>!r.respondedAt&&!r.closedAt).map(r=><option key={r.id} value={r.id}>第{r.requestNo}次 · {r.requirement}</option>)}</select></label>:<label>本次寄回包裹<select name="parcel" key={targetSaleId} defaultValue=""><option value="">首包首次填写（尚无包裹时）</option>{sale.data?.parcels.map(p=><option key={p.id} value={p.id}>第{p.batchNo}包 · 当前{p.revisions.find(r=>r.id===p.currentRevisionId)?.revisionNo??0}版</option>)}</select></label>}</>:null}
    {action==='OFFLINE_RESULT'?<label>本订单线下工单<select required value={caseId} onChange={e=>setCaseId(e.target.value)}><option value="">选择真实线下工单</option>{o.offlineCases.filter(c=>!['RESOLVED','CLOSED'].includes(c.status)).map(c=><option key={c.id} value={c.id}>{c.caseNo} · {c.subject}</option>)}</select></label>:null}
    <label>已存在的来源沟通<select name="communication" required defaultValue=""><option value="" disabled>先在订单追加真实沟通，再选择</option>{o.communications.map((c,i)=><option key={c.id} value={c.id}>{i+1}. {offlineTime(c.createdAt)} · {c.result.slice(0,70)}</option>)}</select></label>
    <label>人工核实方式<select name="method"><option value="PHONE_CALLBACK">电话回拨</option><option value="ORDER_INFORMATION_CROSS_CHECK">订单资料交叉核对</option><option value="OTHER_OFFLINE">其他线下方式</option></select></label>
    <label>实际核实过程与顾客本次意愿<textarea name="summary" required maxLength={2000}/></label><label>本次记录原因<input name="reason" required maxLength={500}/></label><label><input type="checkbox" required/>已核实订单归属及本次单一输入，未记录密码或证件原文</label><Button htmlType="submit">创建30分钟核实上下文</Button>
   </fieldset></form>:context.status==='loading'?<Spin/>:null}
   {selected&&p?<><h3>{actions[p.action]}</h3><p><Tag>{states[p.status]}</Tag>核实于 {offlineTime(p.verifiedAt)} · 到期 {offlineTime(p.expiresAt)}</p><p>核实摘要：{p.verificationSummary}</p>{p.invalidatedReason?<Alert type="warning" title={p.invalidatedReason} description="重新真实核实后创建本人的新上下文。"/>:null}
    {p.status==='VERIFIED'?<><p>代录任务：{task?task.status==='CLAIMED'?(mine?'本人已领取':'其他员工已领取'):task.status:'暂无有效任务'}。本次只结束自己的核实来源。</p>{task?.canClaim?<Button disabled={cmd.blocked} onClick={()=>void cmd.submit('claimTask',{path:{id:task.id},body:{expectedVersion:task.version}})}>领取本轮代理输入任务</Button>:null}
     {mine&&task?<ProxyInputForm key={p.proxyContextId} p={p} sale={sale.data} offline={offline.data} taskVersion={task.version} cmd={cmd} employeeId={employee?.id??''}/>:<p>显式领取本轮代录任务后，才能填写并提交本次输入。</p>}
    </>:<p>核实记录保留；已使用或已失效的上下文不能提交新输入。</p>}</>:null}
  </>:null}
 </section>;
}

function ProxyInputForm({p,sale,offline,taskVersion,cmd,employeeId}:{p:Context;sale:Sale|null;offline:OfflineCase|null;taskVersion:number;cmd:CoordinationCommand;employeeId:string}){
 const [ids,setIds]=useState<string[]>([]),[sent,setSent]=useState(false),[at]=useState(localOfflineTime);
 const offlineTask=offline?.tasks.find(t=>t.stage==='OFFLINE_FOLLOW'&&active(t.status)),offlineMine=offlineTask?.status==='CLAIMED'&&offlineTask.assigneeId===employeeId,parcel=sale?.parcels.find(x=>x.id===p.parcelId),revision=parcel?.revisions.find(x=>x.id===parcel.currentRevisionId);
 const ready=p.action==='APPLY_AFTER_SALE'||(p.action==='OFFLINE_RESULT'?!!offline&&offlineMine&&['IN_PROGRESS','WAIT_EXTERNAL'].includes(offline.status):!!sale);
 return <><p>实际操作者为当前员工；顾客输入仍执行原售后窗口、材料和物流规则。</p>
  {p.action==='OFFLINE_RESULT'&&offline?<><p><Link to={'/offline-cases/'+offline.id}>{offline.caseNo} · {offline.subject}</Link> · {offline.status}</p>{offlineTask?.status==='OPEN'?<Button disabled={cmd.blocked} onClick={()=>void cmd.submit('claimTask',{path:{id:offlineTask.id},body:{expectedVersion:offlineTask.version}})}>领取本工单线下跟进任务</Button>:null}{offlineMine&&offline.status==='OPEN'?<form onSubmit={e=>{e.preventDefault();void cmd.submit('beginOfflineCase',{path:{id:offline.id},body:{commandKey:crypto.randomUUID(),expectedCaseVersion:offline.version,expectedTaskVersion:offlineTask!.version,reason:value(new FormData(e.currentTarget),'reason')}});}}><label>开始处理说明<input name="reason" required maxLength={500}/></label><Button htmlType="submit" disabled={cmd.blocked}>开始处理此线下工单</Button></form>:null}<p>线下结果须同时领取本工单跟进任务并开始处理。</p></>:null}
  <form className="catalog-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget),common={commandKey:crypto.randomUUID(),expectedProxyTaskVersion:taskVersion},path={id:p.proxyContextId};
   if(p.action==='APPLY_AFTER_SALE')void cmd.submit('applyAfterSaleAsProxy',{path,body:{...common,orderId:p.orderId,type:value(f,'type') as 'REFUND_ONLY',reasonCode:value(f,'reasonCode') as 'QUALITY',description:value(f,'description'),evidenceFileIds:ids}});
   else if(p.action==='SUPPLEMENT'&&sale&&p.supplementRequestId)void cmd.submit('supplementAfterSaleAsProxy',{path,body:{...common,expectedAfterSaleVersion:sale.version,supplementRequestId:p.supplementRequestId,description:value(f,'description'),evidenceFileIds:ids}});
   else if(p.action==='RETURN_LOGISTICS'&&sale)void cmd.submit('saveReturnLogisticsAsProxy',{path,body:{...common,expectedAfterSaleVersion:sale.version,...(p.parcelId?{parcelId:p.parcelId,expectedParcelRevision:revision?.revisionNo??0}:{}),carrierName:value(f,'carrier'),trackingNumber:value(f,'tracking'),dispatchDeclaration:sent?'DECLARED_SENT':'NOT_YET_SENT',...(sent?{actualDispatchedAt:new Date(value(f,'at')).toISOString()}:{}),description:value(f,'description'),dispatchEvidenceFileIds:ids}});
   else if(p.action==='OFFLINE_RESULT'&&offline&&offlineTask)void cmd.submit('recordOfflineResultAsProxy',{path,body:{...common,offlineCaseId:offline.id,expectedCaseVersion:offline.version,expectedTaskVersion:offlineTask.version,reason:value(f,'reason'),kind:'EXTERNAL_RESULT',occurredAt:new Date(value(f,'at')).toISOString(),channel:value(f,'channel') as 'PHONE',result:value(f,'description'),...(value(f,'public')?{publicText:value(f,'public')}:{}),...(value(f,'next')?{nextStep:value(f,'next')}:{}),evidenceFileIds:ids}});
  }}><fieldset disabled={cmd.blocked||!ready}>
   {p.action==='APPLY_AFTER_SALE'?<><label>申请类型<select name="type"><option value="REFUND_ONLY">整单仅退款</option><option value="RETURN_REFUND">整单退货退款</option></select></label><label>顾客申请原因<select name="reasonCode"><option value="QUALITY">质量问题</option><option value="NOT_WANTED">不想要了</option><option value="WRONG_ITEM">错货</option><option value="DAMAGED">损坏</option><option value="OTHER">其他</option></select></label></>:null}
   {p.action==='SUPPLEMENT'?<p>补充要求：{sale?.supplementRequests.find(r=>r.id===p.supplementRequestId)?.requirement??'读取当前补充请求中'}</p>:null}
   {p.action==='RETURN_LOGISTICS'?<><p>{p.parcelId?'修订第'+(parcel?.batchNo??'')+'包，历史物流保留':'首包首次填写'}；单号本身不证明已寄出或已到仓。</p><label>承运人<input name="carrier" required maxLength={60} defaultValue={revision?.carrierName}/></label><label>寄回运单号<input name="tracking" required maxLength={100} pattern="[A-Za-z0-9\-]+" defaultValue={revision?.trackingNumber}/></label><label><input type="checkbox" checked={sent} onChange={e=>{setSent(e.target.checked);if(!e.target.checked)setIds([]);}}/>顾客明确声明已经实际寄出</label>{sent?<label>实际寄出时间<input name="at" type="datetime-local" required defaultValue={at}/></label>:null}</>:null}
   {p.action==='OFFLINE_RESULT'?<><Alert type="info" title="线下记录，不计系统支付、退款或库存"/><label>实际结果发生时间<input name="at" type="datetime-local" required defaultValue={at}/></label><label>沟通渠道<select name="channel"><option value="PHONE">电话</option><option value="EXTERNAL_MESSAGE">外部消息</option><option value="IN_PERSON">当面</option><option value="OTHER">其他</option></select></label><label>顾客可见说明（可选）<textarea name="public" maxLength={1000}/></label><label>下一步与责任（可选）<textarea name="next" maxLength={1000}/></label><label>本次记录原因<input name="reason" required maxLength={500}/></label></>:null}
   <label>{p.action==='OFFLINE_RESULT'?'顾客提供的实际线下结果':'顾客本次指定输入说明'}<textarea name="description" required maxLength={2000}/></label>
   {p.action!=='RETURN_LOGISTICS'||sent?<ImageUploader label={p.action==='OFFLINE_RESULT'?'内部线下凭据（最多5张）':'顾客售后材料（最多5张）'} maxCount={5} disabled={cmd.blocked||!ready} upload={async(file,signal)=>(await files.upload(p.action==='OFFLINE_RESULT'?'COMMUNICATION_EVIDENCE':'AFTER_SALE_EVIDENCE',file,signal)).data} load={files.content} sessionKey={session.getSnapshot().revision} onChange={rows=>setIds(rows.map(r=>r.id))}/>:null}
   <label><input type="checkbox" required/>已核对当前顾客意愿、目标和输入内容</label><Button htmlType="submit" type="primary">提交本次指定输入</Button>
  </fieldset></form>
 </>;
}
