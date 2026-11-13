/** 文件作用：复用统一错误外壳展示设置查询的加载、失败与手动重试。 */
import { Button, Spin } from 'antd';
import type { ApiClientError } from '@shop/api-client';
import { AuthError } from '../auth/AuthError';

export function SettingsQueryState({ error, onRetry }: { error: ApiClientError | null; onRetry: () => void }) {
  if (!error) return <div className="auth-status" role="status"><Spin /><p>正在读取设置…</p></div>;
  return <div className="settings-message"><AuthError error={error} /><Button onClick={onRetry}>重新读取</Button></div>;
}
