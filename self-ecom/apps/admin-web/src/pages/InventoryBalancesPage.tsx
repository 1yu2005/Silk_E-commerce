// 作用：库存默认按整款浏览，查询时平铺匹配规格；分组与统计均使用服务端分页结果。
import { useState } from 'react';
import { Alert, Button, Tag } from 'antd';
import { Link, useSearchParams } from 'react-router-dom';
import { catalogQueries, inventoryQueries } from '../services/api';
import { useEmployeeQuery } from '../employees/use-employee-query';
import { InventoryNav, InventoryPager, InventoryState } from '../inventory/InventoryCommon';
import type { Balances, BalanceQuery } from '../inventory/model';
import type { Category } from '../catalog/model';
import { CategorySelect } from '../catalog/CategorySelect';
import { parseListLink } from '../routing/list-link';
import '../inventory/inventory-balances.css';

type Row = Balances['items'][number];
const pageSize = 20;

export function InventoryListPage() {
  const [params, setParams] = useSearchParams(), search = params.toString();
  const parsed = parseListLink(search, { lowStock: ['true', 'false'] });
  if (!parsed.filters) return <section className="catalog-panel"><h1>库存余额与预警</h1><Alert type="error" title={parsed.issue}/><Button onClick={() => setParams(new URLSearchParams())}>重置筛选</Button></section>;
  const lowStock = parsed.filters.lowStock as BalanceQuery['lowStock'];
  return <InventoryBalances key={search} initial={{ page: 1, pageSize, lowStock, groupBy: lowStock ? 'sku' : 'product' }} clearLink={() => { if (search) setParams(new URLSearchParams()); }}/>;
}

function InventoryBalances({ initial, clearLink }: { initial: BalanceQuery; clearLink: () => void }) {
  const [q, setQ] = useState(initial);
  const [draft, setDraft] = useState({ keyword: '', categoryId: '', lowStock: initial.lowStock ?? '', purchaseBlocked: '' });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const query = useEmployeeQuery(inventoryQueries.balances, JSON.stringify(q), q);
  // inventory.read依赖product.read和category.read，无需扩大分类接口的授权范围。
  const categories = useEmployeeQuery(catalogQueries.categories, 'categories', undefined);
  const reload = () => void inventoryQueries.balances.invalidate();
  const data = query.status === 'ready' ? query.data : null;
  const grouped = data?.groupBy === 'product';
  const groups = new Map<string, Row[]>();
  for (const row of data?.items ?? []) {
    const rows = groups.get(row.productId);
    if (rows) rows.push(row); else groups.set(row.productId, [row]);
  }
  const reset = () => {
    setDraft({ keyword: '', categoryId: '', lowStock: '', purchaseBlocked: '' });
    setQ({ page: 1, pageSize, groupBy: 'product' });
    setCollapsed(new Set());
    clearLink();
  };
  return <section className="catalog-panel inventory-balances">
    <div className="inventory-page-heading"><div><h1>库存余额与预警</h1><p>同款集中查看，按颜色与尺码核对库存。</p></div><Button onClick={reload}>刷新库存</Button></div>
    <InventoryNav/>
    <form className="inventory-balance-filters" onSubmit={e => {
      e.preventDefault();
      const keyword = draft.keyword.trim();
      const filtered = Boolean(keyword || draft.categoryId || draft.lowStock || draft.purchaseBlocked);
      setQ({ page: 1, pageSize, groupBy: filtered ? 'sku' : 'product', keyword: keyword || undefined, categoryId: draft.categoryId || undefined, lowStock: (draft.lowStock || undefined) as BalanceQuery['lowStock'], purchaseBlocked: (draft.purchaseBlocked || undefined) as BalanceQuery['purchaseBlocked'] });
      setCollapsed(new Set());
    }}>
      <label>商品 / SKU<input name="keyword" maxLength={120} placeholder="搜索商品名称或 SKU 编码" value={draft.keyword} onChange={e => setDraft({ ...draft, keyword: e.target.value })}/></label>
      <label>商品分类<CategorySelect categories={(categories.data??[]) as Category[]} value={draft.categoryId} disabled={categories.status!=='ready'} onChange={categoryId=>setDraft({...draft,categoryId})} placeholder={categories.status==='ready'?'全部分类（含未分类）':'正在读取分类…'}/></label>
      <label>库存预警<select name="lowStock" value={draft.lowStock} onChange={e => setDraft({ ...draft, lowStock: e.target.value })}><option value="">全部库存</option><option value="true">低库存（A ≤ 预警线）</option><option value="false">高于预警线</option></select></label>
      <label>新购状态<select name="purchaseBlocked" value={draft.purchaseBlocked} onChange={e => setDraft({ ...draft, purchaseBlocked: e.target.value })}><option value="">全部状态</option><option value="true">暂停新购</option><option value="false">未暂停</option></select></label>
      <div className="inventory-filter-actions"><Button type="primary" htmlType="submit">查询</Button><Button onClick={reset}>清除筛选</Button></div>
      <p>选择父分类会包含其下级分类；查询后直接列出匹配的规格。</p>
    </form>
    {categories.error ? <Alert type="warning" title="分类读取失败，仍可按商品或库存状态查询" action={<Button onClick={() => void catalogQueries.categories.invalidate()}>重试分类</Button>}/> : null}
    {data ? <>
      <div className="inventory-balance-summary" aria-label="当前筛选库存合计">
        <span><strong>{data.productTotal}</strong> 款商品 / <strong>{data.skuTotal}</strong> 个规格账户</span>
        <span>可用 A <strong>{data.availableTotal}</strong></span><span>待付款占用 R <strong>{data.reservedTotal}</strong></span>
      </div>
      <div className="inventory-results-heading"><div><h2>{grouped ? '按商品查看' : '筛选结果'}</h2><p>{grouped ? '商品按名称排序，规格按保存顺序排列；同名不同款分别展示。' : '仅显示匹配的规格，同一商品的结果相邻排列。'}</p></div>
        {grouped && data.total > 0 ? <div><Button size="small" onClick={() => setCollapsed(new Set())}>展开全部</Button><Button size="small" onClick={() => setCollapsed(new Set(groups.keys()))}>收起全部</Button></div> : null}
      </div>
      {!data.total ? <div className="inventory-empty"><h3>没有符合条件的库存账户</h3><p>可调整关键词、分类或库存状态后重新查询。</p><Button onClick={reset}>清除筛选</Button></div> : grouped ? <div className="inventory-product-groups">{[...groups].map(([id, rows]) => <InventoryProduct key={id} rows={rows} collapsed={collapsed.has(id)} toggle={() => setCollapsed(previous => {
        const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next;
      })}/>)}</div> : <InventoryBalanceTable rows={data.items} showProduct/>}
      <InventoryPager page={data.page} size={data.pageSize} total={data.total} unit={grouped ? '款商品' : '个规格账户'} onPage={page => { setQ({ ...q, page }); setCollapsed(new Set()); }}/>
      <p className="inventory-balance-footnote">A 可分给新订单，R 为待付款订单占用，均不含已付款备货。历史与停用规格保留账户及真实数量。</p>
    </> : <InventoryState error={query.error} reload={reload}/>}
  </section>;
}

function InventoryProduct({ rows, collapsed, toggle }: { rows: Row[]; collapsed: boolean; toggle: () => void }) {
  const product = rows[0]!;
  const available = rows.reduce((sum, row) => sum + BigInt(row.available), 0n).toString();
  const reserved = rows.reduce((sum, row) => sum + BigInt(row.reserved), 0n).toString();
  const tableId = 'inventory-product-' + product.productId;
  return <article className="inventory-product-group" aria-label={product.productName}>
    <header className="inventory-product-heading"><div className="inventory-product-identity"><h3><Link to={'/products/' + product.productId}>{product.productName}</Link></h3><p>{product.categoryPath.join(' / ') || '未分类'}</p><small>商品编号：{product.productCode}</small></div>
      <div className="inventory-product-totals"><span>{rows.length} 个规格账户</span><span>可用 <strong>{available}</strong></span><span>占用 <strong>{reserved}</strong></span></div>
      <Button size="small" aria-expanded={!collapsed} aria-controls={tableId} onClick={toggle}>{collapsed ? '展开规格' : '收起规格'}</Button>
    </header>
    <div id={tableId} hidden={collapsed}><InventoryBalanceTable rows={rows}/></div>
  </article>;
}

function InventoryBalanceTable({ rows, showProduct = false }: { rows: Row[]; showProduct?: boolean }) {
  return <div className="inventory-balance-table-wrap"><table className="inventory-balance-table"><caption className="inventory-sr-only">{showProduct ? '筛选后的商品规格库存' : rows[0]?.productName + '规格库存'}</caption>
    <colgroup><col className="inventory-spec-col"/><col/><col/><col/><col className="inventory-status-col"/><col className="inventory-action-col"/></colgroup>
    <thead><tr><th scope="col">{showProduct ? '商品与规格' : '颜色 / 尺码 / SKU'}</th><th scope="col">可用 A</th><th scope="col">占用 R</th><th scope="col">预警线</th><th scope="col">账户状态</th><th scope="col">操作</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.skuId} className={row.skuRetired ? 'inventory-retired-row' : undefined}>
      <td>{showProduct ? <Link className="inventory-row-product" to={'/products/' + row.productId}>{row.productName}</Link> : null}<span className="inventory-row-choices">{row.choices.join(' / ') || '默认规格'}</span><small>SKU：{row.code}</small></td>
      <td className={row.lowStock ? 'inventory-low-quantity' : undefined}><strong>{row.available}</strong></td><td>{row.reserved}</td><td>{row.warningThreshold}</td>
      <td><div className="inventory-account-tags">{row.skuRetired ? <Tag>历史规格</Tag> : !row.skuEnabled ? <Tag>已停用</Tag> : null}{row.lowStock ? <Tag color="gold">低库存</Tag> : null}{row.purchaseBlocked ? <Tag color="red">暂停新购</Tag> : null}{row.skuEnabled && !row.lowStock && !row.purchaseBlocked ? <Tag color="green">正常</Tag> : null}</div></td>
      <td><Link to={'/inventory/skus/' + row.skuId}>账户详情</Link></td>
    </tr>)}</tbody>
  </table></div>;
}
