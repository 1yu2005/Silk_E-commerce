// 作用：组装会话管理、JWT 与当前数据库身份解析依赖。
import { Module } from '@nestjs/common';
import { PermissionModule } from '../permissions/permission.module.js';
import { PermissionService } from '../permissions/permission.service.js';
import { AuthSessionService } from './auth-session.service.js';
import { CurrentIdentityService } from './current-identity.service.js';
import { JwtTokenModule } from './jwt-token.module.js';
import { JwtTokenService } from './jwt-token.service.js';

// 由认证业务模块显式导入，本模块只提供服务，不注册HTTP路由或全局Guard。
@Module({ imports: [JwtTokenModule, PermissionModule], providers: [
  { provide: AuthSessionService, inject: [JwtTokenService], useFactory: (tokens: JwtTokenService) => new AuthSessionService(tokens) },
  { provide: CurrentIdentityService, inject: [JwtTokenService, PermissionService],
    useFactory: (tokens: JwtTokenService, permissions: PermissionService) => new CurrentIdentityService(tokens, permissions) },
], exports: [AuthSessionService, CurrentIdentityService] })
export class AuthSessionModule {}
