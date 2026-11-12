// 作用：保护最后可用管理员，原子调岗、清空额外权限并提交版本、审计和资格变化。
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { AccessDeniedError } from '../auth/access-denied.error.js';
import { runAuthTransaction } from '../auth/auth-transaction.js';
import { CurrentIdentityService, type CurrentIdentity } from '../auth/current-identity.service.js';
import { TokenValidationError } from '../auth/jwt-token.service.js';
import { PermissionService } from '../permissions/permission.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmployeeLastAdminRequiredError, EmployeeNotFoundError, EmployeeVersionConflictError } from './employee-command.errors.js';
import { EmployeeEligibilityService } from './employee-eligibility.service.js';
import { EmployeeRoleDto } from './employee-role.dto.js';

@Injectable()
export class EmployeeRoleService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CurrentIdentityService) private readonly identities: CurrentIdentityService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EmployeeEligibilityService) private readonly eligibility: EmployeeEligibilityService) {}

  async change(actor: CurrentIdentity, token: string, targetId: string, input: EmployeeRoleDto, requestId: string) {
    if (actor.subjectType !== 'EMPLOYEE') throw new TokenValidationError('TOKEN_SUBJECT_MISMATCH');
    return runAuthTransaction(this.prisma, async tx => {
      // 不按易变目标岗位决定是否取锁；调岗统一先稳定锁，再锁涉及员工。
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
      if (!current.effectivePermissions.includes('employee.role.change')) throw new AccessDeniedError('FORBIDDEN');
      const before = await tx.employee.findUnique({ where: { id: targetId }, select: {
        id: true, role: true, status: true, version: true, permissionVersion: true,
        extraPermissions: { select: { permissionCode: true }, orderBy: { permissionCode: 'asc' } },
      } });
      if (!before) throw new EmployeeNotFoundError();
      if (before.version !== input.expectedVersion) throw new EmployeeVersionConflictError();
      const oldExtras = before.extraPermissions.map(item => item.permissionCode);
      if (before.role === input.role) return { id: targetId, role: before.role, extraPermissions: oldExtras,
        version: before.version, permissionVersion: before.permissionVersion, changed: false };
      const activeAdmins = await tx.employee.count({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE' } });
      if (before.status === 'ACTIVE' && before.role === 'SUPER_ADMIN' && input.role !== 'SUPER_ADMIN' && activeAdmins <= 1) {
        throw new EmployeeLastAdminRequiredError();
      }
      const oldEffective = this.permissions.effectivePermissions(before.role, oldExtras);
      const newEffective = this.permissions.effectivePermissions(input.role, []);
      await tx.employeeExtraPermission.deleteMany({ where: { employeeId: targetId } });
      const result = await tx.employee.update({ where: { id: targetId }, data: {
        role: input.role, version: { increment: 1 }, permissionVersion: { increment: 1 },
      }, select: { id: true, role: true, version: true, permissionVersion: true } });
      if (await tx.employee.count({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE' } }) < 1) throw new EmployeeLastAdminRequiredError();
      await this.audit.appendAudit(tx, { actor: { type: 'EMPLOYEE', id: current.subjectId }, action: 'employee.role.change',
        targetId, requestId, reason: input.reason, before: { role: before.role, extraPermissions: oldExtras },
        after: { role: input.role, extraPermissions: [] } });
      // 永久业务资格按启停状态折算，强制改密仍由Guard独立限制；失败必须连同授权清空一起回滚。
      await this.eligibility.onEmployeeEligibilityChanged(tx, targetId,
        before.status === 'ACTIVE' ? oldEffective : [], before.status === 'ACTIVE' ? newEffective : [], input.reason);
      return { ...result, extraPermissions: [], changed: true };
    });
  }
}
