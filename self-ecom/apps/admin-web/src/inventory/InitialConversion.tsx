// 作用：数量来自已保存草稿，用户只匹配来源行与实际批次；转换后进入待确认登记。
import { useRef,useState } from 'react';
import { Button } from 'antd';
import { Link,useNavigate } from 'react-router-dom';
import { inventory } from '../services/api';
import { useEmployeeAuth } from '../auth/use-employee-auth';
import { CatalogFeedback } from '../catalog/CatalogFeedback';
import { useInventoryCommand } from './use-inventory-command';
import { SourceSelector } from './InventoryInputs';
import { EvidenceUpload } from './InventoryCommon';
import type { Product,Draft } from '../catalog/model';
import type { Source } from './model';
export function InitialConversion({product,draft,reload}:{product:Product;draft:Draft;reload:()=>void}){
 const {permissions}=useEmployeeAuth();if(draft?.adjustmentId)return <p>已生成登记：<Link to={'/inventory/adjustments/'+draft.adjustmentId}>查看原库存登记</Link>。实际入账状态以登记为准。</p>;
 if(draft?.status!=='EDITABLE'||!permissions?.effectivePermissions.includes('inventory.adjustment.create'))return null;
 return <ConversionForm product={product} draft={draft} reload={reload}/>;
}
function ConversionForm({product:p,draft,reload}:{product:Product;draft:NonNullable<Draft>;reload:()=>void}){
 const navigate=useNavigate(),created=useRef(''),cmd=useInventoryCommand(()=>navigate('/inventory/adjustments/'+created.current));const [source,setSource]=useState<Source|null>(null),[evidence,setEvidence]=useState<string[]>([]);
 const nonzero=draft.lines.filter(l=>l.quantity>0);
 return <div className="catalog-card"><h3>生成库存登记</h3><p>使用已保存的数量草稿，共 {nonzero.length} 个非零SKU。生成后还需要领取并确认入账。</p><SourceSelector sourceType="RECEIPT" onSelect={setSource}/><CatalogFeedback {...cmd} reload={reload}/>
 {source?<form className="catalog-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void cmd.run(async()=>{const result=await inventory.convertInitialInventoryDraft({path:{id:p.id},body:{expectedProductVersion:p.version,expectedDraftVersion:draft.version,sourceId:source.id,reason:String(f.get('reason')),evidenceNote:String(f.get('evidence'))||undefined,evidenceFileIds:evidence,
 mappings:nonzero.map(l=>({skuId:l.skuId,sourceLineId:String(f.get('source-'+l.skuId)),batchKey:String(f.get('batch-'+l.skuId))}))}});created.current=result.data.id;});}}><fieldset disabled={cmd.busy||cmd.blocked||!nonzero.length}>
 {nonzero.map(l=>{const sku=p.skus.find(s=>s.id===l.skuId);return <div className="catalog-grid" key={l.skuId}><span>{sku?.choices.map(c=>c.value).join(' / ')||sku?.code}：草稿 {l.quantity} 件</span><label>核实来源行<select required name={'source-'+l.skuId}><option value="">请选择匹配SKU的来源行</option>{source.lines.filter(s=>s.skuId===l.skuId).map(s=><option value={s.id} key={s.id}>{s.lineKey} / 核实{s.verifiedQuantity} / 已记{s.netPostedQuantity}</option>)}</select></label><label>实际批次<input required maxLength={80} name={'batch-'+l.skuId}/></label></div>;})}
 <label>转换原因<input name="reason" required maxLength={500}/></label><label>独立核实说明<textarea name="evidence" maxLength={2000}/></label><EvidenceUpload onChange={setEvidence} disabled={cmd.busy||cmd.blocked}/><Button type="primary" htmlType="submit">生成待确认库存登记</Button></fieldset></form>:null}</div>;
}
