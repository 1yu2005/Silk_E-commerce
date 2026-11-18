// 作用：客服/履约订单详情、管理关闭、履约及真实沟通；不提供未实现的退款命令。
import {useMemo,useState,useSyncExternalStore} from 'react';
import {Alert,Button,Pagination,Spin,Tag} from 'antd';
import {Link,useParams} from 'react-router-dom';
import {ImageUploader,PrivateImage} from '@shop/ui';
import {settings,session,files} from '../services/api';
import {useEmployeeQuery} from '../employees/use-employee-query';
import {useEmployeeAuth} from '../auth/use-employee-auth';
import {AuthError} from '../auth/AuthError';
import {CatalogFeedback} from '../catalog/CatalogFeedback';
import {CatalogCommandScope} from '../catalog/CatalogCommandScope';
import {useCatalogCommand} from '../catalog/use-catalog-command';
import {FulfillmentPanel} from '../orders/FulfillmentPanel';
import {HistoryTimeline} from '../history/HistoryTimeline';
import {historyQueries} from '../history/data';
import {DetailNav,DetailSection} from '../components/DetailSection';
import {taskStages,taskStatuses} from '../tasks/model';
import {orderQueries,orderStatuses,cents,type OrderDetail} from '../orders/data';
export function OrderDetailPage(){
 const {id=''}=useParams(),{revision}=useSyncExternalStore(session.subscribe,session.getSnapshot),[epoch,setEpoch]=useState(0),state=useEmployeeQuery(orderQueries.detail,id,id);
 const reload=()=>{void orderQueries.detail.invalidate();void orderQueries.communications.invalidate();void historyQueries.order.invalidate();setEpoch(e=>e+1);};
 return <section className="catalog-panel detail-workspace">
  <header className="detail-page-heading"><div><Link to="/orders">返回订单列表</Link><h1>订单详情</h1><p>查看交易信息，衔接仓储履约与售后服务。</p></div><Button disabled={state.refreshing} onClick={reload}>{state.refreshing?'正在更新订单…':'读取最新订单'}</Button></header>
  <AuthError error={state.error}/>{state.data?<CatalogCommandScope key={id+':'+revision+':'+epoch+':'+state.data.version} refreshing={state.refreshing}><Detail o={state.data} refreshing={state.refreshing} reload={reload}/></CatalogCommandScope>:!state.error?<Spin/>:null}
 </section>;
}
function Detail({o,refreshing,reload}:{o:OrderDetail;refreshing:boolean;reload:()=>void}){
 const {permissions,employee}=useEmployeeAuth(),cmd=useCatalogCommand(reload,{blockConflicts:true});
 const can=(p:string)=>permissions?.effectivePermissions.includes(p),label=(labels:Readonly<Record<string,string>>,value:string)=>labels[value]??value;
 return <>
  <section className="detail-summary" aria-label="订单概览">
   <div className="detail-summary-heading"><div><span className="detail-field-label">订单编号</span><h2>{o.number}</h2><Tag color={o.status==='CLOSED'?'default':'processing'}>{orderStatuses[o.status]??o.status}</Tag></div><div className="detail-summary-amount"><span>订单应付</span><strong>{cents(o.payableCents)}</strong><small>商品 {cents(o.goodsAmountCents)} + 运费 {cents(o.shippingFeeCents)}</small></div></div>
   <dl className="detail-facts"><div><dt>收货人</dt><dd>{o.address.receiver} / {o.address.phone}</dd></div><div><dt>收货地址快照</dt><dd>{o.address.province}{o.address.city}{o.address.district}{o.address.detail}</dd></div><div><dt>创建时间</dt><dd>{new Date(o.createdAt).toLocaleString()}</dd></div><div><dt>付款截止</dt><dd>{new Date(o.paymentDeadline).toLocaleString()}</dd></div></dl>
   <div className="detail-summary-footer"><span>{o.payment&&'number'in o.payment?<>模拟支付 {o.payment.number} · {cents(o.payment.amountCents)} · {new Date(o.payment.paidAt).toLocaleString()}</>:o.payment?'已完成模拟付款':'暂无付款记录'}</span><span>模拟交易，不发生真实资金流转</span></div>
  </section>
  <div className="detail-related-links"><Link to="/after-sales">前往售后队列</Link><Link to={'/orders/'+o.id+'/coordination'}>异常协作、改址与冻结代录</Link></div>
  {o.stockNotice?<Alert type="warning" title={o.stockNotice}/>:null}<CatalogFeedback {...cmd} reload={reload}/>
  <DetailNav items={[{id:'order-items',label:'商品明细'},{id:'order-tasks',label:'任务与暂停'},{id:'order-fulfillment',label:'仓储履约'},...(can('order.service.read')?[{id:'order-communication',label:'客服沟通'}]:[]),{id:'order-history',label:'业务历史'}]}/>
  <DetailSection id="order-items" title="商品明细" description="下单时保存的商品、规格与价格快照。">
   <div className="detail-table-scroll" role="region" aria-label="订单商品明细" tabIndex={0}><table className="catalog-table detail-data-table"><thead><tr><th>商品 / 规格</th><th>购买数量</th><th>单价</th>{can('product.cost.read')?<th>成本</th>:null}<th>实物情况</th></tr></thead><tbody>{o.items.map(i=><tr key={i.id}><td><strong>{i.productName}</strong><p>{i.spec.map(s=>s.dimension+' '+s.value).join(' / ')||'默认规格'}</p><small>{i.skuCode}</small></td><td>{i.quantity} 件</td><td>{cents(i.unitPriceCents)}</td>{can('product.cost.read')?<td>{i.unitCostCents===null||i.unitCostCents===undefined?'未设置':cents(i.unitCostCents)}</td>:null}<td>{i.damageUnknown?'未知损耗':'当前未补齐 '+(i.damagedReservedQuantity??0)}<small>实物版本 {i.physicalVersion??0}</small></td></tr>)}</tbody></table></div>
  </DetailSection>
  {o.allowedActions.closeUnpaid?<DetailSection id="order-close" title="关闭未付订单"><form className="catalog-form detail-operation-form" onSubmit={e=>{e.preventDefault();const reason=String(new FormData(e.currentTarget).get('reason'));if(window.confirm('安全关闭此未付订单？不会恢复购物车。'))void cmd.run(()=>settings.closeUnpaidOrder({path:{id:o.id},body:{expectedVersion:o.version,reason}}));}}><label>管理员关单原因<textarea name="reason" required maxLength={500} rows={3}/></label><Button danger htmlType="submit" disabled={cmd.busy||cmd.blocked}>关闭未付订单</Button></form></DetailSection>:null}
  <DetailSection id="order-tasks" title="任务与暂停" description="查看各环节经办情况及当前影响订单推进的来源。">
   <div className="detail-task-list">{o.tasks?.length?o.tasks.map(t=><article className="detail-task-row" key={t.id}><div><Link to={'/tasks/'+t.id}>{label(taskStages,t.stage)}</Link><small>第{t.round}轮 · 版本 {t.version}</small></div><Tag>{label(taskStatuses,t.status)}</Tag><span className="detail-task-owner">{t.assigneeId===employee?.id?'本人经办':t.assigneeId?'经办 '+t.assigneeId:t.status==='OPEN'?'尚未领取':'当前无经办人'}</span></article>):<p className="detail-empty">暂无业务任务</p>}</div>
   {o.blocks?.length?<div className="detail-block-list">{o.blocks.map(b=><div className="detail-block" key={b.sourceId}><Tag color="warning">{b.type}</Tag>{b.sourceType==='AFTER_SALE'?<Link to={'/after-sales/'+b.sourceId}>查看售后来源</Link>:null}{b.sourceType==='STOCK_EXCEPTION'?<Link to={'/inventory/stock-incidents/'+b.sourceId}>查看库存异常来源</Link>:null}</div>)}</div>:<p className="detail-note">当前没有独立暂停来源。</p>}
  </DetailSection>
  <div id="order-fulfillment" className="detail-section detail-embedded-section"><FulfillmentPanel o={o} refreshing={refreshing}/></div>
  {can('order.service.read')?<div id="order-communication" className="detail-section detail-embedded-section"><Communications id={o.id} reload={reload}/></div>:null}
  <div id="order-history" className="detail-section detail-embedded-section"><HistoryTimeline key={o.id} id={o.id} type="order"/></div>
 </>;
}
function Communications({id,reload}:{id:string;reload:()=>void}){
 const [page,setPage]=useState(1),input=useMemo(()=>({scopeId:id,page}),[id,page]),state=useEmployeeQuery(orderQueries.communications,id+':'+page,input),cmd=useCatalogCommand(reload,{blockConflicts:true}),{permissions}=useEmployeeAuth();
 const [correctsId,setCorrectsId]=useState(''),[correctsPublic,setCorrectsPublic]=useState(false),[attachments,setAttachments]=useState<{fileId:string;audience:'INTERNAL'|'CUSTOMER_VISIBLE'}[]>([]),[occurredAt]=useState(()=>new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16));
 const canWrite=permissions?.effectivePermissions.includes('communication.service.write'),disabled=cmd.busy||cmd.blocked,revision=session.getSnapshot().revision;
 return <><h2 id="communication">客服沟通</h2><AuthError error={state.error}/>{state.status==='loading'?<Spin/>:null}
 {state.data?.items.map(c=><article className="catalog-card" key={c.id} id={'communication-'+c.id}><p>{new Date(c.occurredAt).toLocaleString()} / {c.channel}</p>{c.correctsId?<p>本条追加更正了先前沟通；更正原因：{c.correctionReason}</p>:null}<p>内部结果：{c.result}</p><p>下一步：{c.nextStep??'无'}</p><p>公开说明：{c.publicText??'不公开'}</p><div className="catalog-gallery">{c.attachments.map(a=><figure key={a.fileId}><PrivateImage fileId={a.fileId} load={files.content} sessionKey={revision} alt={a.audience==='CUSTOMER_VISIBLE'?'顾客可见沟通凭证':'内部沟通凭证'}/><figcaption>{a.audience==='CUSTOMER_VISIBLE'?'本单顾客可见':'仅授权客服可见'}</figcaption></figure>)}</div>{canWrite?<Button onClick={()=>{setCorrectsId(c.id);setCorrectsPublic(c.publicText!==null);}}>追加更正</Button>:null}</article>)}
 {state.data?<Pagination aria-label="客服沟通分页" current={page} total={state.data.total} pageSize={20} showSizeChanger={false} onChange={setPage}/>:null}
 <CatalogFeedback {...cmd} reload={reload}/>{canWrite?<form className="catalog-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void cmd.run(()=>settings.appendOrderCommunication({body:{scopeType:'ORDER',scopeId:id,channel:String(f.get('channel')) as 'PHONE',occurredAt:new Date(String(f.get('at'))).toISOString(),result:String(f.get('result')),...(f.get('next')?{nextStep:String(f.get('next'))}:{}),...(f.get('public')?{publicText:String(f.get('public'))}:{}),...(correctsId?{correctsId,correctionReason:String(f.get('correctionReason'))}:{}),attachments}}));}}><h3>{correctsId?'追加更正':'记录沟通'}</h3><fieldset disabled={disabled}>
 <label>渠道<select name="channel"><option value="PHONE">电话</option><option value="EXTERNAL_MESSAGE">外部消息</option><option value="IN_PERSON">当面</option><option value="OTHER">其他</option></select></label><label>发生时间<input type="datetime-local" name="at" required defaultValue={occurredAt}/></label><label>内部结果<textarea name="result" required maxLength={4000}/></label><label>下一步<textarea name="next" maxLength={1000}/></label><label>顾客可见说明（留空不公开）<textarea name="public" required={correctsPublic||attachments.some(a=>a.audience==='CUSTOMER_VISIBLE')} maxLength={2000}/></label>
 <ImageUploader label="上传沟通凭证（最多5张）" maxCount={5} disabled={disabled} upload={async(file,signal)=>(await files.upload('COMMUNICATION_EVIDENCE',file,signal)).data} load={files.content} sessionKey={revision} onChange={rows=>setAttachments(previous=>rows.map(row=>({fileId:row.id,audience:previous.find(a=>a.fileId===row.id)?.audience??'INTERNAL'})))}/>
 {attachments.map((a,index)=><label key={a.fileId}>第{index+1}张凭证可见范围<select aria-label={'第'+(index+1)+'张凭证可见范围'} value={a.audience} onChange={e=>{const audience=e.target.value as 'INTERNAL'|'CUSTOMER_VISIBLE';setAttachments(previous=>previous.map(item=>item.fileId===a.fileId?{...item,audience}:item));}}><option value="INTERNAL">仅授权客服可见</option><option value="CUSTOMER_VISIBLE">本单顾客也可见</option></select></label>)}
 {correctsId?<><p>正在更正已保留的历史沟通。</p><label>更正原因<input name="correctionReason" required maxLength={500}/></label><Button onClick={()=>{setCorrectsId('');setCorrectsPublic(false);}}>退出更正</Button></>:null}<Button htmlType="submit" type="primary">追加沟通记录</Button></fieldset></form>:null}</>;
}
