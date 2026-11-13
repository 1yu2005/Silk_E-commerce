/** 文件作用：展示上传/私有图片的安全错误与请求编号，不输出Axios请求或凭据。 */
import { ApiClientError } from '@shop/api-client';
export function FileError({ error }: { error: unknown }) {
  if (!error) return null;
  const failure = error instanceof ApiClientError ? error : null;
  return <div role="alert" className="file-error"><p>{failure?.message ?? '图片操作失败，请稍后重试'}</p>
    {failure?.retryAfterSeconds ? <p>请在 {failure.retryAfterSeconds} 秒后重试。</p> : null}
    {failure?.requestId ? <p className="file-request-id">请求编号：{failure.requestId}</p> : null}</div>;
}
