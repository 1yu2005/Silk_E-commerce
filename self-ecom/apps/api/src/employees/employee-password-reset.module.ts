// 作用：组装重置其他员工密码的控制器、服务与事务审计依赖。
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthGuardModule } from '../auth/auth-guard.module.js';
import { PasswordService } from '../auth/password.service.js';
import { EmployeePasswordResetController } from './employee-password-reset.controller.js';
import { EmployeePasswordResetService } from './employee-password-reset.service.js';

@Module({ imports: [AuthGuardModule, AuditModule], controllers: [EmployeePasswordResetController],
  providers: [PasswordService, EmployeePasswordResetService] })
export class EmployeePasswordResetModule {}
