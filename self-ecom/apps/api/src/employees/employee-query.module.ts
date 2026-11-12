// 作用：组装员工查询控制器、一致快照查询服务及访问守卫。
import { Module } from '@nestjs/common';
import { AuthGuardModule } from '../auth/auth-guard.module.js';
import { PermissionModule } from '../permissions/permission.module.js';
import { EmployeeQueryController } from './employee-query.controller.js';
import { EmployeeQueryService } from './employee-query.service.js';

@Module({ imports: [AuthGuardModule, PermissionModule], controllers: [EmployeeQueryController], providers: [EmployeeQueryService] })
export class EmployeeQueryModule {}
