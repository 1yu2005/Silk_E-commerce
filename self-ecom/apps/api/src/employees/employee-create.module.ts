// 作用：组装创建员工的控制器、服务与事务审计依赖。
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthGuardModule } from '../auth/auth-guard.module.js';
import { PasswordService } from '../auth/password.service.js';
import { EmployeeCreateController } from './employee-create.controller.js';
import { EmployeeCreateService } from './employee-create.service.js';

@Module({ imports: [AuthGuardModule, AuditModule], controllers: [EmployeeCreateController],
  providers: [PasswordService, EmployeeCreateService] })
export class EmployeeCreateModule {}
