/** 文件作用：定义员工查询、管理命令、权限目录及依赖计算的接口契约。 */
import type { EmployeeRole } from './auth.js';
import type { Page } from './index.js';

/** 员工查询的公开契约；不包含密码、令牌或数据库实体。 */
export type EmployeeStatus = 'ACTIVE' | 'DISABLED';
export interface EmployeeListQuery {
  page?: number; pageSize?: number; keyword?: string; role?: EmployeeRole; status?: EmployeeStatus;
}
export interface EmployeeListItem {
  id: string; username: string; displayName: string; role: EmployeeRole; status: EmployeeStatus;
  mustChangePassword: boolean; version: number; createdAt: string; lastLoginAt: string | null;
}
export type EmployeeListData = Page<EmployeeListItem>;
export interface EmployeeDetail extends EmployeeListItem {
  permissionVersion: number; defaultPermissions: string[]; extraPermissions: string[]; effectivePermissions: string[];
}

/** 确认密码只用于页面校验，创建接口不接收它。 */
export interface EmployeeCreateInput {
  username: string; displayName: string; role: EmployeeRole; initialPassword: string; reason: string;
}
export type EmployeeCreateData = EmployeeListItem;

/** 管理命令使用打开表单时的资料版本；原因用于审计。 */
export interface EmployeeCommandInput { expectedVersion: number; reason: string }
export interface EmployeeProfileInput extends EmployeeCommandInput { displayName: string }
export type EmployeeProfileData = EmployeeListItem;
export interface EmployeeStatusData { id: string; status: EmployeeStatus; version: number; changed: boolean }
export interface EmployeePasswordResetInput extends EmployeeCommandInput { temporaryPassword: string }
export interface EmployeePasswordResetData { id: string; mustChangePassword: true; version: number }
export interface EmployeeRoleInput extends EmployeeCommandInput { role: EmployeeRole }
export interface EmployeeRoleData {
  id: string; role: EmployeeRole; extraPermissions: string[]; version: number; permissionVersion: number; changed: boolean;
}
export interface EmployeeExtraPermissionsInput extends EmployeeCommandInput { permissions: string[] }
export interface PermissionResolution {
  defaultPermissions: string[]; resolvedExtraPermissions: string[]; effectivePermissions: string[];
  addedByDependency: string[]; removedByDependency: string[]; normalizedDefaultPermissions: string[];
}
export interface EmployeeExtraPermissionsData extends PermissionResolution {
  id: string; version: number; permissionVersion: number; changed: boolean;
}
export interface PermissionDefinition {
  code: string; name: string; description: string; adminOnly: boolean; dependencies: string[];
}
export interface PermissionCatalog {
  permissions: PermissionDefinition[]; roleTemplates: Record<EmployeeRole, string[]>;
}
