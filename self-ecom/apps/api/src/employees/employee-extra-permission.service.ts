// 作用：在员工锁内重新认证并解析额外权限，原子替换授权、版本、审计及资格变化。
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { AccessDeniedError } from '../auth/access-denied.error.js';
import { runAuthTransaction } from '../auth/auth-transaction.js';
import { CurrentIdentityService, type CurrentIdentity } from '../auth/current-identity.service.js';
import { TokenValidationError } from '../auth/jwt-token.service.js';
import { PermissionService } from '../permissions/permission.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmployeeNotFoundError, EmployeeVersionConflictError } from './employee-command.errors.js';
import { EmployeeEligibilityService } from './employee-eligibility.service.js';
import { EmployeeExtraPermissionDto } from './employee-extra-permission.dto.js';

@Injectable()
export class EmployeeExtraPermissionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CurrentIdentityService) private readonly identities: CurrentIdentityService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EmployeeEligibilityService) private readonly eligibility: EmployeeEligibilityService) {}

  async replace(actor: CurrentIdentity, token: string, targetId: string, input: EmployeeExtraPermissionDto, requestId: string) {
    if (actor.subjectType !== 'EMPLOYEE') throw new TokenValidationError('TOKEN_SUBJECT_MISMATCH');
    return runAuthTransaction(this.prisma, async tx => {
      // 授权不改变管理员集合；直接按员工ID升序锁操作者和目标，不反向申请稳定锁。
      for (const id of [...new Set([actor.subjectId, targetId])].sort()) {
        await tx.$queryRaw`SELECT id FROM employee WHERE id=${id}::uuid FOR UPDATE`;
      }
      const current = await this.identities.authenticate(tx, token, 'EMPLOYEE');
      if (current.subjectId !== actor.subjectId || current.sessionId !== actor.sessionId) throw new TokenValidationError('TOKEN_INVALID');
      if (current.subjectType !== 'EMPLOYEE') throw new TokenValidationError('TOKEN_SUBJECT_MISMATCH');
      if (current.mustChangePassword) throw new AccessDeniedError('PASSWORD_CHANGE_REQUIRED');
      if (!current.effectivePermissions.includes('employee.permission.manage')) throw new AccessDeniedError('FORBIDDEN');
      const before = await tx.employee.findUnique({ where: { id: targetId }, select: {
        id: true, role: true, status: true, version: true, permissionVersion: true,
        extraPermissions: { select: { permissionCode: true }, orderBy: { permissionCode: 'asc' } },
      } });
      if (!before) throw new EmployeeNotFoundError();
      if (before.version !== input.expectedVersion) throw new EmployeeVersionConflictError();
      const oldExtras = before.extraPermissions.map(item => item.permissionCode);
      // 服务端权威计算完整PUT集合，未知/管理员码整次拒绝，管理员目标包括空集合也不适用。
      const resolution = this.permissions.resolveExtraPermissions(before.role, oldExtras, input.permissions);
      const resolved = resolution.resolvedExtraPermissions;
      const added = resolved.filter(code => !oldExtras.includes(code)); const removed = oldExtras.filter(code => !resolved.includes(code));
      if (added.length === 0 && removed.length === 0) return { id: targetId, ...resolution,
        version: before.version, permissionVersion: before.permissionVersion, changed: false };
      const oldEffective = this.permissions.effectivePermissions(before.role, oldExtras);
      // 只增删差集；保留未变授权关系的原授权人和时间，不把PUT伪记为全部重新授权。
      if (removed.length > 0) await tx.employeeExtraPermission.deleteMany({ where: { employeeId: targetId, permissionCode: { in: removed } } });
      if (added.length > 0) await tx.employeeExtraPermission.createMany({ data: added.map(permissionCode => ({
        employeeId: targetId, permissionCode, grantedById: current.subjectId,
      })) });
      const result = await tx.employee.update({ where: { id: targetId }, data: {
        version: { increment: 1 }, permissionVersion: { increment: 1 },
      }, select: { id: true, version: true, permissionVersion: true } });
      await this.audit.appendAudit(tx, { actor: { type: 'EMPLOYEE', id: current.subjectId }, action: 'employee.permission.replace',
        targetId, requestId, reason: input.reason, before: { extraPermissions: oldExtras }, after: { extraPermissions: resolved } });
      await this.eligibility.onEmployeeEligibilityChanged(tx, targetId,
        before.status === 'ACTIVE' ? oldEffective : [], before.status === 'ACTIVE' ? [...resolution.effectivePermissions] : [], input.reason);
      return { ...result, ...resolution, changed: true };
    });
  }
}
