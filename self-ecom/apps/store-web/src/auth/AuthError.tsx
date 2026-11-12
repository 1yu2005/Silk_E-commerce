/** 文件作用：展示安全的接口错误、字段提示、限流等待和请求编号。 */
import { Alert } from 'antd';
import { ApiClientError } from '@shop/api-client';

export function AuthError({ error }: { error: unknown }) {
  if (!error) return null;
  const failure = error instanceof ApiClientError ? error : null;
  return <Alert type="error" showIcon title={failure?.message ?? '请求失败，请稍后重试'} description={<>
    {failure?.retryAfterSeconds ? <p>请在 {failure.retryAfterSeconds} 秒后重试。</p> : null}
    {failure?.details?.length ? <ul>{failure.details.map((issue, index) => <li key={index}>{issue.field}：{issue.message}</li>)}</ul> : null}
    {failure?.requestId ? <p className="request-id">请求编号：{failure.requestId}</p> : null}
  </>} />;
}
