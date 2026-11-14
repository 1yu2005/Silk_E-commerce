// 作用：只返回固定查询错误，不将筛选值、SQL或历史载荷放入错误信息。
export class AuditQueryError extends Error {
  readonly status: number;
  constructor(readonly code: 'QUERY_RANGE_TOO_LARGE' | 'AUDIT_LOG_NOT_FOUND' | 'VALIDATION_FAILED') {
    super(code === 'QUERY_RANGE_TOO_LARGE' ? '查询范围过大，请缩短日期或减少定位条数'
      : code === 'AUDIT_LOG_NOT_FOUND' ? '审计记录不存在' : '审计筛选参数不合法');
    this.name = 'AuditQueryError';
    this.status = code === 'AUDIT_LOG_NOT_FOUND' ? 404 : 400;
  }
}
