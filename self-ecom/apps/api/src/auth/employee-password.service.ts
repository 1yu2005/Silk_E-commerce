// 作用：锁定并重新认证当前员工，原子改密、解除首次改密限制并撤销全部会话。
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthSessionService } from './auth-session.service.js';
import { runAuthTransaction } from './auth-transaction.js';
import { ChangePasswordDto } from './change-password.dto.js';
import { CurrentIdentityService, type CurrentIdentity } from './current-identity.service.js';
import { TokenValidationError } from './jwt-token.service.js';
import { PasswordService } from './password.service.js';
import { lockSessionSubject, SessionAuthenticationError } from './session-support.js';

@Injectable()
export class EmployeePasswordService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(CurrentIdentityService) private readonly identities: CurrentIdentityService,
    @Inject(AuthSessionService) private readonly sessions: AuthSessionService,
    @Inject(AuditService) private readonly audit: AuditService) {}

  async changePassword(actor: CurrentIdentity, token: string, input: ChangePasswordDto, requestId: string) {
    if (actor.subjectType !== 'EMPLOYEE') throw new TokenValidationError('TOKEN_SUBJECT_MISMATCH');
    this.passwords.assertPasswordChange(input.oldPassword, input.newPassword);
    const snapshot = await this.prisma.employee.findUnique({ where: { id: actor.subjectId },
      select: { passwordHash: true, tokenVersion: true } });
    if (!snapshot) throw new SessionAuthenticationError('ACCOUNT_UNAVAILABLE');
    if (!await this.passwords.verify(input.oldPassword, snapshot.passwordHash)) {
      throw new SessionAuthenticationError('INVALID_CREDENTIALS');
    }
    // bcrypt不占用主体锁；锁内必须复核已验证快照及本次请求凭证，不能只相信Guard结果。
    const passwordHash = await this.passwords.hash(input.newPassword);
    return runAuthTransaction(this.prisma, async tx => {
      await lockSessionSubject(tx, actor);
      const currentActor = await this.identities.authenticate(tx, token, 'EMPLOYEE');
      if (currentActor.subjectId !== actor.subjectId || currentActor.sessionId !== actor.sessionId) {
        throw new TokenValidationError('TOKEN_INVALID');
      }
      const current = await tx.employee.findUniqueOrThrow({ where: { id: actor.subjectId },
        select: { passwordHash: true, tokenVersion: true, mustChangePassword: true } });
      if (current.passwordHash !== snapshot.passwordHash || current.tokenVersion !== snapshot.tokenVersion) {
        throw new SessionAuthenticationError('INVALID_CREDENTIALS');
      }
      await tx.employee.update({ where: { id: actor.subjectId }, data: {
        passwordHash, mustChangePassword: false, tokenVersion: { increment: 1 }, version: { increment: 1 },
      } });
      await this.sessions.revokeAll(tx, actor, 'PASSWORD_CHANGED');
      await this.audit.appendAudit(tx, { actor: { type: 'EMPLOYEE', id: actor.subjectId },
        action: 'employee.password.change', targetId: actor.subjectId, requestId,
        before: { mustChangePassword: current.mustChangePassword },
        after: { passwordChanged: true, mustChangePassword: false } });
      return { changed: true as const, requireLogin: true as const };
    });
  }
}
