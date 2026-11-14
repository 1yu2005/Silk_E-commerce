// 作用：登记展示经办权威、核实任务和账前后事实；已入账只读，更正另建新单。
import { useState } from 'react';
import { Alert,Button,Tag } from 'antd';
import { Link,useParams } from 'react-router-dom';
import { inventory,inventoryQueries } from '../services/api';
import { useEmployeeQuery } from '../employees/use-employee-query';
import { useEmployeeAuth } from '../auth/use-employee-auth';
import { useInventoryCommand } from '../inventory/use-inventory-command';
import { CatalogFeedback } from '../catalog/CatalogFeedback';
import { CatalogCommandScope } from '../catalog/CatalogCommandScope';
import { InventoryEvidence,InventoryNav,InventoryState,EvidenceUpload } from '../inventory/InventoryCommon';
import { AdjustmentForm,CorrectionForm } from '../inventory/AdjustmentForm';
import { inventoryStatuses,inventoryTypes,signed,time,type Adjustment } from '../inventory/model';
export function InventoryAdjustmentCreatePage(){const {permissions}=useEmployeeAuth();return <section className="catalog-panel"><h1>新建库存登记</h1><InventoryNav/>{permissions?.effectivePermissions.includes('inventory.adjustment.create')?<AdjustmentForm/>:<p>需要登记创建权限。</p>}</section>;}
export function InventoryAdjustmentPage(){const {id=''}=useParams(),query=useEmployeeQuery(inventoryQueries.adjustment,id,id),reload=()=>{void inventoryQueries.adjustment.invalidate();void inventoryQueries.balances.invalidate();void inventoryQueries.ledger.invalidate();};return <section className="catalog-panel"><h1>库存登记详情</h1><InventoryNav/>{query.status==='ready'&&query.data?<CatalogCommandScope key={id+':'+query.data.version+':'+query.data.task?.version}><AdjustmentDetail adjustment={query.data} reload={reload}/></CatalogCommandScope>:<InventoryState error={query.error} reload={reload}/>}</section>;}
function AdjustmentDetail({adjustment:a,reload}:{adjustment:Adjustment;reload:()=>void}){
 const {employee,permissions}=useEmployeeAuth(),can=(p:string)=>permissions?.effectivePermissions.includes(p)??false,cmd=useInventoryCommand(reload);const [edit,setEdit]=useState(false),[correct,setCorrect]=useState(false),[evidence,setEvidence]=useState<string[]>([]);
 const pending=a.status==='PENDING',assignee=a.task?.status==='CLAIMED'&&a.task.assigneeId===employee?.id,versions={expectedVersion:a.version,expectedTaskVersion:a.task?.version??0};
 const canClaim=['inventory.read','inventory.adjustment.claim','inventory.adjustment.post'].every(can),canEdit=pending&&!a.checkRequired&&can('inventory.adjustment.create')&&(a.task?.assigneeId??a.createdById)===employee?.id;
 return <><div className="catalog-heading"><div><h2>{a.number}</h2><Tag>{inventoryTypes[a.type]}</Tag><Tag color={a.status==='POSTED'?'green':undefined}>{inventoryStatuses[a.status]}</Tag></div><Button onClick={reload}>刷新登记</Button></div>
 <p>{a.reason}</p><p>登记版本 {a.version}；创建 {time(a.createdAt)}；确认 {time(a.postedAt)}；确认人 {a.postedById??'—'}</p><p>{a.evidenceNote}</p><InventoryEvidence rows={a.evidence}/><CatalogFeedback {...cmd} reload={reload}/>
 {a.checkRequired?<Alert type="warning" showIcon title="待核实：本次确认尚未入账" description={`${a.checkReasonCode}。请核对实物、来源额度与已记记录。核实通过后会生成新的待领取入账轮次。`}/>:null}
 {a.task?<div className="catalog-card"><h2>{a.checkRequired?'核实任务':'入账任务'}</h2><p>第 {a.task.round} 轮 / 任务版本 {a.task.version} / {a.task.status} / 当前经办 {a.task.assigneeId??'尚未领取'}</p><Link to={'/tasks/'+a.task.id}>查看任务、转交和历史</Link>
 {a.task.status==='OPEN'&&canClaim?<Button disabled={cmd.busy||cmd.blocked} onClick={()=>void cmd.run(()=>inventory.claimInventoryAdjustment({path:{id:a.id},body:versions}))}>领取{a.checkRequired?'核实':'入账'}任务</Button>:null}
 {pending&&assignee&&can('inventory.adjustment.post')&&!a.checkRequired?<><p>请核对下面每笔变化。确认后不可编辑或作废。</p><Button type="primary" loading={cmd.busy} disabled={cmd.blocked} onClick={()=>void cmd.run(()=>inventory.postInventoryAdjustment({path:{id:a.id},body:versions}))}>确认入账</Button></>:null}</div>:null}
 <div className="catalog-table-wrap"><table className="catalog-table"><thead><tr><th>SKU / 来源</th><th>批次或原根</th><th>本次差额 A</th><th>当前可用 A</th><th>占用 R</th></tr></thead><tbody>{a.lines.map(l=><tr key={l.id}><td><Link to={'/inventory/skus/'+l.skuId}>{l.skuCode}</Link><br/><Link to={'/inventory/sources/'+l.sourceId}>来源凭据</Link></td><td>{l.rootAdjustmentId?<Link to={'/inventory/adjustments/'+l.rootAdjustmentId}>查看原根登记</Link>:l.batchKey??'损耗核实'}</td><td>{signed(l.deltaA)}</td><td>{l.available}</td><td>{l.reserved}（人工登记不变）</td></tr>)}</tbody></table></div>
 {a.ledger.length?<><h2>已确认流水</h2><table className="catalog-table"><thead><tr><th>SKU</th><th>A：前 / 差额 / 后</th><th>R：前 / 差额 / 后</th><th>追踪</th></tr></thead><tbody>{a.ledger.map(l=><tr key={l.id}><td>{l.skuId}</td><td>{l.beforeA} / {signed(l.deltaA)} / {l.afterA}</td><td>{l.beforeR} / {signed(l.deltaR)} / {l.afterR}</td><td>{l.requestId}</td></tr>)}</tbody></table></>:null}
 {canEdit?<><Button onClick={()=>setEdit(v=>!v)}>编辑待确认登记</Button>{edit?a.type==='CORRECTION'?<CorrectionForm existing={a} saved={reload}/>:<AdjustmentForm existing={a} saved={reload}/>:null}</>:null}
 {a.status==='POSTED'&&a.type!=='CORRECTION'&&can('inventory.adjustment.create')?<><Button onClick={()=>setCorrect(v=>!v)}>另开差额更正</Button>{correct?<CorrectionForm original={a}/>:null}</>:null}
 {pending&&assignee&&a.checkRequired&&can('inventory.adjustment.post')?<form className="catalog-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void cmd.run(()=>inventory.resolveInventoryCheck({path:{id:a.id},body:{...versions,reason:String(f.get('reason')),evidenceNote:String(f.get('evidence')),evidenceFileIds:evidence}}));}}><h2>提交核实结果</h2><fieldset disabled={cmd.busy||cmd.blocked}><label>处理原因<input name="reason" required maxLength={500}/></label><label>实际解决依据<textarea name="evidence" required maxLength={2000}/></label><EvidenceUpload onChange={setEvidence} disabled={cmd.busy||cmd.blocked}/><Button htmlType="submit">校验问题并开启新入账轮</Button></fieldset></form>:null}
 {pending&&assignee&&can('inventory.adjustment.void')?<form className="catalog-batch" onSubmit={e=>{e.preventDefault();const reason=String(new FormData(e.currentTarget).get('reason'));void cmd.run(()=>inventory.voidInventoryAdjustment({path:{id:a.id},body:{...versions,reason}}));}}><label>作废原因<input name="reason" required maxLength={500}/></label><Button htmlType="submit" disabled={cmd.busy||cmd.blocked}>作废待确认登记</Button></form>:null}
 <h2>关联来源与证据</h2>{a.sources.map(s=><div className="catalog-card" key={s.id}><Link to={'/inventory/sources/'+s.id}>{s.namespace} / {s.reference}</Link><p>{s.note}</p><InventoryEvidence rows={s.evidence}/></div>)}
 <h2>状态历史</h2><ul>{a.history.map(h=><li key={h.id}>{time(h.createdAt)}：{h.fromState??'创建'} → {h.toState}；{h.reason}</li>)}</ul>
 </>;
}
