// 作用：锁定并重新认证当前顾客，原子更新密码、撤销全部会话及写入审计。
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
export class CustomerPasswordService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(CurrentIdentityService) private readonly identities: CurrentIdentityService,
    @Inject(AuthSessionService) private readonly sessions: AuthSessionService,
    @Inject(AuditService) private readonly audit: AuditService) {}

  async changePassword(actor: CurrentIdentity, token: string, input: ChangePasswordDto, requestId: string) {
    if (actor.subjectType !== 'CUSTOMER') throw new TokenValidationError('TOKEN_SUBJECT_MISMATCH');
    this.passwords.assertPasswordChange(input.oldPassword, input.newPassword);
    const snapshot = await this.prisma.customer.findUnique({ where: { id: actor.subjectId }, select: { passwordHash: true, tokenVersion: true } });
    if (!snapshot) throw new SessionAuthenticationError('ACCOUNT_UNAVAILABLE');
    if (!await this.passwords.verify(input.oldPassword, snapshot.passwordHash)) throw new SessionAuthenticationError('INVALID_CREDENTIALS');
    // bcrypt在事务外计算，锁内复核密码快照和本次会话；任一失效都不能提交旧请求。
    const passwordHash = await this.passwords.hash(input.newPassword);
    return runAuthTransaction(this.prisma, async tx => {
      await lockSessionSubject(tx, actor);
      const currentActor = await this.identities.authenticate(tx, token, 'CUSTOMER');
      if (currentActor.subjectId !== actor.subjectId || currentActor.sessionId !== actor.sessionId) throw new TokenValidationError('TOKEN_INVALID');
      const current = await tx.customer.findUniqueOrThrow({ where: { id: actor.subjectId }, select: { passwordHash: true, tokenVersion: true } });
      if (current.passwordHash !== snapshot.passwordHash || current.tokenVersion !== snapshot.tokenVersion) throw new SessionAuthenticationError('INVALID_CREDENTIALS');
      await tx.customer.update({ where: { id: actor.subjectId }, data: { passwordHash, tokenVersion: { increment: 1 } } });
      await this.sessions.revokeAll(tx, actor, 'PASSWORD_CHANGED');
      await this.audit.appendAudit(tx, { actor: { type: 'CUSTOMER', id: actor.subjectId },
        action: 'customer.password.change', targetId: actor.subjectId, requestId, after: { passwordChanged: true } });
      return { changed: true as const, requireLogin: true as const };
    });
  }
}
