/** 文件作用：按版本倒序分页展示设置变更时间、原因和真实操作者ID。 */
import { useMemo } from 'react';
import { Pagination } from 'antd';
import { Link, useSearchParams } from 'react-router-dom';
import { useEmployeeQuery as useSettingsQuery } from '../employees/use-employee-query';
import { settingsQueries } from '../services/api';
import { SettingsQueryState } from '../settings/SettingsQueryState';
import { beijingTime } from '../settings/model';

export function SettingsHistoryPage() {
  const [search, setSearch] = useSearchParams(); const rawPage = search.get('page') ?? '1';
  const page = /^\d+$/.test(rawPage) && Number.isSafeInteger(Number(rawPage)) && Number(rawPage) >= 1 && Number(rawPage) <= 2_147_483_647 ? Number(rawPage) : 1;
  const query = useMemo(() => ({ page, pageSize: 10 }), [page]); const key = String(page);
  const state = useSettingsQuery(settingsQueries.history, key, query);
  return <section className="settings-panel"><Link to="/settings">返回全店设置</Link>
    <div className="settings-heading"><div><h1>设置版本历史</h1><p className="muted">每次有效修改保留一份完整记录。时间均为北京时间。</p></div></div>
    {state.status === 'ready' && state.data ? <>
      <p>共 {state.data.total} 个版本</p>
      {state.data.items.length ? <ol className="settings-history" aria-label="设置版本列表">{state.data.items.map(item => <li key={item.id}>
        <div className="settings-history-title"><Link to={`/settings/versions/${item.id}?page=${page}`}>版本 {item.versionNumber}</Link><time dateTime={item.createdAt}>{beijingTime(item.createdAt)}</time></div>
        <p>{item.reason}</p><span className="settings-hint">{item.createdByEmployeeId ? `操作员工 ID：${item.createdByEmployeeId}` : '系统初始化'}</span>
      </li>)}</ol> : <p role="status">{state.data.total === 0 ? '暂无设置版本，首次保存后将在这里保留历史。' : '本页暂无版本，请选择其他页码。'}</p>}
      {state.data.total > 10 ? <Pagination current={page} pageSize={10} total={state.data.total} showSizeChanger={false} onChange={next => setSearch({ page: String(next) })} /> : null}
      {page > 1 ? <p><Link to="/settings/versions">返回第一页</Link></p> : null}
    </> : <SettingsQueryState error={state.error} onRetry={() => void settingsQueries.history.read(key, query, true)} />}
  </section>;
}
