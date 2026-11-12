// 作用：在注册参数校验前执行独立的来源 IP 限流，避免占用登录预算。
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { LOGIN_RATE_POLICY, LoginRateLimiter } from './login-rate-limiter.js';
import { loginSourceIp } from './login-rate.guard.js';

export const REGISTRATION_RATE_LIMITER = Symbol('REGISTRATION_RATE_LIMITER');
// 独立实例只使用既有IP计数算法，不占员工登录预算，不创建账号失败桶。
export const REGISTRATION_RATE_POLICY = Object.freeze({ ...LOGIN_RATE_POLICY, ipAttempts: 5 });

@Injectable()
export class RegistrationRateGuard implements CanActivate {
  constructor(@Inject(REGISTRATION_RATE_LIMITER) private readonly limiter: LoginRateLimiter) {}
  canActivate(context: ExecutionContext): boolean {
    this.limiter.consumeIp(loginSourceIp(context.switchToHttp().getRequest<IncomingMessage>())); return true;
  }
}
