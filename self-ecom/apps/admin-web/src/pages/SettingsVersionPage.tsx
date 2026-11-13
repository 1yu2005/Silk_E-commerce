/** 文件作用：通过生成接口读取指定不可变历史版本，明确展示北京时间与修改原因。 */
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useEmployeeQuery as useSettingsQuery } from '../employees/use-employee-query';
import { settingsQueries } from '../services/api';
import { SettingsQueryState } from '../settings/SettingsQueryState';
import { SettingsSnapshot } from '../settings/SettingsSnapshot';
import { beijingTime } from '../settings/model';

export function SettingsVersionPage() {
  const { id = '' } = useParams(); const [search] = useSearchParams();
  const state = useSettingsQuery(settingsQueries.detail, id, id);
  return <section className="settings-panel"><Link to={`/settings/versions?${search}`}>返回版本历史</Link>
    {state.status === 'ready' && state.data ? <>
      <div className="settings-heading"><div><h1>设置版本 {state.data.versionNumber}</h1><p className="muted">历史记录，仅供查阅。</p></div><Link to="/settings">查看当前设置</Link></div>
      <div className="settings-version-meta"><p>保存时间：{beijingTime(state.data.createdAt)}（北京时间）</p>
        <p>{state.data.createdByEmployeeId ? `操作员工 ID：${state.data.createdByEmployeeId}` : '系统初始化'}</p><p>修改原因：{state.data.reason}</p></div>
      <SettingsSnapshot setting={state.data} />
    </> : <SettingsQueryState error={state.error} onRetry={() => void settingsQueries.detail.read(id, id, true)} />}
  </section>;
}
