// 作用：验证顾客手机号密码与状态，创建顾客会话并查询本人公开资料。
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DtoValidationException } from '../common/http/dto-validation.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthSessionService } from './auth-session.service.js';
import { runAuthTransaction } from './auth-transaction.js';
import type { CurrentIdentity } from './current-identity.service.js';
import { CUSTOMER_LOGIN_RATE_LIMITER } from './customer-login-rate.guard.js';
import { CustomerLoginDto } from './customer-login.dto.js';
import { TokenValidationError } from './jwt-token.service.js';
import { LoginRateLimiter } from './login-rate-limiter.js';
import { DUMMY_LOGIN_HASH } from './login-support.js';
import { PasswordService } from './password.service.js';
import { SessionAuthenticationError } from './session-support.js';

const summarySelect = { id: true, phone: true, nickname: true, status: true, createdAt: true } satisfies Prisma.CustomerSelect;

@Injectable()
export class CustomerAuthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(AuthSessionService) private readonly sessions: AuthSessionService,
    @Inject(CUSTOMER_LOGIN_RATE_LIMITER) private readonly limiter: LoginRateLimiter) {}

  async login(input: CustomerLoginDto, sourceIp: string) {
    const phone = typeof input.phone === 'string' ? input.phone.trim() : input.phone;
    if (typeof phone !== 'string' || !/^1[3-9][0-9]{9}$/.test(phone)) {
      throw new DtoValidationException([{ field: 'phone', message: '手机号格式不合法' }]);
    }
    const reservation = this.limiter.reserveAccount(phone, sourceIp); let failed = false;
    try {
      const current = await this.prisma.customer.findUnique({ where: { phone }, select: { id: true, passwordHash: true, tokenVersion: true } });
      const correct = await this.passwords.verify(input.password, current?.passwordHash ?? DUMMY_LOGIN_HASH);
      // 只有密码正确后才检查冻结；不存在和密码错误统一提示，不暴露账号状态。
      if (!current || !correct) throw new SessionAuthenticationError('INVALID_CREDENTIALS');
      return await runAuthTransaction(this.prisma, async tx => {
        const issued = await this.sessions.createAfterPasswordVerified(tx, { subjectType: 'CUSTOMER', subjectId: current.id,
          expectedPasswordHash: current.passwordHash, expectedTokenVersion: current.tokenVersion });
        const customer = await tx.customer.findUniqueOrThrow({ where: { id: current.id }, select: summarySelect });
        return { accessToken: issued.accessToken, tokenType: 'Bearer' as const, expiresAt: issued.expiresAt, customer: { ...customer, avatarUrl: null } };
      });
    } catch (error: unknown) {
      failed = error instanceof SessionAuthenticationError && ['INVALID_CREDENTIALS', 'ACCOUNT_UNAVAILABLE'].includes(error.code); throw error;
    } finally { this.limiter.finish(reservation, failed); }
  }

  async me(identity: CurrentIdentity) {
    if (identity.subjectType !== 'CUSTOMER') throw new TokenValidationError('TOKEN_SUBJECT_MISMATCH');
    // 只按Guard确认的本人ID查询，不接受客户端自报对象；通用身份结果继续不携带手机号。
    const customer = await this.prisma.customer.findUnique({ where: { id: identity.subjectId }, select: summarySelect });
    if (!customer || customer.status === 'LOGIN_FROZEN') throw new SessionAuthenticationError('ACCOUNT_UNAVAILABLE');
    return { ...customer, avatarUrl: null };
  }
}
