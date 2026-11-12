// 作用：执行最新权限检查及首次强制改密的精确路由白名单。
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessDeniedError } from './access-denied.error.js';
import { getRequestIdentity, type AuthHttpRequest } from './auth-request-context.js';
import { routePermissions } from './auth-policy.js';

const passwordChangeRoutes = new Set([
  'GET /api/v1/admin/me', 'POST /api/v1/admin/auth/change-password', 'POST /api/v1/auth/logout',
]);

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthHttpRequest>();
    const identity = getRequestIdentity(request);
    // 使用Express实际匹配的路由模板和真实方法，忽略原始URL、查询参数及客户端自报身份。
    if (identity.subjectType === 'EMPLOYEE' && identity.mustChangePassword
      && !passwordChangeRoutes.has(`${request.method} ${typeof request.route?.path === 'string' ? request.route.path : ''}`)) {
      throw new AccessDeniedError('PASSWORD_CHANGE_REQUIRED');
    }
    const required = routePermissions(this.reflector, context);
    if (required.length && (identity.subjectType !== 'EMPLOYEE'
      || required.some(code => !identity.effectivePermissions.includes(code)))) throw new AccessDeniedError('FORBIDDEN');
    return true;
  }
}
