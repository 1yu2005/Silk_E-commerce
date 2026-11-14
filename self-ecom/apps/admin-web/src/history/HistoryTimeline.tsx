// 作用：员工订单/售后共用的明确事件投影，保留实际发生与记录时间，刷新只GET。
import { useMemo,useState } from 'react';
import { Alert,Button,Empty,Pagination,Spin,Tag } from 'antd';
import { Link } from 'react-router-dom';
import { afterSaleLabels } from '@shop/ui';
import { useEmployeeQuery } from '../employees/use-employee-query';
import { useEmployeeAuth } from '../auth/use-employee-auth';
import { AuthError } from '../auth/AuthError';
import { taskStages,taskStatuses } from '../tasks/model';
import { cents as money,fulfillmentStages,orderStatuses } from '../orders/data';
import { historyQueries,kindLabels,type HistoryKind,type HistoryItem } from './data';
const time=(value:string)=>new Date(value).toLocaleString('zh-CN',{hour12:false});
const taskEvents:Record<string,string>={CREATED:'创建任务',CLAIMED:'领取任务',RELEASED:'释放任务',TRANSFERRED:'指派或转交',QUALIFICATION_LOST:'资格失效回池',SUSPENDED:'暂停任务',RESUMED:'恢复任务',COMPLETED:'本环节完成',CANCELLED:'取消任务',DEADLINE_CHANGED:'调整截止时间',OVERDUE:'检测到逾期',EXTENDED:'延长期限',DEADLINE_ASSIGNED:'设置期限'};
const channels:Record<string,string>={PHONE:'电话',EXTERNAL_MESSAGE:'外部消息',IN_PERSON:'当面',OTHER:'其他'};
const outcomes:Record<string,string>={SUCCEEDED:'成功',FAILED:'失败',PENDING:'待处理',IN_PROGRESS:'处理中',UNCERTAIN:'结果待核实',HANDED_OVER:'已实际交运',NOT_HANDED_OVER:'尚未交运',STILL_UNCERTAIN:'仍待核实'};
const stockEvents:Record<string,string>={MANUAL_POST:'手工入账',RESERVE:'下单预占',PAY:'付款扣减预占',CLOSE:'关单释放预占',RETURN_RESTOCK:'退货验收回补',UNSHIPPED_REFUND_RESTOCK:'未交运退款回补',PAID_PREPARATION_LOSS:'备货损耗',ALLOCATE_REPLACEMENT:'分配替换库存',REFUNDED_AVAILABLE_LOSS:'退款后可售损耗'};
const physicalEvents:Record<string,string>={NORMAL:'正常最终验收',EXCEPTION_APPROVED:'批准后的异常最终验收',MOVE:'实物移位',DAMAGE:'实物损坏',CORRECTION:'追加更正',HANDOVER:'实物交接',RETURN_DISPATCH:'实际寄还',RECEIPT_CONFIRMED:'签收确认',LOCATION_CHANGED:'更新实物位置',EXCEPTION:'实物异常'};
const offlineEvents:Record<string,string>={CONTACT:'联系跟进',PROGRESS:'追加进展',EXTERNAL_RESULT:'登记线下结果',CORRECTION:'追加更正',RESOLUTION:'解决工单',CLOSURE:'有理由结束',APPLY_AFTER_SALE:'代录售后申请',SUPPLEMENT:'代录补充材料',RETURN_LOGISTICS:'代录寄回物流',OFFLINE_RESULT:'代录线下结果'};
const label=(catalog:Record<string,string>,value:string|null,fallback:string)=>value&&Object.hasOwn(catalog,value)?catalog[value]:fallback;
const stage=(value:string|null)=>label(taskStages,value,'业务任务');
function status(item:HistoryItem,value:string|null,fallback:string){
  if(!value)return fallback;
  if(item.kind==='TASK_CHANGE')return label(taskStatuses,value,'其他任务状态');
  if(item.source==='TIMER_PAUSE')return '已暂停';
  if(item.source==='TIMER_RESUME')return value==='PAUSED'?'已暂停':'已恢复';
  if(item.action==='fulfillment')return label(fulfillmentStages,value,'其他履约阶段');
  return label({...afterSaleLabels,...orderStatuses,...outcomes},value,'其他业务状态');
}
function inventorySummary(item:HistoryItem){
  const action=label(stockEvents,item.action,'其他库存动作');
  const quantities=/^[A-Z_]+ · A (-?\d+) \/ R (-?\d+)$/.exec(item.summary);
  return quantities?`${action} · 可售变化 ${quantities[1]} / 预占变化 ${quantities[2]}`:action;
}
export function HistoryTimeline({id,type}:{id:string;type:'order'|'afterSale'}){
  const {permissions}=useEmployeeAuth(),allowed=(type==='order'?['order.service.read','order.fulfillment.read']:['after-sale.service.read','after-sale.inspection.read']).some(p=>permissions?.effectivePermissions.includes(p));
  const [page,setPage]=useState(1),[pageSize,setPageSize]=useState(20),[kind,setKind]=useState<HistoryKind|''>(''),controller=historyQueries[type];
  const input=useMemo(()=>({id,query:{page,pageSize,...(kind?{kind}:{})}}),[id,page,pageSize,kind]),state=useEmployeeQuery(controller,JSON.stringify(input),input,allowed);
  return <section aria-label="业务历史"><h2>业务历史</h2>{!allowed?<Alert type="warning" title="当前没有本单历史读取权限"/>:<>
    <p>按记录时间从新到旧排列，补录事件同时显示实际发生时间。</p>
    <div className="catalog-toolbar"><label>事件类型<select aria-label="历史事件类型" value={kind} onChange={e=>{setKind(e.target.value as HistoryKind|'');setPage(1);}}><option value="">全部授权事件</option>{Object.entries(kindLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><Button onClick={()=>void controller.invalidate()}>刷新业务历史</Button></div>
    <AuthError error={state.error}/>{state.error?<Button onClick={()=>void controller.read(JSON.stringify(input),input,true)}>重试读取历史</Button>:null}
    {state.status==='loading'?<Spin aria-label="正在读取业务历史"/>:null}
    {state.status==='ready'&&state.data?.items.length===0?<Empty description="暂无符合条件的授权历史"/>:null}
    {state.data?<><ol className="history-timeline">{state.data.items.map(item=><li className="catalog-card" key={item.kind+':'+item.id+':'+item.source}><Tag>{kindLabels[item.kind]}</Tag><p><time dateTime={item.recordedAt}>记录 {time(item.recordedAt)}</time>{item.occurredAt!==item.recordedAt?<><br/><time dateTime={item.occurredAt}>实际发生 {time(item.occurredAt)}</time></>:null}</p><Event item={item}/>{item.correctsId?<p>追加更正了记录 {item.correctsId}</p>:null}<small>记录编号 {item.id}</small></li>)}</ol><Pagination aria-label="业务历史分页" current={page} pageSize={pageSize} total={state.data.total} pageSizeOptions={[20,50,100]} showSizeChanger showTotal={total=>'共 '+total+' 条授权历史'} onChange={(next,size)=>{setPage(size===pageSize?next:1);setPageSize(size);}}/></>:null}
  </>}</section>;
}
function Event({item}:{item:HistoryItem}){
  switch(item.kind){
    case 'STATE_CHANGE':return <><p>{/^[A-Z][A-Z_]+$/.test(item.summary)?status(item,item.summary,'状态变更'):item.summary}</p>{item.beforeStatus||item.afterStatus?<p>{status(item,item.beforeStatus,'开始')} → {status(item,item.afterStatus,'未变更')}</p>:null}{item.source==='TIMER_RESUME'&&item.newDueAt?<p>恢复后收货期限 {time(item.newDueAt)}</p>:null}<Note value={item.internalNote}/></>;
    case 'TASK_CHANGE':return <><p>{item.taskId?<Link to={'/tasks/'+item.taskId}>{stage(item.taskStage)}</Link>:'业务任务'} · {label(taskEvents,item.action,'其他任务变更')}</p><p>{status(item,item.beforeStatus,'开始')} → {status(item,item.afterStatus,'未变更')}</p></>;
    case 'DEADLINE_EVENT':return <><p>{item.taskId?<Link to={'/tasks/'+item.taskId}>{stage(item.taskStage)}</Link>:'业务任务'} · {label(taskEvents,item.action,'其他期限事件')}</p>{item.deadlineAt?<p>原期限 {time(item.deadlineAt)}</p>:null}{item.newDueAt?<p>调整后期限 {time(item.newDueAt)}</p>:null}</>;
    case 'COMMUNICATION':return <><p>联系渠道 {label(channels,item.action,'其他')}</p><p>沟通结果：{item.summary}</p>{item.internalNote?<p>下一步：{item.internalNote}</p>:null}</>;
    case 'PAYMENT':return <><p>模拟付款 · {status(item,item.afterStatus,'状态待核实')}{item.amountCents!==null?' · '+money(item.amountCents):''}</p><p>不发生真实资金流转。</p></>;
    case 'REFUND_ATTEMPT':return <><p>模拟退款 · {status(item,item.afterStatus,'状态待核实')}{item.amountCents!==null?' · '+money(item.amountCents):''}</p><p>{item.summary}</p>{item.action?<p>失败原因：{item.action==='SIMULATED_TEMPORARY_FAILURE'?'模拟通道暂时失败':'其他失败，请按最新事实处理'}</p>:null}</>;
    case 'INVENTORY_ACTION':return <p>库存事实：{inventorySummary(item)}</p>;
    case 'HANDOVER':return <><p>{item.source==='HANDOVER_ATTEMPT'?'交运尝试':'交运核实'} · {label(outcomes,item.action??item.afterStatus,'结果待核实')}</p><Note value={item.internalNote}/></>;
    case 'INSPECTION':return <><p>{item.summary===item.action?label(physicalEvents,item.action,'其他实物事件'):item.summary}</p>{item.action&&item.action!==item.summary?<p>处理结果 {label(physicalEvents,item.action,'其他实物处理')}</p>:null}<Note value={item.internalNote}/></>;
    case 'OFFLINE_EVENT':return <><p>{item.source==='PROXY_EXECUTION'?'核实后代录':'线下处理记录'}{item.action?' · '+label(offlineEvents,item.action,'其他处理'):''}</p><p>{item.summary}</p>{item.internalNote?<p>下一步：{item.internalNote}</p>:null}</>;
  }
}
function Note({value}:{value:string|null}){return value?<p>内部说明：{value}</p>:null;}
