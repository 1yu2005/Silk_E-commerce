// 作用：导出统一权限计算服务，供认证、员工管理及目录查询模块复用。
import { Module } from '@nestjs/common';
import { PermissionService } from './permission.service.js';

@Module({ providers: [PermissionService], exports: [PermissionService] })
export class PermissionModule {}
