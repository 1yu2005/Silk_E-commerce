/** 文件作用：校验员工列表地址参数，统一岗位、状态和日期展示。 */
import type { EmployeeListQuery, EmployeePermissions } from '@shop/api-client';

export const employeeRoles = { SUPER_ADMIN: '超级管理员', MERCH_WAREHOUSE: '商品与仓储', CUSTOMER_SERVICE: '客服' };
export const employeeStatuses = { ACTIVE: '启用', DISABLED: '停用' };
export type EmployeeSearch = EmployeeListQuery & { page: number; pageSize: number };

export function canReadEmployees(permissions: EmployeePermissions | null): boolean {
  return permissions?.effectivePermissions.includes('employee.read') ?? false;
}

export function employeeIdIssue(id: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? null : '员工编号格式无效';
}

/** 地址栏参数先校验，再生成API白名单查询；不把未知字段转发给服务器。 */
export function parseEmployeeSearch(search: string): { query: EmployeeSearch; error?: never } | { query?: never; error: string } {
  const params = new URLSearchParams(search);
  for (const key of params.keys()) if (!['page', 'pageSize', 'keyword', 'role', 'status'].includes(key) || params.getAll(key).length !== 1) return { error: '查询参数不受支持，请重置筛选' };
  const pageText = params.get('page') ?? '1'; const sizeText = params.get('pageSize') ?? '20';
  const page = Number(pageText); const pageSize = Number(sizeText);
  if (!/^[1-9][0-9]*$/.test(pageText) || !Number.isSafeInteger(page) || !/^[1-9][0-9]*$/.test(sizeText) || !Number.isSafeInteger(pageSize) || pageSize > 100) return { error: '页码须为正整数，每页须为1～100条' };
  const keyword = params.get('keyword')?.trim(); const role = params.get('role'); const status = params.get('status');
  if (keyword && Array.from(keyword).length > 50) return { error: '搜索关键词最多50个字符' };
  if (role && !Object.hasOwn(employeeRoles, role)) return { error: '岗位筛选无效，请重置筛选' };
  if (status && !Object.hasOwn(employeeStatuses, status)) return { error: '状态筛选无效，请重置筛选' };
  return { query: { page, pageSize, ...(keyword ? { keyword } : {}), ...(role ? { role: role as EmployeeSearch['role'] } : {}),
    ...(status ? { status: status as EmployeeSearch['status'] } : {}) } };
}

export function employeeSearchParams(query: EmployeeSearch): URLSearchParams {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
  if (query.keyword) params.set('keyword', query.keyword.trim());
  if (query.role) params.set('role', query.role);
  if (query.status) params.set('status', query.status);
  return params;
}

export function employeeDate(value: string | null): string {
  return value === null ? '从未登录' : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
