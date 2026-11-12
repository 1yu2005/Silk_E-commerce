// 作用：按接口登录域验证会话身份，并将认证结果交给后续权限守卫。
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service.js';
import { CurrentIdentityService } from './current-identity.service.js';
import { TokenValidationError } from './jwt-token.service.js';
import { readBearerToken, setRequestIdentity, type AuthHttpRequest } from './auth-request-context.js';
import { routeAuthDomain } from './auth-policy.js';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CurrentIdentityService) private readonly identities: CurrentIdentityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const domain = routeAuthDomain(this.reflector, context);
    const request = context.switchToHttp().getRequest<AuthHttpRequest>();
    const token = readBearerToken(request);
    let identity;
    if (domain === 'EITHER') {
      // 共用注销等入口只根据已验证的登录域切换，不能信任decode后的未验证载荷。
      try { identity = await this.identities.authenticate(this.prisma, token, 'EMPLOYEE'); }
      catch (error: unknown) {
        if (!(error instanceof TokenValidationError) || error.code !== 'TOKEN_SUBJECT_MISMATCH') throw error;
        identity = await this.identities.authenticate(this.prisma, token, 'CUSTOMER');
      }
    } else identity = await this.identities.authenticate(this.prisma, token, domain);
    setRequestIdentity(request, identity);
    return true;
  }
}
