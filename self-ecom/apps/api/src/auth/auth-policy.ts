// 作用：读取并校验控制器与方法的登录域、必需权限等访问策略。
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionCode } from '../permissions/permission-catalog.js';

export type AuthDomain = 'EMPLOYEE' | 'CUSTOMER' | 'EITHER';
export const AUTH_DOMAIN = Symbol('AUTH_DOMAIN');
export const AUTH_PERMISSIONS = Symbol('AUTH_PERMISSIONS');

/** 控制器和方法只可沿用同一登录域；配置冲突拒绝执行，不允许方法偷偷切换身份域。 */
export function routeAuthDomain(reflector: Reflector, context: ExecutionContext): AuthDomain {
  const domains = [context.getClass(), context.getHandler()]
    .map(target => reflector.get<AuthDomain | undefined>(AUTH_DOMAIN, target)).filter(value => value !== undefined);
  if (!domains.length || domains.some(value => !['EMPLOYEE', 'CUSTOMER', 'EITHER'].includes(value))
    || new Set(domains).size !== 1) throw new Error('受保护路由的登录域配置不合法');
  return domains[0]!;
}
export function routePermissions(reflector: Reflector, context: ExecutionContext): PermissionCode[] {
  return reflector.getAllAndMerge<PermissionCode[]>(AUTH_PERMISSIONS, [context.getClass(), context.getHandler()]);
}
