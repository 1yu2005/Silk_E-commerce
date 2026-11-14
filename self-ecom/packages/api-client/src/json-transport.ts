/** 文件作用：供生成调用器复用原Axios认证传输，只接收契约参数，禁止覆盖baseURL、认证头或方法。 */
import type { AxiosInstance } from 'axios';
import { ApiClientError } from './api-error.js';
interface Descriptor { method: string; path: string; pathParameters: { name: string; format?: string }[]; queryKeys: string[]; headerKeys?:string[] }
interface Input { path?: object; query?: object; body?: unknown; signal?: AbortSignal;headers?:object }
export async function requestJson<T>(api: AxiosInstance, descriptor: Descriptor, input: Input): Promise<T> {
  let url = descriptor.path;
  const params = input.path as Record<string, unknown> | undefined;
  for (const parameter of descriptor.pathParameters) {
    const value = params?.[parameter.name];
    if (typeof value !== 'string' || !value || /[\\/?#%]/.test(value)
      || parameter.format === 'uuid' && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) {
      throw new ApiClientError('CLIENT_REQUEST_TARGET_INVALID', '请求路径参数不合法');
    }
    url = url.replace(`{${parameter.name}}`, encodeURIComponent(parameter.format === 'uuid' ? value.toLowerCase() : value));
  }
  const query = input.query as Record<string, unknown> | undefined;
  const headers:Record<string,string>={};const supplied=input.headers as Record<string,unknown>|undefined;
  for(const key of descriptor.headerKeys??[]){if(key.toLowerCase()!=='idempotency-key'||typeof supplied?.[key]!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(supplied[key] as string))throw new ApiClientError('IDEMPOTENCY_KEY_INVALID','购买确认键不合法');headers[key]=supplied[key] as string;}
  const response = await api.request<T>({ method: descriptor.method, url, data: input.body, signal: input.signal,headers,
    params: query ? Object.fromEntries(descriptor.queryKeys.filter(key => query[key] !== undefined).map(key => [key, query[key]])) : undefined });
  return response.data;
}
