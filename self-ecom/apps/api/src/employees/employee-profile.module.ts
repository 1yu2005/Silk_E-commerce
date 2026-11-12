// 作用：组装修改员工显示名的控制器、服务与事务审计依赖。
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthGuardModule } from '../auth/auth-guard.module.js';
import { EmployeeProfileController } from './employee-profile.controller.js';
import { EmployeeProfileService } from './employee-profile.service.js';

@Module({ imports: [AuthGuardModule, AuditModule], controllers: [EmployeeProfileController], providers: [EmployeeProfileService] })
export class EmployeeProfileModule {}
