/** 文件作用：读取当前配置并展示版本，保存或冲突刷新后重新核对完整表单。 */
import { useState } from 'react';
import { Alert } from 'antd';
import { Link } from 'react-router-dom';
import { useEmployeeQuery as useSettingsQuery } from '../employees/use-employee-query';
import { settingsQueries } from '../services/api';
import { SettingsForm } from '../settings/SettingsForm';
import { SettingsQueryState } from '../settings/SettingsQueryState';
import { beijingTime } from '../settings/model';

export function StoreSettingsPage() {
  const current = useSettingsQuery(settingsQueries.current, 'current', undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const saved = (changed: boolean, version: number) => {
    setNotice(changed ? `全店设置已保存，当前版本 ${version}。` : `配置内容未变化，仍为版本 ${version}，未新增历史。`);
    void settingsQueries.current.invalidate(); void settingsQueries.history.invalidate();
  };
  const reload = () => { setNotice('已要求读取最新设置。读取成功后，请重新核对并填写修改原因再保存。'); void settingsQueries.current.invalidate(); };
  return <section className="settings-panel">
    <div className="settings-heading"><div><h1>全店设置</h1><p className="muted">统一维护运费、退货地址、服务联系和处理期限。</p></div><Link to="/settings/versions">查看版本历史</Link></div>
    {notice ? <Alert className="auth-notice" type="info" showIcon title={notice} /> : null}
    {current.status === 'ready' && current.data ? <>
      <div className="settings-version-bar"><strong>当前版本 {current.data.version}</strong>
        <span>{current.data.currentSetting ? `保存于 ${beijingTime(current.data.currentSetting.createdAt)}（北京时间）` : '未配置'}</span></div>
      <SettingsForm key={current.data.version} current={current.data} onSaved={saved} onReload={reload} />
    </> : <SettingsQueryState error={current.error} onRetry={() => void settingsQueries.current.read('current', undefined, true)} />}
  </section>;
}
