/** 文件作用：校验员工创建表单并组装不含确认密码的白名单请求。 */
import type { EmployeeCreateInput, EmployeePermissions } from '@shop/api-client';

export function canCreateEmployees(permissions: EmployeePermissions | null): boolean {
  return permissions?.effectivePermissions.includes('employee.create') ?? false;
}

export function employeeUsernameIssue(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z][a-z0-9_]{3,31}$/.test(value.trim().toLowerCase())
    ? null : '账号须为4～32位，以字母开头，仅含字母、数字和下划线';
}

function textIssue(value: unknown, label: string, maximum: number): string | null {
  if (typeof value !== 'string' || !value.trim()) return `请填写${label}`;
  return Array.from(value.trim()).length > maximum ? `${label}最多${maximum}个字符` : null;
}
export const employeeDisplayNameIssue = (value: unknown) => textIssue(value, '显示名', 40);
export const employeeReasonIssue = (value: unknown) => textIssue(value, '创建原因', 500);
export const employeeRoleIssue = (value: unknown) => ['SUPER_ADMIN', 'MERCH_WAREHOUSE', 'CUSTOMER_SERVICE'].includes(value as string) ? null : '请选择有效岗位';

/** 只规范化普通文本；初始密码必须保留原文，且不转发确认字段。 */
export function employeeCreateInput(input: EmployeeCreateInput): EmployeeCreateInput {
  return { username: input.username.trim().toLowerCase(), displayName: input.displayName.trim(), role: input.role,
    initialPassword: input.initialPassword, reason: input.reason.trim() };
}
