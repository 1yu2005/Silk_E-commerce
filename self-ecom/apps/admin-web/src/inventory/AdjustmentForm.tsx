// 作用：人工登记与更正使用可读来源行；提交后跳转待确认单，保存不显示为库存已经增加。
import { useRef,useState } from 'react';
import { Button } from 'antd';
import { useNavigate } from 'react-router-dom';
import { inventory } from '../services/api';
import { useInventoryCommand } from '../inventory/use-inventory-command';
import { CatalogFeedback } from '../catalog/CatalogFeedback';
import { EvidenceUpload } from './InventoryCommon';
import { SourceSelector } from './InventoryInputs';
import { inventoryTypes,type Adjustment,type Source } from './model';
type Row={key:string;sourceLineId:string;batchKey:string;quantity:string};
export function AdjustmentForm({existing,saved}:{existing?:Adjustment;saved?:()=>void}){
 const navigate=useNavigate(),created=useRef('');const cmd=useInventoryCommand(()=>existing?saved?.():navigate('/inventory/adjustments/'+created.current));
 const [type,setType]=useState<'INITIALIZATION'|'ARRIVAL'|'AVAILABLE_LOSS'>(existing?.type==='CORRECTION'?'ARRIVAL':existing?.type??'ARRIVAL');
 const [sources,setSources]=useState<Source[]>(existing?.sources??[]),[evidence,setEvidence]=useState<string[]>([]);
 const [rows,setRows]=useState<Row[]>(existing?.lines.map(l=>({key:crypto.randomUUID(),sourceLineId:l.sourceLineId,batchKey:l.batchKey??'',quantity:String(l.quantity)}))??[{key:crypto.randomUUID(),sourceLineId:'',batchKey:'',quantity:'1'}]);
 const maximum=existing?.conversionKey?200:100;
 return <><CatalogFeedback {...cmd} reload={saved??(()=>location.reload())}/><form className="catalog-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void cmd.run(async()=>{
  const lines=rows.map(row=>{const line=sources.flatMap(s=>s.lines).find(l=>l.id===row.sourceLineId);if(!line)throw new Error('请重新载入并选择核实来源行');return {skuId:line.skuId,sourceLineId:line.id,quantity:Number(row.quantity),...(type==='AVAILABLE_LOSS'?{}:{batchKey:row.batchKey})};});
  const body={type,reason:String(f.get('reason')),evidenceNote:String(f.get('evidence'))||undefined,evidenceFileIds:evidence,lines};
  if(existing)await inventory.editInventoryAdjustment({path:{id:existing.id},body:{...body,expectedVersion:existing.version}});
  else{const result=await inventory.createInventoryAdjustment({body});created.current=result.data.id;}
 });}}><fieldset disabled={cmd.busy||cmd.blocked}>
 <label>登记类型<select value={type} disabled={!!existing} onChange={e=>{setType(e.target.value as typeof type);setSources([]);setRows([{key:crypto.randomUUID(),sourceLineId:'',batchKey:'',quantity:'1'}]);}}>{Object.entries(inventoryTypes).filter(([k])=>k!=='CORRECTION').map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
 <SourceSelector key={type} sourceType={type==='AVAILABLE_LOSS'?'LOSS':'RECEIPT'} onSelect={source=>setSources(old=>[...old.filter(s=>s.id!==source.id),source])}/>
 {sources.length?<p>已载入：{sources.map(s=>`${s.namespace}/${s.reference}`).join('；')}</p>:<p>先选择并载入已有核实来源。需要新凭据时到“来源凭据”创建。</p>}
 {rows.map((row,index)=><div className="catalog-grid" key={row.key}><label>第{index+1}行 / 来源SKU<select required value={row.sourceLineId} onChange={e=>setRows(old=>old.map(r=>r.key===row.key?{...r,sourceLineId:e.target.value}:r))}><option value="">选择已核实来源行</option>{sources.map(s=><optgroup key={s.id} label={s.reference}>{s.lines.map(l=><option key={l.id} value={l.id}>{l.lineKey} / {l.skuCode}（核实{l.verifiedQuantity} / 已记{l.netPostedQuantity}）</option>)}</optgroup>)}</select></label>
 {type!=='AVAILABLE_LOSS'?<label>实际批次<input required value={row.batchKey} maxLength={80} onChange={e=>setRows(old=>old.map(r=>r.key===row.key?{...r,batchKey:e.target.value}:r))}/></label>:null}<label>{type==='AVAILABLE_LOSS'?'实际损耗数量':'实际收货数量'}<input required type="number" min="1" max="2147483647" step="1" value={row.quantity} onChange={e=>setRows(old=>old.map(r=>r.key===row.key?{...r,quantity:e.target.value}:r))}/></label><Button disabled={rows.length===1} onClick={()=>setRows(old=>old.filter(r=>r.key!==row.key))}>移除此行</Button></div>)}
 <Button disabled={rows.length>=maximum} onClick={()=>setRows(old=>[...old,{key:crypto.randomUUID(),sourceLineId:'',batchKey:'',quantity:'1'}])}>增加登记明细</Button><label>登记原因<input name="reason" required maxLength={500} defaultValue={existing?.reason}/></label><label>独立核实说明<textarea name="evidence" maxLength={2000} defaultValue={existing?.evidenceNote??''}/></label><EvidenceUpload onChange={setEvidence} disabled={cmd.busy||cmd.blocked}/><p>提交后仍为待确认，A/R不发生变化。</p><Button type="primary" htmlType="submit" loading={cmd.busy}>{existing?'保存待确认修改':'保存待确认登记'}</Button></fieldset></form></>;
}
export function CorrectionForm({original,existing,saved}:{original?:Adjustment;existing?:Adjustment;saved?:()=>void}){
 const navigate=useNavigate(),created=useRef(''),cmd=useInventoryCommand(()=>existing?saved?.():navigate('/inventory/adjustments/'+created.current));const [evidence,setEvidence]=useState<string[]>([]);
 const targets=existing?existing.lines.map(l=>({id:l.rootLineId!,code:l.skuCode,initial:l.signedDeltaA??0})):original!.lines.filter(l=>!l.rootLineId).map(l=>({id:l.id,code:l.skuCode,initial:0}));
 return <><CatalogFeedback {...cmd} reload={saved??(()=>location.reload())}/><p>填写相对原根当前净量的差额。收货少记填正数、多记填负数；损耗更正的正数归还多扣量。填0的行不生成更正。</p><form className="catalog-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget),lines=targets.map(t=>({rootLineId:t.id,signedDeltaA:Number(f.get(t.id))})).filter(l=>l.signedDeltaA!==0);if(!lines.length)return;
 void cmd.run(async()=>{const body={reason:String(f.get('reason')),evidenceNote:String(f.get('evidence')),evidenceFileIds:evidence,lines};if(existing)await inventory.editInventoryAdjustment({path:{id:existing.id},body:{...body,type:'CORRECTION',expectedVersion:existing.version}});else{const result=await inventory.createInventoryCorrection({path:{id:original!.id},body});created.current=result.data.id;}});
 }}><fieldset disabled={cmd.busy||cmd.blocked}>{targets.map(t=><label key={t.id}>{t.code} / 差额<input name={t.id} type="number" min="-2147483647" max="2147483647" step="1" defaultValue={t.initial} required/></label>)}<label>更正原因<input name="reason" defaultValue={existing?.reason} required maxLength={500}/></label><label>核实依据<textarea name="evidence" required maxLength={2000} defaultValue={existing?.evidenceNote??''}/></label><EvidenceUpload onChange={setEvidence} disabled={cmd.busy||cmd.blocked}/><Button type="primary" htmlType="submit">{existing?'保存更正修改':'另建待确认更正'}</Button></fieldset></form></>;
}
