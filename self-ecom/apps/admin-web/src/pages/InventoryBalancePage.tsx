// 作用：查看单SKU余额、各来源暂停与预警设置；没有直接覆盖A/R或万能解除按钮。
import { Button } from 'antd';
import { Link,useParams } from 'react-router-dom';
import { inventory,inventoryQueries } from '../services/api';
import { useEmployeeQuery } from '../employees/use-employee-query';
import { useEmployeeAuth } from '../auth/use-employee-auth';
import { useInventoryCommand } from '../inventory/use-inventory-command';
import { CatalogFeedback } from '../catalog/CatalogFeedback';
import { InventoryNav,InventoryState } from '../inventory/InventoryCommon';
import type { Balance } from '../inventory/model';
export function InventoryBalancePage(){const {id=''}=useParams(),q=useEmployeeQuery(inventoryQueries.balance,id,id),reload=()=>void inventoryQueries.balance.invalidate();return <section className="catalog-panel"><h1>SKU库存账户</h1><InventoryNav/>{q.status==='ready'&&q.data?<BalanceDetail key={id+':'+q.data.version} balance={q.data} reload={reload}/>:<InventoryState error={q.error} reload={reload}/>}</section>;}
function BalanceDetail({balance:b,reload}:{balance:Balance;reload:()=>void}){const {permissions}=useEmployeeAuth(),cmd=useInventoryCommand(reload);return <><h2>{b.productName} / {b.choices.join(' / ')||b.code}</h2><p>{b.code} · 版本 {b.version}</p><p>可分给新订单 A：<strong>{b.available}</strong>；待付款占用 R：<strong>{b.reserved}</strong></p><p>预警线 {b.warningThreshold}；{b.lowStock?'低库存':'高于预警线'}；{b.purchaseBlocked?'暂停新购':'未暂停新购'}</p><Link to={'/products/'+b.productId}>查看商品</Link><h2>有效暂停来源</h2>{b.blocks.length?<ul>{b.blocks.map(r=><li key={r.id}>{r.reasonCode} / {r.sourceType} / {r.sourceType==='ADJUSTMENT'?<Link to={'/inventory/adjustments/'+r.sourceId}>进入登记核实</Link>:r.sourceId}</li>)}</ul>:<p>无有效暂停。实际是否可售仍取决于商品状态和数量。</p>}
 {permissions?.effectivePermissions.includes('inventory.alert.manage')?<form className="catalog-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void cmd.run(()=>inventory.setInventoryWarningThreshold({path:{skuId:b.skuId},body:{expectedVersion:b.version,threshold:Number(f.get('threshold')),reason:String(f.get('reason'))}}));}}><CatalogFeedback {...cmd} reload={reload}/><fieldset disabled={cmd.busy||cmd.blocked}><label>预警线<input required type="number" min="0" max="2147483647" step="1" name="threshold" defaultValue={b.warningThreshold}/></label><label>调整原因<input required maxLength={500} name="reason"/></label><Button htmlType="submit">保存预警线（不改数量）</Button></fieldset></form>:null}</>;}
