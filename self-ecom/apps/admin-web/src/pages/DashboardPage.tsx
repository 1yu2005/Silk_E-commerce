import {useState} from 'react';
import {Button,Empty,Pagination,Segmented,Spin,Table,Tag} from 'antd';
import {Link} from 'react-router-dom';
import {useEmployeeAuth} from '../auth/use-employee-auth';
import {AuthError} from '../auth/AuthError';
import {useEmployeeQuery} from '../employees/use-employee-query';
import {reportingQueries as queries} from '../reporting/data';
import {decimal,money,reportDate,trendCoordinates,type HotProducts,type LowStock,type Trends} from '../reporting/model';

function Reading({error,retry}:{error:Parameters<typeof AuthError>[0]['error'];retry:()=>void}){return <div className="report-reading"><AuthError error={error}/>{!error?<Spin aria-label="正在读取真实业务统计"/>:null}<Button onClick={retry}>重新读取</Button></div>;}
function Stamp({asOf}:{asOf:string}){return <p className="report-stamp">北京时间 · 截至 {reportDate(asOf)}</p>;}
export function DashboardPage(){
 const [days,setDays]=useState<7|30>(7),[page,setPage]=useState(1);const {permissions}=useEmployeeAuth();
 const can=(p:string)=>permissions?.effectivePermissions.includes(p)??false;
 const overview=useEmployeeQuery(queries.overview,'overview',undefined),trends=useEmployeeQuery(queries.trends,String(days),days),hot=useEmployeeQuery(queries.hot,'hot',undefined),stock=useEmployeeQuery(queries.stock,String(page),page);
 const refresh=()=>{void queries.overview.read('overview',undefined,true);void queries.trends.read(String(days),days,true);void queries.hot.read('hot',undefined,true);void queries.stock.read(String(page),page,true);};
 return <section className="employee-panel report-page"><header className="report-heading"><div><span className="eyebrow">OPERATIONS / 经营</span><h1>经营看板</h1><p>从成功支付、成功退款与当前业务事实中，查看店铺的每日变化。</p></div><Button onClick={refresh}>刷新看板</Button></header>
 <section aria-labelledby="today-title"><h2 id="today-title">今日事件 <small>北京时间 00:00 起</small></h2>{overview.data?<><div className="report-metrics">{[
 ['新建订单',decimal(overview.data.today.createdOrderCount),'单'],['新顾客',decimal(overview.data.today.newCustomerCount),'人'],['成功支付',money(overview.data.today.paidAmountCents),''],['成功退款',money(overview.data.today.refundAmountCents),''],['净收款',money(overview.data.today.netReceiptsCents),'支付减退款'],
 ].map(([label,value,unit])=><article className="report-metric" key={label}><h3>{label}</h3><strong className={label==='净收款'&&overview.data!.today.netReceiptsCents.startsWith('-')?'report-negative':''}>{value}</strong><span>{unit}</span></article>)}</div><Stamp asOf={overview.data.asOf}/><p className="muted">退款按成功日期统计，可能来自过去支付的订单。净收款可为负值；线下金额不计入系统交易。</p></>:<Reading error={overview.error} retry={()=>void queries.overview.read('overview',undefined,true)}/>}</section>
 <section aria-labelledby="current-title"><h2 id="current-title">当前业务</h2><p className="muted">以下卡片可能重叠，不可相加作为订单总数。</p>{overview.data?<div className="report-metrics report-current">{[
 ['待发货订单',overview.data.current.waitingShipmentOrderCount,can('order.service.read')||can('order.fulfillment.read')?'/orders?status=WAIT_SHIPMENT':undefined],
 ['售后履约暂停',overview.data.current.afterSalePausedOrderCount,can('after-sale.service.read')||can('after-sale.inspection.read')?'/after-sales':undefined],
 ['待审售后',overview.data.current.pendingReviewAfterSaleCount,can('after-sale.service.read')?'/after-sales?status=PENDING_REVIEW':undefined],
 ['失败退款',overview.data.current.failedRefundCount,can('after-sale.service.read')?'/after-sales':undefined],
 ['低库存 SKU',overview.data.current.lowStockSkuCount,can('inventory.read')?'/inventory?lowStock=true':undefined],
 ].map(([label,value,link])=><article className="report-metric" key={label}><h3>{label}</h3><strong>{decimal(value!)}</strong>{link?<Link to={link}>查看业务 →</Link>:null}</article>)}</div>:null}</section>
 <section className="report-section" aria-labelledby="trend-title"><div className="report-section-heading"><div><h2 id="trend-title">每日收款趋势</h2><p className="muted">金额单位为元，今日数据截至各面板读取时点。</p></div><Segmented aria-label="趋势天数" value={days} options={[{label:'近7天',value:7},{label:'近30天',value:30}]} onChange={v=>setDays(v as 7|30)}/></div>{trends.data?<><TrendChart data={trends.data}/><Stamp asOf={trends.data.asOf}/></>:<Reading error={trends.error} retry={()=>void queries.trends.read(String(days),days,true)}/>}</section>
 <section className="report-section"><h2>近30天支付件数</h2><p className="muted">按款式 SPU 合并，退款不追溯扣减。下架和归档商品仍保留历史支付件数。</p>{hot.data?<><Table<HotProducts['items'][number]> rowKey="productId" pagination={false} dataSource={hot.data.items} columns={[
 {title:'款式',render:(_,r)=><>{can('product.read')?<Link to={'/products/'+r.productId}>{r.name}</Link>:r.name}<small className="report-code">{r.productCode}</small></>},
 {title:'当前状态',render:(_,r)=><>{r.archived?<Tag>已归档</Tag>:<Tag>{r.status==='ON_SALE'?'在售':'下架'}</Tag>}</>},{title:'支付件数',render:(_,r)=>decimal(r.paidQuantity)},
 ]}/><Stamp asOf={hot.data.asOf}/></>:<Reading error={hot.error} retry={()=>void queries.hot.read('hot',undefined,true)}/>}</section>
 <section className="report-section"><h2>库存预警</h2><p className="muted">可售库存 A ≤ 预警值；A 不代表实物总量。包含停用、下架及归档的保留账户。</p>{stock.data?<><div className="report-table"><Table<LowStock['items'][number]> rowKey="skuId" pagination={false} dataSource={stock.data.items} columns={[
 {title:'款式 / SKU',render:(_,r)=><>{can('inventory.read')?<Link to={'/inventory/skus/'+r.skuId}>{r.productName}</Link>:r.productName}<small className="report-code">{r.skuCode}</small></>},
 {title:'可售 A',dataIndex:'available'},{title:'预警值',dataIndex:'warningThreshold'},
 {title:'账户状态',render:(_,r)=><>{!r.skuEnabled?<Tag>SKU停用</Tag>:null}{r.skuRetired?<Tag>SKU退休</Tag>:null}{r.productArchived?<Tag>商品归档</Tag>:r.productStatus!=='ON_SALE'?<Tag>商品下架</Tag>:null}{r.skuEnabled&&!r.skuRetired&&!r.productArchived&&r.productStatus==='ON_SALE'?<Tag color="green">在售</Tag>:null}</>},
 ]}/></div><Pagination current={page} pageSize={10} total={stock.data.total} showSizeChanger={false} onChange={setPage}/><Stamp asOf={stock.data.asOf}/></>:<Reading error={stock.error} retry={()=>void queries.stock.read(String(page),page,true)}/>}</section>
 </section>;
}
function TrendChart({data}:{data:Trends}){const c=trendCoordinates(data.items);return <>{data.items.length?<><div className="report-chart-legend"><span>● 支付</span><span>● 退款</span><span>● 净收款</span></div><svg className="report-chart" viewBox="0 0 720 240" role="img" aria-label={`近${data.days}天支付、退款及净收款趋势；精确金额见下方数据表`}><line x1="40" x2="680" y1={c.zero} y2={c.zero} stroke="#bac9ce" strokeDasharray="4 4"/>{(['paidAmountCents','refundAmountCents','netReceiptsCents'] as const).map((key,i)=><polyline key={key} points={c.series(key)} fill="none" stroke={['#087e8b','#c56b37','#243746'][i]} strokeWidth="3"/>)}<text x="40" y="229">{data.firstDate}</text><text x="680" y="229" textAnchor="end">{data.lastDate}（截至当前）</text></svg><details><summary>查看每日精确数据</summary><div className="report-table"><table className="report-data-table"><thead><tr><th>北京日期</th><th>新订单</th><th>新顾客</th><th>支付</th><th>退款</th><th>净收款</th></tr></thead><tbody>{data.items.map(r=><tr key={r.date}><th scope="row">{r.date}</th><td>{decimal(r.createdOrderCount)}</td><td>{decimal(r.newCustomerCount)}</td><td>{money(r.paidAmountCents)}</td><td>{money(r.refundAmountCents)}</td><td>{money(r.netReceiptsCents)}</td></tr>)}</tbody></table></div></details></>:<Empty description="暂无趋势数据"/>}</>;}
