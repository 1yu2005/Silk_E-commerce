// 作用：在主体锁内复核当前会话并幂等注销，仅首次撤销时写入同事务审计。
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthSessionService } from './auth-session.service.js';
import { runAuthTransaction } from './auth-transaction.js';
import { CurrentIdentityService } from './current-identity.service.js';
import { JwtTokenService, TokenValidationError } from './jwt-token.service.js';
import { lockSessionSubject } from './session-support.js';

@Injectable()
export class LogoutService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtTokenService) private readonly tokens: JwtTokenService,
    @Inject(CurrentIdentityService) private readonly identities: CurrentIdentityService,
    @Inject(AuthSessionService) private readonly sessions: AuthSessionService,
    @Inject(AuditService) private readonly audit: AuditService) {}

  /** 只在已验证的域不匹配时切换；不能信任decode载荷或吞掉其它认证错误。 */
  async verifyToken(token: string) {
    try { return await this.tokens.verify(token, 'EMPLOYEE'); }
    catch (error: unknown) {
      if (!(error instanceof TokenValidationError) || error.code !== 'TOKEN_SUBJECT_MISMATCH') throw error;
      return this.tokens.verify(token, 'CUSTOMER');
    }
  }

  async logout(token: string, requestId: string) {
    const claims = await this.verifyToken(token);
    const subject = { subjectType: claims.subjectType, subjectId: claims.sub.toLowerCase() };
    const sessionId = claims.sid.toLowerCase();
    return runAuthTransaction(this.prisma, async tx => {
      await lockSessionSubject(tx, subject);
      const session = await tx.authSession.findUnique({ where: { id: sessionId }, select: {
        subjectType: true, employeeId: true, customerId: true, tokenVersion: true, expiresAt: true, revokedAt: true,
      } });
      // 等待主体锁及读库期间可能到期，必须在锁内读完后再次验证，而非复用入口时效。
      await this.tokens.verify(token, subject.subjectType);
      if (!session || session.subjectType !== subject.subjectType
        || (subject.subjectType === 'EMPLOYEE' ? session.employeeId : session.customerId) !== subject.subjectId
        || session.tokenVersion !== claims.tokenVersion || session.expiresAt.getTime() !== claims.exp * 1000) {
        throw new TokenValidationError('TOKEN_INVALID');
      }
      // 已撤销会话只作幂等确认；不覆盖重置/停用等撤销事实，也不授予任何业务访问能力。
      if (session.revokedAt !== null) return { loggedOut: true as const };
      await this.identities.authenticate(tx, token, subject.subjectType);
      const changed = await this.sessions.revokeCurrent(tx, subject, sessionId);
      if (changed) await this.audit.appendAudit(tx, { actor: { type: subject.subjectType, id: subject.subjectId },
        action: 'auth.logout', targetId: sessionId, requestId, after: { loggedOut: true } });
      return { loggedOut: true as const };
    });
  }
}
