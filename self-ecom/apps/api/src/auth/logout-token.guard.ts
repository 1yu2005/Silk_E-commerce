// 作用：在注销前验证 Bearer 签名及登录域，将会话幂等裁决留给事务服务。
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { readBearerToken, type AuthHttpRequest } from './auth-request-context.js';
import { LogoutService } from './logout.service.js';

/** 注销专用入口先验证Bearer签名；会话归属、当前状态及幂等例外由锁内命令裁决。 */
@Injectable()
export class LogoutTokenGuard implements CanActivate {
  constructor(@Inject(LogoutService) private readonly logout: LogoutService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthHttpRequest>();
    await this.logout.verifyToken(readBearerToken(request));
    return true;
  }
}
