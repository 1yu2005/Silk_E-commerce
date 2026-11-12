// 作用：组装调整员工岗位并清空额外权限的控制器、服务与事务审计依赖。
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthGuardModule } from '../auth/auth-guard.module.js';
import { PermissionModule } from '../permissions/permission.module.js';
import { EmployeeEligibilityModule } from './employee-eligibility.module.js';
import { EmployeeRoleController } from './employee-role.controller.js';
import { EmployeeRoleService } from './employee-role.service.js';

@Module({ imports: [AuthGuardModule, AuditModule, PermissionModule, EmployeeEligibilityModule],
  controllers: [EmployeeRoleController], providers: [EmployeeRoleService] })
export class EmployeeRoleModule {}
