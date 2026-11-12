// 作用：为接口声明员工、顾客或双登录域访问策略及所需权限。
import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { permissionDefinitions, type PermissionCode } from '../permissions/permission-catalog.js';
import { AUTH_DOMAIN, AUTH_PERMISSIONS, type AuthDomain } from './auth-policy.js';
import { PermissionGuard } from './permission.guard.js';
import { SessionAuthGuard } from './session-auth.guard.js';

const knownCodes = new Set<string>(permissionDefinitions.map(item => item.code));
function protectedAccess(domain: AuthDomain, permissions: readonly PermissionCode[]) {
  if (permissions.some(code => !knownCodes.has(code))) throw new Error('路由声明了未知权限');
  return applyDecorators(SetMetadata(AUTH_DOMAIN, domain), SetMetadata(AUTH_PERMISSIONS, Object.freeze([...permissions])),
    UseGuards(SessionAuthGuard, PermissionGuard));
}

/** 同时安装认证和权限Guard；控制器及方法的权限累加，全部满足才允许访问。 */
export function EmployeeAccess(...permissions: PermissionCode[]) { return protectedAccess('EMPLOYEE', permissions); }
export function CustomerAccess() { return protectedAccess('CUSTOMER', []); }
export function AnyAccountAccess() { return protectedAccess('EITHER', []); }
