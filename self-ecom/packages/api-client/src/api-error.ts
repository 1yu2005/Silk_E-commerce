/** 文件作用：把传输异常转换为不含密码或令牌的安全错误对象。 */
import axios from 'axios';

export interface FieldIssue { field: string; message: string }
/** 不携带Axios config/cause，防止页面展示或记录错误时带出密码与Authorization。 */
export class ApiClientError extends Error {
  constructor(readonly code: string, message: string, readonly status?: number, readonly requestId?: string,
    readonly details?: FieldIssue[], readonly retryAfterSeconds?: number) {
    super(message); this.name = 'ApiClientError';
  }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function toApiClientError(error: unknown): ApiClientError {
  if (error instanceof ApiClientError) return error;
  if (!axios.isAxiosError(error)) return new ApiClientError('REQUEST_FAILED', '请求失败，请稍后重试');
  if (!error.response) {
    if (axios.isCancel(error)) return new ApiClientError('REQUEST_CANCELED', '请求已取消');
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') return new ApiClientError('REQUEST_TIMEOUT', '请求超时，请稍后重试');
    return new ApiClientError('NETWORK_ERROR', '网络连接失败，请稍后重试');
  }
  const { status, headers } = error.response;
  const body: unknown = error.response.data;
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const valid = typeof record.code === 'string' && /^[A-Z][A-Z0-9_]{0,99}$/.test(record.code)
    && typeof record.message === 'string' && typeof record.requestId === 'string' && uuid.test(record.requestId);
  const details = valid && Array.isArray(record.details) ? record.details.filter((item: unknown): item is FieldIssue => {
    if (!item || typeof item !== 'object') return false;
    const issue = item as Record<string, unknown>; return typeof issue.field === 'string' && typeof issue.message === 'string';
  }).map(item => ({ field: item.field, message: item.message })) : undefined;
  const retry = Number(headers['retry-after']);
  return new ApiClientError(valid ? record.code as string : 'HTTP_ERROR', valid ? record.message as string : '服务暂时不可用，请稍后重试',
    status, valid ? record.requestId as string : undefined, details,
    Number.isSafeInteger(retry) && retry > 0 ? retry : undefined);
}
