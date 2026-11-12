// 作用：组装顾客注册、密码处理、审计与独立注册限流依赖。
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CustomerRegisterController } from './customer-register.controller.js';
import { CustomerRegisterService } from './customer-register.service.js';
import { LoginRateLimiter } from './login-rate-limiter.js';
import { PasswordService } from './password.service.js';
import { REGISTRATION_RATE_LIMITER, REGISTRATION_RATE_POLICY, RegistrationRateGuard } from './registration-rate.guard.js';

@Module({ imports: [PrismaModule, AuditModule], controllers: [CustomerRegisterController], providers: [
  CustomerRegisterService, PasswordService, RegistrationRateGuard,
  { provide: REGISTRATION_RATE_LIMITER, useFactory: () => new LoginRateLimiter(undefined, REGISTRATION_RATE_POLICY) },
] })
export class CustomerRegisterModule {}
