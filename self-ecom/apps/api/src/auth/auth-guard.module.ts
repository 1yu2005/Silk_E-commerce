// 作用：组装会话认证与权限守卫，供受保护业务模块显式导入。
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthSessionModule } from './auth-session.module.js';
import { PermissionGuard } from './permission.guard.js';
import { SessionAuthGuard } from './session-auth.guard.js';

// 由认证和员工业务模块显式导入；不注册全局Guard，公开健康检查仍无需登录。
@Module({ imports: [PrismaModule, AuthSessionModule], providers: [SessionAuthGuard, PermissionGuard],
  exports: [SessionAuthGuard, PermissionGuard, PrismaModule, AuthSessionModule] })
export class AuthGuardModule {}
