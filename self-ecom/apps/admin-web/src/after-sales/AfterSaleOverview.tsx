// 员工售后详情的概览、申请材料与处理记录；仅展示接口已授权的字段。
import { Alert, Tag } from 'antd';
import { Link } from 'react-router-dom';
import { afterSaleLabels, PrivateImage, saleTime } from '@shop/ui';
import { files, session } from '../services/api';
import { orderStatuses, cents } from '../orders/data';
import { DetailSection } from '../components/DetailSection';
import type { Sale } from './data';

function EvidenceImages({rows}:{rows:{id:string}[]}) {
  return <div className="catalog-gallery">{rows.map(file=><PrivateImage key={file.id} fileId={file.id} load={files.content} sessionKey={session.getSnapshot().revision} alt="售后凭证"/>)}</div>;
}

export function AfterSaleOverview({sale:s}:{sale:Sale}) {
  const active=!['CLOSED','WITHDRAWN','REJECTED','SUCCEEDED'].includes(s.status);
  return <section className="detail-summary" aria-label="售后概览">
    <div className="detail-summary-heading"><div><span className="detail-field-label">售后编号</span><h2>{s.number}</h2><Tag color={active?'processing':'default'}>{afterSaleLabels[s.status]??s.status}</Tag></div>
      <div className="detail-summary-amount"><span>整单含运费</span><strong>{s.amountCents===null?'当前岗位不可见':cents(s.amountCents)}</strong></div>
    </div>
    <dl className="detail-facts">
      <div><dt>关联订单</dt><dd><Link to={'/orders/'+s.orderId}>{s.orderNo}</Link></dd></div>
      <div><dt>售后方式</dt><dd>{s.type==='REFUND_ONLY'?'仅退款':'退货退款'}</dd></div>
      <div><dt>订单状态</dt><dd>{orderStatuses[s.orderStatus]??s.orderStatus}</dd></div>
      <div><dt>新申请截止</dt><dd>{saleTime(s.afterSaleDeadline)}<small>已提交的申请可继续处理</small></dd></div>
    </dl>
    <div className="detail-notices"><Alert type="info" showIcon title={s.simulationNotice}/>{active?<Alert type="warning" showIcon title="售后处理中" description="订单发货及主动、自动收货受阻塞控制。"/>:null}</div>
  </section>;
}

export function AfterSaleMaterials({sale:s}:{sale:Sale}) {
  const address=s.returnAddressSnapshot;
  return <DetailSection id="sale-materials" title="申请商品与材料" description="查看申请说明、材料版本及寄回事实。">
    <div className="detail-table-scroll" role="region" aria-label="售后申请商品" tabIndex={0}><table className="detail-data-table"><thead><tr><th>商品</th><th>规格</th><th>申请数量</th></tr></thead><tbody>{s.items.map(item=><tr key={item.id}><td><strong>{item.productName}</strong></td><td>{item.spec.map(v=>v.dimension+' '+v.value).join(' / ')||'默认规格'}</td><td>{item.quantity} 件</td></tr>)}</tbody></table></div>
    <div className="detail-record-group"><h3>申请材料</h3>{s.materialVersions.length?s.materialVersions.map(material=><article className="detail-record" key={material.id}>
      <div className="detail-record-heading"><strong>第{material.versionNo}版 {s.currentMaterialVersionId===material.id?<Tag color="green">当前材料</Tag>:null}</strong><time>{saleTime(material.createdAt)}</time></div>
      <p>{material.description}</p><EvidenceImages rows={material.evidence}/>
    </article>):<p className="detail-empty">暂无申请材料</p>}</div>
    {s.supplementRequests.length?<div className="detail-record-group"><h3>补充材料要求</h3>{s.supplementRequests.map(request=><article className="detail-record" key={request.id}>
      <strong>第{request.requestNo}次补充要求</strong><p>{request.requirement}</p><p>{request.publicExplanation}</p>
      <p>截止 {saleTime(request.dueAt)}{Date.parse(s.serverTime)>=Date.parse(request.dueAt)&&!request.respondedAt&&!request.closedAt?' · 已超期，仍可补充，请联系客服':''}</p>
      <small>{request.respondedAt?'已于 '+saleTime(request.respondedAt)+' 补充':request.closedAt?'该要求已结束':'等待补充'}</small>
    </article>)}</div>:null}
    {address?<div className="detail-record-group"><h3>批准时退货地址</h3><dl className="detail-facts">
      <div><dt>收件人</dt><dd>{address.receiver} / {address.phone}</dd></div><div><dt>退货地址</dt><dd>{address.province}{address.city}{address.district}{address.detail}</dd></div>
      <div><dt>寄回截止</dt><dd>{saleTime(s.returnDueAt)}</dd></div><div><dt>运费责任</dt><dd>{({CUSTOMER:'顾客',MERCHANT:'店铺',UNDETERMINED:'待协商'} as Record<string,string>)[s.returnFreightResponsibility??'']??'待协商'}</dd></div>
    </dl>{s.responsibilityNote?<p>{s.responsibilityNote}</p>:null}<p className="detail-note">超期后由客服核实跟进，不自动关闭；填写单号不代表已寄出。</p></div>:null}
    {s.parcels.map(parcel=><div className="detail-record-group" key={parcel.id}><h3>寄回包裹 {parcel.batchNo}</h3>{parcel.revisions.map(revision=><article className="detail-record" key={revision.id}>
      <div className="detail-record-heading"><strong>物流第{revision.revisionNo}版</strong>{revision.id===parcel.currentRevisionId?<Tag>当前物流</Tag>:null}</div><p>{revision.carrierName} / {revision.trackingNumber}</p>
      <p>{revision.dispatchDeclaration==='DECLARED_SENT'?'顾客声明实际寄出于 '+saleTime(revision.actualDispatchedAt):'仅填写物流，尚未声明寄出'}{revision.unapprovedDispatch?' · 审核批准前自行寄出':''}</p>
      <p>{revision.description}</p><EvidenceImages rows={revision.evidence}/>
    </article>)}{parcel.revisions.length===0?<p className="detail-empty">尚无寄回物流记录，实际收包情况请查看验收与退款板块。</p>:null}</div>)}
    {s.returnVerifications.length?<div className="detail-record-group"><h3>寄回核实记录</h3>{s.returnVerifications.map(verification=><article className="detail-record" key={verification.id}>
      <div className="detail-record-heading"><strong>{({NOT_SENT:'未寄出',IN_TRANSIT:'在途',UNCERTAIN:'尚不确定'} as Record<string,string>)[verification.outcome]}</strong><time>{saleTime(verification.verifiedAt)}</time></div><p>{verification.publicExplanation}</p>
      {verification.sourceDescription?<><p>内部来源：{verification.sourceDescription}</p><p>联系结果：{verification.contactResult}</p><p>下一步：{verification.nextStep}</p><EvidenceImages rows={verification.evidence??[]}/></>:null}
    </article>)}</div>:null}
    <div className="detail-record-group"><h3>审核与处理记录</h3>{s.decisions.length?<ol className="detail-record-list">{s.decisions.map(decision=><li className="detail-record" key={decision.id}><time>{saleTime(decision.createdAt)}</time><p>{decision.publicExplanation}</p>{decision.internalNote?<p>内部说明：{decision.internalNote}</p>:null}</li>)}</ol>:<p className="detail-empty">尚无审核与处理记录</p>}{s.lastPublicExplanation?<p className="detail-note">最近公开说明：{s.lastPublicExplanation}</p>:null}</div>
  </DetailSection>;
}
