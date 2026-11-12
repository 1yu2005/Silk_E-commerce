// 作用：重新验证操作者后原子创建员工和最小审计，并保护管理员集合并发。
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { AccessDeniedError } from '../auth/access-denied.error.js';
import { runAuthTransaction } from '../auth/auth-transaction.js';
import { CurrentIdentityService, type CurrentIdentity } from '../auth/current-identity.service.js';
import { TokenValidationError } from '../auth/jwt-token.service.js';
import { PasswordService } from '../auth/password.service.js';
import { lockSessionSubject } from '../auth/session-support.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmployeeUsernameExistsError } from './employee-command.errors.js';
import { EmployeeCreateDto } from './employee-create.dto.js';

@Injectable()
export class EmployeeCreateService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(CurrentIdentityService) private readonly identities: CurrentIdentityService,
    @Inject(AuditService) private readonly audit: AuditService) {}

  async create(actor: CurrentIdentity, token: string, input: EmployeeCreateDto, requestId: string) {
    if (actor.subjectType !== 'EMPLOYEE') throw new TokenValidationError('TOKEN_SUBJECT_MISMATCH');
    // 密码CPU工作在事务外；Guard结果不能代替锁内的最新身份及权限核验。
    const passwordHash = await this.passwords.hash(input.initialPassword);
    return runAuthTransaction(this.prisma, async tx => {
      if (input.role === 'SUPER_ADMIN') {
        const rows = await tx.$queryRaw<{ key: string }[]>`
          SELECT key FROM system_guard WHERE key='ADMIN_AVAILABILITY' FOR UPDATE`;
        if (rows.length !== 1) throw new Error('管理员稳定锁行缺失');
      }
      // 新目标尚不存在；只锁实际操作者。管理员稳定锁必须在员工锁之前取得。
      await lockSessionSubject(tx, actor);
      const current = await this.identities.authenticate(tx, token, 'EMPLOYEE');
      if (current.subjectId !== actor.subjectId || current.sessionId !== actor.sessionId) throw new TokenValidationError('TOKEN_INVALID');
      if (current.subjectType !== 'EMPLOYEE') throw new TokenValidationError('TOKEN_SUBJECT_MISMATCH');
      if (current.mustChangePassword) throw new AccessDeniedError('PASSWORD_CHANGE_REQUIRED');
      if (!current.effectivePermissions.includes('employee.create')) throw new AccessDeniedError('FORBIDDEN');
      const employee = await tx.employee.create({ data: {
        username: input.username, displayName: input.displayName, role: input.role, passwordHash,
        status: 'ACTIVE', mustChangePassword: true, tokenVersion: 0, permissionVersion: 0, version: 0,
      }, select: { id: true, username: true, displayName: true, role: true, status: true,
        mustChangePassword: true, version: true, createdAt: true, lastLoginAt: true },
      }).catch((error: unknown) => {
        // 仅在此无客户端ID的员工插入处映射唯一冲突；审计等其它写入错误保持原失败。
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new EmployeeUsernameExistsError();
        throw error;
      });
      await this.audit.appendAudit(tx, { actor: { type: 'EMPLOYEE', id: current.subjectId },
        action: 'employee.create', targetId: employee.id, requestId, reason: input.reason,
        after: { username: employee.username, displayName: employee.displayName, role: employee.role,
          status: employee.status, mustChangePassword: employee.mustChangePassword } });
      return employee;
    });
  }
}
