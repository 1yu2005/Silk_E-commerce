/** 这里只定义公开的 HTTP 接口契约，不导出数据库实体或敏感信息。 */
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
