/** 文件作用：汇总公开 HTTP 响应、分页和业务契约，禁止导出数据库实体。 */
export interface ApiResponse<T> {
  data: T;
  requestId: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
  requestId: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export { PASSWORD_POLICY, validatePassword, validatePasswordChange, type PasswordIssue } from './password.js';
export type * from './auth.js';
export type * from './employees.js';
export type * from './files.js';
export { PAGINATION, normalizePagination, paginationWindow, type PaginationInput } from './pagination.js';
export { canonicalJson, canonicalSet, validateIdempotencyKey, ContractError, type ContractErrorCode } from './command-contract.js';
