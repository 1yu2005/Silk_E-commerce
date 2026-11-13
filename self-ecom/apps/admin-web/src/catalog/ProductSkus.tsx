// 作用：SKU编码、整数分价格和启停共享商品版本；页面没有余额编辑入口。
import { useState } from 'react';
import { Button, Tag } from 'antd';
import { ApiClientError } from '@shop/api-client';
import { catalog } from '../services/api';
import { centsToYuan,yuanToCents,type Product } from './model';
import { CatalogFeedback } from './CatalogFeedback';
import { useCatalogCommand } from './use-catalog-command';
function money(value:string,cost=false){if(value==='')return null;const cents=yuanToCents(value,1000000);if(cents===null||(!cost&&cents<1))throw new ApiClientError('INVALID_MONEY','金额须在范围内且最多两位小数');return cents;}
export function ProductSkus({product:p,manage,publish,onSaved,reload}:{product:Product;manage:boolean;publish:boolean;onSaved:()=>void;reload:()=>void}){
  const cmd=useCatalogCommand(onSaved);const active=p.skus.filter(s=>!s.retiredAt);const [selected,setSelected]=useState(active.map(s=>s.id));const cost=active.some(s=>Object.hasOwn(s,'costCents'));
  return <section id="skus" className="catalog-card"><h2>SKU与价格</h2><p>价格以元填写，保存为整数分。单条留空表示清空；批量留空表示保持。可售 A 来自真实库存，R为占用。</p><CatalogFeedback {...cmd} reload={reload}/>
    {manage?<form className="catalog-batch" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void cmd.run(()=>catalog.batchFillProductSkus({path:{id:p.id},body:{expectedVersion:p.version,skuIds:selected,...(f.get('price')?{priceCents:money(String(f.get('price')))}:{}),...(cost&&f.get('cost')?{costCents:money(String(f.get('cost')),true)}:{})}}));}}><label>批量售价（元）<input name="price" type="number" min="0.01" max="10000" step="0.01"/></label>{cost?<label>批量成本（元）<input name="cost" type="number" min="0" max="10000" step="0.01"/></label>:null}<Button htmlType="submit" disabled={!selected.length||cmd.busy||cmd.blocked}>填入所选{selected.length}个SKU</Button></form>:null}
    <div className="sku-scroll"><table className="sku-table"><thead><tr>{manage?<th>选择</th>:null}<th>款式 / 编码</th><th>售价（元）{cost?' / 成本（元）':''}</th><th>可售 A / 占用 R</th><th>操作</th></tr></thead><tbody>{p.skus.map(s=><tr key={s.id} className={s.retiredAt?'retired-sku':''}>
      {manage?<td><input type="checkbox" aria-label={'选择SKU '+s.code} checked={selected.includes(s.id)} disabled={!!s.retiredAt} onChange={e=>setSelected(rows=>e.target.checked?[...rows,s.id]:rows.filter(id=>id!==s.id))}/></td>:null}
      <td><strong>{s.choices.map(c=>c.value).join(' / ')||'默认款式'}</strong><small>{s.code}</small><Tag>{s.retiredAt?'历史方案':s.enabled?'启用':'停用'}</Tag></td>
      <td><form className="sku-row-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void cmd.run(()=>catalog.updateProductSku({path:{id:p.id,skuId:s.id},body:{expectedVersion:p.version,code:String(f.get('code')),priceCents:money(String(f.get('price'))),...(cost?{costCents:money(String(f.get('cost')),true)}:{})}}));}}><fieldset disabled={!manage||!!s.retiredAt||cmd.busy||cmd.blocked}>
        <label>SKU编码<input name="code" defaultValue={s.code} required maxLength={64} pattern="[A-Za-z0-9_-]+"/></label><label>售价<input name="price" type="number" min="0.01" max="10000" step="0.01" defaultValue={s.priceCents===null?'':centsToYuan(s.priceCents)}/></label>
        {cost?<label>成本<input name="cost" type="number" min="0" max="10000" step="0.01" defaultValue={s.costCents==null?'':centsToYuan(s.costCents)}/></label>:null}{manage&&!s.retiredAt?<Button htmlType="submit">保存此SKU</Button>:null}</fieldset></form></td>
      <td>{s.available} / {s.reserved??'—'}<small>{s.purchaseBlocked?'暂停新购':s.available===0?'缺货':'有可售数量'}</small></td>
      <td>{publish&&!s.retiredAt?<form onSubmit={e=>{e.preventDefault();const reason=String(new FormData(e.currentTarget).get('reason'));void cmd.run(()=>catalog.setProductSkuEnabled({path:{id:p.id,skuId:s.id},body:{expectedVersion:p.version,reason,enabled:!s.enabled}}));}}><label>启停原因<input name="reason" required maxLength={500} disabled={cmd.busy||cmd.blocked}/></label><Button htmlType="submit" disabled={cmd.busy||cmd.blocked}>{s.enabled?'停用':'启用'}</Button></form>:<span>{s.retiredAt?'保留历史':'只读'}</span>}</td>
    </tr>)}</tbody></table></div>
  </section>;
}
