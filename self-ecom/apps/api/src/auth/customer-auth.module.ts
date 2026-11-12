// 作用：组装顾客认证、资料修改、改密服务及独立登录限流依赖。
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthGuardModule } from './auth-guard.module.js';
import { CustomerAuthController } from './customer-auth.controller.js';
import { CustomerAuthService } from './customer-auth.service.js';
import { CUSTOMER_LOGIN_RATE_LIMITER, CustomerLoginRateGuard } from './customer-login-rate.guard.js';
import { LoginRateLimiter } from './login-rate-limiter.js';
import { PasswordService } from './password.service.js';
import { CustomerProfileService } from './customer-profile.service.js';
import { CustomerPasswordService } from './customer-password.service.js';

@Module({ imports: [AuthGuardModule, AuditModule], controllers: [CustomerAuthController], providers: [
  CustomerAuthService, CustomerProfileService, CustomerPasswordService, PasswordService, CustomerLoginRateGuard,
  { provide: CUSTOMER_LOGIN_RATE_LIMITER, useFactory: () => new LoginRateLimiter(undefined, undefined, 'CUSTOMER') },
] })
export class CustomerAuthModule {}
