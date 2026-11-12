// 作用：在员工锁内重新认证并按版本修改显示名，原子写入原因和差异审计。
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { AccessDeniedError } from '../auth/access-denied.error.js';
import { runAuthTransaction } from '../auth/auth-transaction.js';
import { CurrentIdentityService, type CurrentIdentity } from '../auth/current-identity.service.js';
import { TokenValidationError } from '../auth/jwt-token.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmployeeNotFoundError, EmployeeVersionConflictError } from './employee-command.errors.js';
import { EmployeeProfileDto } from './employee-profile.dto.js';

@Injectable()
export class EmployeeProfileService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CurrentIdentityService) private readonly identities: CurrentIdentityService,
    @Inject(AuditService) private readonly audit: AuditService) {}

  async update(actor: CurrentIdentity, token: string, targetId: string, input: EmployeeProfileDto, requestId: string) {
    if (actor.subjectType !== 'EMPLOYEE') throw new TokenValidationError('TOKEN_SUBJECT_MISMATCH');
    return runAuthTransaction(this.prisma, async tx => {
      // 不改变管理员集合；只按全局ID顺序锁涉及员工，同一员工去重。
      for (const id of [...new Set([actor.subjectId, targetId])].sort()) {
        await tx.$queryRaw`SELECT id FROM employee WHERE id=${id}::uuid FOR UPDATE`;
      }
      // 即使目标不存在，也先复核操作者，不能用404泄漏目标存在性。
      const current = await this.identities.authenticate(tx, token, 'EMPLOYEE');
      if (current.subjectId !== actor.subjectId || current.sessionId !== actor.sessionId) throw new TokenValidationError('TOKEN_INVALID');
      if (current.subjectType !== 'EMPLOYEE') throw new TokenValidationError('TOKEN_SUBJECT_MISMATCH');
      if (current.mustChangePassword) throw new AccessDeniedError('PASSWORD_CHANGE_REQUIRED');
      if (!current.effectivePermissions.includes('employee.profile.update')) throw new AccessDeniedError('FORBIDDEN');
      const select = { id: true, username: true, displayName: true, role: true, status: true,
        mustChangePassword: true, version: true, createdAt: true, lastLoginAt: true } as const;
      const before = await tx.employee.findUnique({ where: { id: targetId }, select });
      if (!before) throw new EmployeeNotFoundError();
      if (before.version !== input.expectedVersion) throw new EmployeeVersionConflictError();
      if (before.displayName === input.displayName) return before;
      const employee = await tx.employee.update({ where: { id: targetId },
        data: { displayName: input.displayName, version: { increment: 1 } }, select });
      await this.audit.appendAudit(tx, { actor: { type: 'EMPLOYEE', id: current.subjectId },
        action: 'employee.profile.update', targetId, requestId, reason: input.reason,
        before: { displayName: before.displayName }, after: { displayName: employee.displayName } });
      return employee;
    });
  }
}
