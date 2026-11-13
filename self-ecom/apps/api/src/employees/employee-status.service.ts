// 作用：保护最后可用管理员，原子启停员工并处理版本、会话撤销、审计和资格变化。
import { Inject, Injectable } from '@nestjs/common';
import type { EmployeeStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { AccessDeniedError } from '../auth/access-denied.error.js';
import { AuthSessionService } from '../auth/auth-session.service.js';
import { runAuthTransaction } from '../auth/auth-transaction.js';
import { CurrentIdentityService, type CurrentIdentity } from '../auth/current-identity.service.js';
import { TokenValidationError } from '../auth/jwt-token.service.js';
import { PermissionService } from '../permissions/permission.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmployeeLastAdminRequiredError, EmployeeNotFoundError, EmployeeVersionConflictError } from './employee-command.errors.js';
import { EmployeeEligibilityService } from './employee-eligibility.service.js';
import { EmployeeStatusDto } from './employee-status.dto.js';
import { TaskError } from '../tasks/task.errors.js';

@Injectable()
export class EmployeeStatusService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CurrentIdentityService) private readonly identities: CurrentIdentityService,
    @Inject(AuthSessionService) private readonly sessions: AuthSessionService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EmployeeEligibilityService) private readonly eligibility: EmployeeEligibilityService) {}

  async change(actor: CurrentIdentity, token: string, targetId: string, nextStatus: EmployeeStatus,
    input: EmployeeStatusDto, requestId: string) {
    if (actor.subjectType !== 'EMPLOYEE') throw new TokenValidationError('TOKEN_SUBJECT_MISMATCH');
    return runAuthTransaction(this.prisma, async tx => {
      // 在读取易变目标岗位之前统一取稳定锁，禁止持员工锁后再反向申请管理员锁。
      const guards = await tx.$queryRaw<{ key: string }[]>`
        SELECT key FROM system_guard WHERE key='ADMIN_AVAILABILITY' FOR UPDATE`;
      if (guards.length !== 1) throw new Error('管理员稳定锁行缺失');
      for (const id of [...new Set([actor.subjectId, targetId])].sort()) {
        await tx.$queryRaw`SELECT id FROM employee WHERE id=${id}::uuid FOR UPDATE`;
      }
      const current = await this.identities.authenticate(tx, token, 'EMPLOYEE');
      if (current.subjectId !== actor.subjectId || current.sessionId !== actor.sessionId) throw new TokenValidationError('TOKEN_INVALID');
      if (current.subjectType !== 'EMPLOYEE') throw new TokenValidationError('TOKEN_SUBJECT_MISMATCH');
      if (current.mustChangePassword) throw new AccessDeniedError('PASSWORD_CHANGE_REQUIRED');
      if (!current.effectivePermissions.includes('employee.status.manage')) throw new AccessDeniedError('FORBIDDEN');
      const before = await tx.employee.findUnique({ where: { id: targetId }, select: { id: true, role: true, status: true,
        version: true, extraPermissions: { select: { permissionCode: true } } } });
      if (!before) throw new EmployeeNotFoundError();
      if (before.version !== input.expectedVersion) throw new EmployeeVersionConflictError();
      if (before.status === nextStatus) return { id: targetId, status: before.status, version: before.version, changed: false };
      const activeAdmins = await tx.employee.count({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE' } });
      if (nextStatus === 'DISABLED' && before.role === 'SUPER_ADMIN' && activeAdmins <= 1) throw new EmployeeLastAdminRequiredError();
      const effective = this.permissions.effectivePermissions(before.role, before.extraPermissions.map(item => item.permissionCode));
      const nextEffective = nextStatus === 'ACTIVE' ? [...effective] : [];
      const taskContext = await this.eligibility.prepare(tx, targetId, nextEffective, {
        actor: current, token, permission: 'employee.status.manage', reason: input.reason, requestId,
      });
      const result = await tx.employee.update({ where: { id: targetId }, data: {
        status: nextStatus, version: { increment: 1 }, ...(nextStatus === 'DISABLED' ? { tokenVersion: { increment: 1 } } : {}),
      }, select: { id: true, status: true, version: true } });
      if (await tx.employee.count({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE' } }) < 1) throw new EmployeeLastAdminRequiredError();
      if (nextStatus === 'DISABLED') await this.sessions.revokeAll(tx, { subjectType: 'EMPLOYEE', subjectId: targetId }, 'ACCOUNT_DISABLED');
      await this.audit.appendAudit(tx, { actor: { type: 'EMPLOYEE', id: current.subjectId },
        action: nextStatus === 'DISABLED' ? 'employee.disable' : 'employee.enable', targetId, requestId, reason: input.reason,
        before: { status: before.status }, after: { status: nextStatus } });
      // 资格变更以状态折算可用能力；岗位模板/个人授权原样保留，强制改密仍由Guard独立限制。
      await this.eligibility.onEmployeeEligibilityChanged(tx, targetId,
        before.status === 'ACTIVE' ? [...effective] : [], nextEffective, input.reason, taskContext);
      return { ...result, changed: true };
    }, error => error instanceof TaskError && error.code === 'TASK_LOCK_PLAN_CHANGED');
  }
}
