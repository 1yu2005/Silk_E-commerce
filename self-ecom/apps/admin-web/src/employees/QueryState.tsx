/** 文件作用：统一展示员工查询加载、失败及手动重试入口。 */
import { Button, Spin } from 'antd';
import type { ApiClientError } from '@shop/api-client';
import { AuthError } from '../auth/AuthError';

export function QueryState({ error, onRetry }: { error: ApiClientError | null; onRetry: () => void }) {
  if (!error) return <div className="auth-status" role="status"><Spin /><p>正在读取员工信息…</p></div>;
  return <div className="employee-error"><h2>{error.status === 404 ? '员工不存在' : error.status === 403 ? '当前无法查看员工信息' : '员工信息读取失败'}</h2>
    <AuthError error={error} /><Button className="auth-actions" onClick={onRetry}>重新读取</Button></div>;
}
