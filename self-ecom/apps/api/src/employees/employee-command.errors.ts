// 作用：定义员工管理业务错误及固定 HTTP 错误码映射，避免暴露数据库异常。
export class EmployeeUsernameExistsError extends Error {
  constructor() { super('员工账号已存在'); this.name = 'EmployeeUsernameExistsError'; }
}
export class EmployeeNotFoundError extends Error {
  constructor() { super('员工不存在'); this.name = 'EmployeeNotFoundError'; }
}
export class EmployeeVersionConflictError extends Error {
  constructor() { super('员工资料已更新，请刷新后重试'); this.name = 'EmployeeVersionConflictError'; }
}
export class EmployeeLastAdminRequiredError extends Error {
  constructor() { super('必须保留至少一名可用超级管理员'); this.name = 'EmployeeLastAdminRequiredError'; }
}
export class EmployeeSelfPasswordResetError extends Error {
  constructor() { super('本人请使用修改密码功能'); this.name = 'EmployeeSelfPasswordResetError'; }
}

/** 只识别明确内部错误类，固定文案不回显目标、版本或数据库异常。 */
export function employeeCommandHttpError(error: unknown) {
  if (error instanceof EmployeeUsernameExistsError) return { status: 409, code: 'USERNAME_EXISTS', message: '员工账号已存在' };
  if (error instanceof EmployeeNotFoundError) return { status: 404, code: 'EMPLOYEE_NOT_FOUND', message: '员工不存在' };
  if (error instanceof EmployeeVersionConflictError) return { status: 409, code: 'VERSION_CONFLICT', message: '员工资料已更新，请刷新后重试' };
  if (error instanceof EmployeeLastAdminRequiredError) return { status: 409, code: 'LAST_ADMIN_REQUIRED', message: '必须保留至少一名可用超级管理员' };
  if (error instanceof EmployeeSelfPasswordResetError) return { status: 400, code: 'SELF_PASSWORD_RESET_NOT_ALLOWED', message: '本人请使用修改密码功能' };
  return undefined;
}
