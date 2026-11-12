// 作用：对顾客登录使用独立的来源 IP 和账号限流预算。
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { LoginRateLimiter } from './login-rate-limiter.js';
import { loginSourceIp } from './login-rate.guard.js';

export const CUSTOMER_LOGIN_RATE_LIMITER = Symbol('CUSTOMER_LOGIN_RATE_LIMITER');

@Injectable()
export class CustomerLoginRateGuard implements CanActivate {
  constructor(@Inject(CUSTOMER_LOGIN_RATE_LIMITER) private readonly limiter: LoginRateLimiter) {}
  canActivate(context: ExecutionContext): boolean {
    this.limiter.consumeIp(loginSourceIp(context.switchToHttp().getRequest<IncomingMessage>())); return true;
  }
}
