/** 文件作用：校验员工管理操作、保护旧会话写入并预览权限依赖。 */
import type { ApiResponse, AuthSessionStore, EmployeePermissions, EmployeeRole, PermissionCatalog, PermissionResolution } from '@shop/api-client';

export const managementPermissions = {
  profile: 'employee.profile.update', status: 'employee.status.manage', reset: 'employee.password.reset',
  role: 'employee.role.change', permissions: 'employee.permission.manage',
} as const;
export type EmployeeOperation = keyof typeof managementPermissions;
export function canManageEmployee(permissions: EmployeePermissions | null, operation: EmployeeOperation): boolean {
  return permissions?.effectivePermissions.includes(managementPermissions[operation]) ?? false;
}
export function managementReasonIssue(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return '请填写操作原因';
  return Array.from(value.trim()).length > 500 ? '操作原因最多500个字符' : null;
}

/** 旧登录的写响应不能清缓存、刷新身份或改写新登录的页面。 */
export async function runEmployeeMutation<Data>(session: AuthSessionStore, send: () => Promise<ApiResponse<Data>>, committed: (data: Data) => void): Promise<Data | null> {
  const revision = session.current().revision; const loginRevision = session.getLoginRevision();
  if (!session.current().credential) return null;
  const isCurrent = () => session.current().revision === revision && session.getLoginRevision() === loginRevision;
  try {
    const { data } = await send();
    if (!isCurrent()) return null;
    committed(data); return data;
  } catch (error) { if (isCurrent()) throw error; return null; }
}

const sorted = (values: Iterable<string>) => [...new Set(values)].sort();

/** 预览只读取API目录；先验证依赖图，异常目录不能参与保存。服务端仍会权威重算。 */
export function previewExtraPermissions(catalog: PermissionCatalog, role: EmployeeRole, oldExtras: readonly string[], requested: readonly string[]): PermissionResolution {
  const invalid = () => { throw new Error('权限目录或现有授权异常，请刷新后重试'); };
  const byCode = new Map(catalog.permissions.map(item => [item.code, item]));
  if (byCode.size !== catalog.permissions.length || !byCode.size) invalid();
  const visited = new Set<string>(); const visiting = new Set<string>();
  const visit = (code: string) => {
    if (visiting.has(code)) invalid();
    if (visited.has(code)) return;
    const item = byCode.get(code); if (!item) return invalid();
    visiting.add(code);
    for (const dependency of item.dependencies) {
      if (!item.adminOnly && byCode.get(dependency)?.adminOnly) invalid();
      visit(dependency);
    }
    visiting.delete(code); visited.add(code);
  };
  for (const code of byCode.keys()) visit(code);
  for (const templateRole of ['SUPER_ADMIN', 'MERCH_WAREHOUSE', 'CUSTOMER_SERVICE'] as const) {
    const codes = catalog.roleTemplates[templateRole]; if (!Array.isArray(codes)) invalid();
    const defaults = new Set(codes);
    if (defaults.size !== codes.length) invalid();
    for (const code of defaults) {
      const item = byCode.get(code);
      if (!item || (templateRole !== 'SUPER_ADMIN' && item.adminOnly) || item.dependencies.some(dependency => !defaults.has(dependency))) invalid();
    }
    if (templateRole === 'SUPER_ADMIN' && defaults.size !== byCode.size) invalid();
  }
  if (role === 'SUPER_ADMIN' || !Object.hasOwn(catalog.roleTemplates, role)) invalid();
  const defaults = new Set(catalog.roleTemplates[role]);
  for (const code of [...oldExtras, ...requested]) if (!byCode.has(code) || byCode.get(code)!.adminOnly) invalid();
  const oldEffective = new Set([...defaults, ...oldExtras]);
  for (const code of oldEffective) if (byCode.get(code)!.dependencies.some(dependency => !oldEffective.has(dependency))) invalid();
  const desired = new Set(requested.filter(code => !defaults.has(code)));
  const removed = new Set(oldExtras.filter(code => !defaults.has(code) && !desired.has(code)));
  const memo = new Map<string, boolean>();
  const blocked = (code: string): boolean => {
    if (defaults.has(code)) return false;
    if (memo.has(code)) return memo.get(code)!;
    const result = removed.has(code) || byCode.get(code)!.dependencies.some(blocked);
    memo.set(code, result); return result;
  };
  const removedByDependency: string[] = [];
  for (const code of desired) if (blocked(code)) { desired.delete(code); removedByDependency.push(code); }
  const resolved = new Set<string>();
  const add = (code: string) => {
    if (defaults.has(code) || resolved.has(code)) return;
    for (const dependency of byCode.get(code)!.dependencies) add(dependency);
    resolved.add(code);
  };
  for (const code of desired) add(code);
  return { defaultPermissions: sorted(defaults), resolvedExtraPermissions: sorted(resolved), effectivePermissions: sorted([...defaults, ...resolved]),
    addedByDependency: sorted([...resolved].filter(code => !desired.has(code))), removedByDependency: sorted(removedByDependency),
    normalizedDefaultPermissions: sorted(requested.filter(code => defaults.has(code))) };
}
