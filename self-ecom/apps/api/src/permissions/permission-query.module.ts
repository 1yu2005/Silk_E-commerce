// 作用：组装只读权限目录接口及员工访问守卫。
import { Module } from '@nestjs/common';
import { AuthGuardModule } from '../auth/auth-guard.module.js';
import { PermissionModule } from './permission.module.js';
import { PermissionQueryController } from './permission-query.controller.js';

// HTTP接入单独组合认证依赖，保持权限计算模块可被身份服务和seed独立复用。
@Module({ imports: [AuthGuardModule, PermissionModule], controllers: [PermissionQueryController] })
export class PermissionQueryModule {}
