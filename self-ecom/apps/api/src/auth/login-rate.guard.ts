// 作用：从真实连接读取来源 IP，并在员工登录参数校验前执行限流。
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';
import { LoginRateLimiter } from './login-rate-limiter.js';

/** 直接使用连接来源，忽略X-Forwarded-For和客户端自报IP；代理部署需另行明确可信范围。 */
export function loginSourceIp(request: IncomingMessage): string {
  const source = request.socket.remoteAddress;
  if (!source || !isIP(source)) throw new Error('无法确定认证请求来源');
  return source.startsWith('::ffff:') && isIP(source.slice(7)) === 4 ? source.slice(7) : source;
}
@Injectable()
export class LoginRateGuard implements CanActivate {
  constructor(@Inject(LoginRateLimiter) private readonly limiter: LoginRateLimiter) {}
  canActivate(context: ExecutionContext): boolean {
    this.limiter.consumeIp(loginSourceIp(context.switchToHttp().getRequest<IncomingMessage>())); return true;
  }
}
