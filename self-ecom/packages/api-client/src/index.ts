/** 文件作用：公开导出前端 API 工具、认证客户端及共享接口契约。 */
import axios from 'axios';

/** 提供不附带认证信息的基础传输实例。 */
export function createApiClient(baseURL = '/api/v1') {
  return axios.create({ baseURL, timeout: 10_000 });
}

export type * from '@shop/shared';
export { validatePassword, validatePasswordChange, PASSWORD_POLICY } from '@shop/shared';
export { AuthSessionStore, SESSION_KEYS, type SessionOptions, type SessionSnapshot, type SessionStorageAccess } from './session.js';
export { ApiClientError, type FieldIssue } from './api-error.js';
export { createEmployeeClient, createCustomerClient, type AuthClientOptions } from './auth-client.js';
export { createGeneratedClient } from './generated/client.js';
export type { paths as ApiPaths, operations as ApiOperations } from './generated/schema.js';
