// 作用：组装启用或停用员工的控制器、服务与事务审计依赖。
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthGuardModule } from '../auth/auth-guard.module.js';
import { PermissionModule } from '../permissions/permission.module.js';
import { EmployeeEligibilityModule } from './employee-eligibility.module.js';
import { EmployeeStatusController } from './employee-status.controller.js';
import { EmployeeStatusService } from './employee-status.service.js';

@Module({ imports: [AuthGuardModule, AuditModule, PermissionModule, EmployeeEligibilityModule],
  controllers: [EmployeeStatusController], providers: [EmployeeStatusService] })
export class EmployeeStatusModule {}
