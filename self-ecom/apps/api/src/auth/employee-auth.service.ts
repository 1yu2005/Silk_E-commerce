// 作用：规范化员工账号并验证密码，在锁内复核后创建员工会话。
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { DtoValidationException } from '../common/http/dto-validation.js';
import { AuthSessionService } from './auth-session.service.js';
import { EmployeeLoginDto, normalizeEmployeeUsername } from './employee-login.dto.js';
import { PasswordService } from './password.service.js';
import { LoginRateLimiter } from './login-rate-limiter.js';
import { SessionAuthenticationError } from './session-support.js';
import { runAuthTransaction } from './auth-transaction.js';
import { DUMMY_LOGIN_HASH } from './login-support.js';

const summarySelect = { id: true, username: true, displayName: true, role: true, status: true, mustChangePassword: true } satisfies Prisma.EmployeeSelect;

@Injectable()
export class EmployeeAuthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(AuthSessionService) private readonly sessions: AuthSessionService,
    @Inject(LoginRateLimiter) private readonly limiter: LoginRateLimiter) {}

  async login(input: EmployeeLoginDto, sourceIp: string) {
    const username = normalizeEmployeeUsername(input.username);
    if (typeof username !== 'string' || !/^[a-z][a-z0-9_]{3,31}$/.test(username)) {
      throw new DtoValidationException([{ field: 'username', message: '账号格式不合法' }]);
    }
    const reservation = this.limiter.reserveAccount(username, sourceIp);
    let failed = false;
    try {
      const current = await this.prisma.employee.findUnique({ where: { username }, select: { id: true, passwordHash: true, tokenVersion: true } });
      const correct = await this.passwords.verify(input.password, current?.passwordHash ?? DUMMY_LOGIN_HASH);
      // 不存在账号和密码错误统一拒绝；只有正确密码才能进入锁内状态检查。
      if (!current || !correct) throw new SessionAuthenticationError('INVALID_CREDENTIALS');
      return await runAuthTransaction(this.prisma, async tx => {
        const issued = await this.sessions.createAfterPasswordVerified(tx, { subjectType: 'EMPLOYEE', subjectId: current.id,
          expectedPasswordHash: current.passwordHash, expectedTokenVersion: current.tokenVersion });
        const employee = await tx.employee.findUniqueOrThrow({ where: { id: current.id }, select: summarySelect });
        return { accessToken: issued.accessToken, tokenType: 'Bearer' as const, expiresAt: issued.expiresAt,
          mustChangePassword: employee.mustChangePassword, employee };
      });
    } catch (error: unknown) {
      failed = error instanceof SessionAuthenticationError && ['INVALID_CREDENTIALS', 'ACCOUNT_UNAVAILABLE'].includes(error.code);
      throw error;
    } finally { this.limiter.finish(reservation, failed); }
  }
}
