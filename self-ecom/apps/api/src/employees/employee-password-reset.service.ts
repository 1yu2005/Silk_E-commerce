// 作用：在员工锁内重新认证并重置他人密码，原子撤销全部会话并强制再次改密。
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { AccessDeniedError } from '../auth/access-denied.error.js';
import { AuthSessionService } from '../auth/auth-session.service.js';
import { runAuthTransaction } from '../auth/auth-transaction.js';
import { CurrentIdentityService, type CurrentIdentity } from '../auth/current-identity.service.js';
import { TokenValidationError } from '../auth/jwt-token.service.js';
import { PasswordInputError, PasswordService } from '../auth/password.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmployeeNotFoundError, EmployeeSelfPasswordResetError, EmployeeVersionConflictError } from './employee-command.errors.js';
import { EmployeePasswordResetDto } from './employee-password-reset.dto.js';

@Injectable()
export class EmployeePasswordResetService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(CurrentIdentityService) private readonly identities: CurrentIdentityService,
    @Inject(AuthSessionService) private readonly sessions: AuthSessionService,
    @Inject(AuditService) private readonly audit: AuditService) {}

  async reset(actor: CurrentIdentity, token: string, targetId: string, input: EmployeePasswordResetDto, requestId: string) {
    if (actor.subjectType !== 'EMPLOYEE') throw new TokenValidationError('TOKEN_SUBJECT_MISMATCH');
    // 比较和哈希都在事务外；目标错误留到锁内重验操作者后处理，避免旧身份探查目标。
    const snapshot = await this.prisma.employee.findUnique({ where: { id: targetId }, select: { passwordHash: true } });
    const unchanged = snapshot ? await this.passwords.verify(input.temporaryPassword, snapshot.passwordHash) : false;
    const passwordHash = await this.passwords.hash(input.temporaryPassword);
    return runAuthTransaction(this.prisma, async tx => {
      // 重置不改变ACTIVE管理员集合或永久业务资格，不申请稳定锁，也不调用资格回池入口。
      for (const id of [...new Set([actor.subjectId, targetId])].sort()) {
        await tx.$queryRaw`SELECT id FROM employee WHERE id=${id}::uuid FOR UPDATE`;
      }
      const current = await this.identities.authenticate(tx, token, 'EMPLOYEE');
      if (current.subjectId !== actor.subjectId || current.sessionId !== actor.sessionId) throw new TokenValidationError('TOKEN_INVALID');
      if (current.subjectType !== 'EMPLOYEE') throw new TokenValidationError('TOKEN_SUBJECT_MISMATCH');
      if (current.mustChangePassword) throw new AccessDeniedError('PASSWORD_CHANGE_REQUIRED');
      if (!current.effectivePermissions.includes('employee.password.reset')) throw new AccessDeniedError('FORBIDDEN');
      if (targetId === current.subjectId) throw new EmployeeSelfPasswordResetError();
      const before = await tx.employee.findUnique({ where: { id: targetId },
        select: { version: true, passwordHash: true, mustChangePassword: true } });
      if (!before) throw new EmployeeNotFoundError();
      if (before.version !== input.expectedVersion || before.passwordHash !== snapshot?.passwordHash) throw new EmployeeVersionConflictError();
      if (unchanged) throw new PasswordInputError({ code: 'PASSWORD_UNCHANGED', message: '新密码不得与旧密码相同' });
      const result = await tx.employee.update({ where: { id: targetId }, data: {
        passwordHash, mustChangePassword: true, tokenVersion: { increment: 1 }, version: { increment: 1 },
      }, select: { id: true, mustChangePassword: true, version: true } });
      await this.sessions.revokeAll(tx, { subjectType: 'EMPLOYEE', subjectId: targetId }, 'PASSWORD_RESET');
      await this.audit.appendAudit(tx, { actor: { type: 'EMPLOYEE', id: current.subjectId }, action: 'employee.password.reset',
        targetId, requestId, reason: input.reason, before: { mustChangePassword: before.mustChangePassword },
        after: { passwordChanged: true, mustChangePassword: true } });
      return result;
    });
  }
}
