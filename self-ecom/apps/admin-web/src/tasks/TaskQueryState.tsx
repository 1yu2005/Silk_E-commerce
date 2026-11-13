/** 文件作用：分别展示任务加载和真实读取失败，失败不伪装成无任务。 */
import { Button, Spin } from 'antd';
import type { ApiClientError } from '@shop/api-client';
import { AuthError } from '../auth/AuthError';
export function TaskQueryState({ error, retry }: { error: ApiClientError | null; retry: () => void }) {
  return error ? <div className="task-message"><AuthError error={error} /><Button onClick={retry}>重新读取任务</Button></div>
    : <div className="auth-status" role="status"><Spin /><p>正在读取任务…</p></div>;
}

