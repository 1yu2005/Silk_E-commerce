// 作用：以稳定ID编辑颜色尺码方案；新值使用clientKey，预览无写入，保存后服务器返回真实映射。
import { useRef,useState } from 'react';
import { Alert, Button } from 'antd';
import { ApiClientError } from '@shop/api-client';
import { catalog } from '../services/api';
import type { Product,Scheme } from './model';
import { CatalogFeedback } from './CatalogFeedback';
import { useCatalogCommand } from './use-catalog-command';
export function ProductScheme({product:p,disabled,onSaved,reload}:{product:Product;disabled:boolean;onSaved:()=>void;reload:()=>void}){
  const [dimensions,setDimensions]=useState<Scheme>(p.specDimensions),[mode,setMode]=useState<'APPEND'|'REBUILD'>(p.specDimensions.length?'APPEND':'REBUILD'),[preview,setPreview]=useState<number|null>(null),[previewError,setPreviewError]=useState<unknown>(null);
  const previewSerial=useRef(0);const cmd=useCatalogCommand(onSaved),off=disabled||cmd.busy||cmd.blocked;
  const count=dimensions.reduce((n,d)=>n*d.values.length,1);
  const emptyDimension=dimensions.some(d=>!d.values.length),overLimit=count>200;
  function edit(i:number,patch:Partial<Scheme[number]>){previewSerial.current++;setPreview(null);setDimensions(rows=>rows.map((d,j)=>j===i?{...d,...patch}:d));}
  const newValue=()=>({clientKey:crypto.randomUUID(),name:''});
  return <section id="scheme" className="catalog-card"><h2>颜色与尺码</h2><p>一套方案最多设置3个规格维度（如颜色、尺码、版型），每个维度最多20个规格值；各维度的值数量相乘，当前方案最多生成200个SKU。三个上限须同时满足。</p><p>例如：3种颜色 × 4个尺码 = 12个SKU。20 × 20 × 20 = 8000，超过200个SKU，无法保存。未设置规格时使用1个默认SKU。</p><p>已有业务引用的方案只能追加值；重建还要求全部SKU的可用量、占用量均为0，且没有非零的初始数量草稿。重建保留历史SKU与库存账户，历史规格不计入当前方案的200个上限。</p><CatalogFeedback error={cmd.error??previewError} blocked={cmd.blocked} reload={reload}/>
    <form className="catalog-form" onSubmit={e=>{e.preventDefault();const reason=String(new FormData(e.currentTarget).get('reason'));void cmd.run(()=>catalog.saveProductSkuScheme({path:{id:p.id},body:{expectedVersion:p.version,mode,reason,dimensions}}));}}><fieldset disabled={off}>
      <label>保存方式<select aria-label="保存方式" value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="APPEND">固定现有规格，追加值</option><option value="REBUILD">无引用、零余额时重建</option></select></label>
      {dimensions.map((d,i)=><div className="spec-dimension" key={d.id??d.clientKey}><label>规格{i+1}名称<input value={d.name} required maxLength={30} readOnly={mode==='APPEND'&&!!d.id} onChange={e=>edit(i,{name:e.target.value})}/></label>
        <div className="spec-values">{d.values.map((v,j)=><div key={v.id??v.clientKey}><label>值{i+1}-{j+1}<input value={v.name} required maxLength={30} readOnly={mode==='APPEND'&&!!v.id} onChange={e=>edit(i,{values:d.values.map((x,k)=>k===j?{...x,name:e.target.value}:x)})}/></label><Button disabled={mode==='APPEND'&&!!v.id} onClick={()=>edit(i,{values:d.values.filter((_,k)=>k!==j)})}>移除值</Button></div>)}</div>
        <Button disabled={d.values.length>=20} onClick={()=>edit(i,{values:[...d.values,newValue()]})}>追加规格值</Button><Button disabled={mode==='APPEND'&&!!d.id} onClick={()=>{previewSerial.current++;setPreview(null);setDimensions(rows=>rows.filter((_,j)=>j!==i));}}>移除规格维度</Button></div>)}
      <Button disabled={dimensions.length>=3||mode==='APPEND'} onClick={()=>{previewSerial.current++;setPreview(null);setDimensions(rows=>[...rows,{clientKey:crypto.randomUUID(),name:rows.length===0?'颜色':rows.length===1?'尺码':'版型',values:[newValue()]}]);}}>增加规格维度</Button>
      <p aria-live="polite">当前编辑方案：{dimensions.length?dimensions.map(d=>d.values.length).join(' × ')+' = ':''}{count} 个SKU{dimensions.length===0?'（默认单SKU）':''}；已保存方案含 {p.skus.filter(s=>!s.retiredAt).length} 个当前SKU。</p>
      {overLimit?<Alert type="warning" title={`当前组合数为${count}，超过200个SKU上限`} description="请减少某个规格维度的值数量后再预览或保存。"/>:emptyDimension?<Alert type="warning" title="每个规格维度至少需要1个值，或移除该维度"/>:null}
      <Button disabled={overLimit||emptyDimension} onClick={()=>{const serial=++previewSerial.current;setPreviewError(null);void catalog.previewProductSkus({path:{id:p.id},body:{dimensions}}).then(({data})=>{if(previewSerial.current===serial)setPreview(data.count);}).catch(e=>{if(previewSerial.current===serial)setPreviewError(e instanceof ApiClientError?e:null);});}}>服务器预览组合</Button>
      {preview!==null?<Alert type="info" title={`预览通过：${preview}个组合，尚未保存`}/>:null}
      <label>方案修改原因<input name="reason" required maxLength={500}/></label><Button type="primary" htmlType="submit" disabled={overLimit||emptyDimension}>保存规格方案</Button>
    </fieldset></form>
  </section>;
}
