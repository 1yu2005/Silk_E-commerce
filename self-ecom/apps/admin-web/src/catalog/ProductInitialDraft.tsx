// 作用：只保存非记账数量，展示固定转换键和草稿状态；不提供尚未开发的入账按钮。
import { useState } from 'react';
import { Alert, Button } from 'antd';
import { catalog,catalogQueries } from '../services/api';
import { useEmployeeQuery } from '../employees/use-employee-query';
import type { Product,Draft } from './model';
import { CatalogQueryState } from './CatalogQueryState';
import { CatalogFeedback } from './CatalogFeedback';
import { useCatalogCommand } from './use-catalog-command';
export function ProductInitialDraft(props:{product:Product;onSaved:()=>void;reload:()=>void}){
  const query=useEmployeeQuery(catalogQueries.draft,props.product.id,props.product.id);
  return <section id="initial-draft" className="catalog-card"><h2>初始数量草稿</h2><Alert type="info" title="数量草稿，确认库存登记后才生效" description="本次保存不改变可售/占用数量，不创建入账任务。库存登记与转换将在板块6接入。"/>
    {query.status==='ready'?<DraftForm key={query.data?.id+':'+query.data?.version} {...props} draft={query.data}/>:<CatalogQueryState error={query.error} onRetry={()=>void catalogQueries.draft.invalidate()}/>}</section>;
}
function DraftForm({product:p,draft,onSaved,reload}:{product:Product;draft:Draft;onSaved:()=>void;reload:()=>void}){
  const active=p.skus.filter(s=>!s.retiredAt),[quantities,setQuantities]=useState<Record<string,string>>(()=>Object.fromEntries(active.map(s=>[s.id,String(draft?.lines.find(l=>l.skuId===s.id)?.quantity??0)])));
  const [bulk,setBulk]=useState('0');const cmd=useCatalogCommand(onSaved);const editable=!draft||draft.status==='EDITABLE'||draft.status==='VOID';
  return <><p>{draft?`草稿 ${draft.status} · 版本 ${draft.version} · 转换键 ${draft.conversionKey}`:'尚未保存数量草稿'}</p><CatalogFeedback {...cmd} reload={reload}/>
    <form className="catalog-form" onSubmit={e=>{e.preventDefault();void cmd.run(()=>catalog.saveInitialInventoryDraft({path:{id:p.id},body:{expectedProductVersion:p.version,expectedDraftVersion:draft?.status==='EDITABLE'?draft.version:null,lines:active.map(s=>({skuId:s.id,quantity:Number(quantities[s.id])}))}}));}}><fieldset disabled={!editable||cmd.busy||cmd.blocked}>
      <div className="catalog-batch"><label>批量草稿数量<input type="number" value={bulk} min="0" max="2147483647" step="1" onChange={e=>setBulk(e.target.value)}/></label><Button onClick={()=>{if(/^\d+$/.test(bulk)&&Number(bulk)<=2147483647)setQuantities(Object.fromEntries(active.map(s=>[s.id,bulk])));}}>填入全部款式</Button></div>
      <div className="catalog-grid">{active.map(s=><label key={s.id}>{s.choices.map(c=>c.value).join(' / ')||'默认款式'}（草稿数量）<input required type="number" min="0" max="2147483647" step="1" value={quantities[s.id]??'0'} onChange={e=>setQuantities(rows=>({...rows,[s.id]:e.target.value}))}/></label>)}</div><Button type="primary" htmlType="submit">保存数量草稿（不入账）</Button>
    </fieldset></form>
    {draft?.status==='EDITABLE'?<form className="catalog-batch" onSubmit={e=>{e.preventDefault();const reason=String(new FormData(e.currentTarget).get('reason'));void cmd.run(()=>catalog.voidInitialInventoryDraft({path:{id:p.id},body:{expectedProductVersion:p.version,expectedDraftVersion:draft.version,reason}}));}}><label>作废原因<input name="reason" required maxLength={500}/></label><Button htmlType="submit" disabled={cmd.busy||cmd.blocked}>作废此草稿</Button></form>:null}
  </>;
}
