// 作用：组装员工认证、本人改密、密码处理及登录限流依赖。
import { Module } from '@nestjs/common';
import { AuthGuardModule } from './auth-guard.module.js';
import { EmployeeAuthController } from './employee-auth.controller.js';
import { EmployeeAuthService } from './employee-auth.service.js';
import { LoginRateLimiter } from './login-rate-limiter.js';
import { LoginRateGuard } from './login-rate.guard.js';
import { PasswordService } from './password.service.js';
import { AuditModule } from '../audit/audit.module.js';
import { EmployeePasswordService } from './employee-password.service.js';

@Module({ imports: [AuthGuardModule, AuditModule], controllers: [EmployeeAuthController],
  providers: [EmployeeAuthService, EmployeePasswordService, PasswordService, LoginRateGuard, { provide: LoginRateLimiter, useFactory: () => new LoginRateLimiter() }],
  exports: [EmployeeAuthService, PasswordService, LoginRateLimiter] })
export class EmployeeAuthModule {}
