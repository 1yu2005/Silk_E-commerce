// 作用：组装替换员工个人额外权限的控制器、服务与事务审计依赖。
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthGuardModule } from '../auth/auth-guard.module.js';
import { PermissionModule } from '../permissions/permission.module.js';
import { EmployeeEligibilityModule } from './employee-eligibility.module.js';
import { EmployeeExtraPermissionController } from './employee-extra-permission.controller.js';
import { EmployeeExtraPermissionService } from './employee-extra-permission.service.js';

@Module({ imports: [AuthGuardModule, AuditModule, PermissionModule, EmployeeEligibilityModule],
  controllers: [EmployeeExtraPermissionController], providers: [EmployeeExtraPermissionService] })
export class EmployeeExtraPermissionModule {}
