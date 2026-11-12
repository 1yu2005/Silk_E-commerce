// 作用：定义强制改密与权限不足的业务错误，供统一 HTTP 错误映射使用。
export class AccessDeniedError extends Error {
  constructor(public readonly code: 'PASSWORD_CHANGE_REQUIRED' | 'FORBIDDEN') {
    super(code === 'PASSWORD_CHANGE_REQUIRED' ? '请先修改初始密码' : '无权执行此操作');
    this.name = 'AccessDeniedError';
  }
}
