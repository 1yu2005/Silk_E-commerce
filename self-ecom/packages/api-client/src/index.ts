import axios from 'axios';

/** 请求传输基础；响应和错误处理将随接口契约补充。 */
export function createApiClient(baseURL = '/api/v1') {
  return axios.create({ baseURL, timeout: 10_000 });
}

export type { ApiResponse, ApiError, Page } from '@shop/shared';
