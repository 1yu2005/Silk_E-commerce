// 作用：锁定并重新认证当前顾客，原子修改本人昵称与写入最小审计。
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { runAuthTransaction } from './auth-transaction.js';
import { CurrentIdentityService, type CurrentIdentity } from './current-identity.service.js';
import { CustomerProfileDto } from './customer-profile.dto.js';
import { TokenValidationError } from './jwt-token.service.js';
import { lockSessionSubject } from './session-support.js';

@Injectable()
export class CustomerProfileService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CurrentIdentityService) private readonly identities: CurrentIdentityService,
    @Inject(AuditService) private readonly audit: AuditService) {}

  async update(actor: CurrentIdentity, token: string, input: CustomerProfileDto, requestId: string) {
    if (actor.subjectType !== 'CUSTOMER') throw new TokenValidationError('TOKEN_SUBJECT_MISMATCH');
    return runAuthTransaction(this.prisma, async tx => {
      // 与改密、冻结共用顾客主体锁；写入前重新验证当前凭证，不能只相信Guard快照。
      await lockSessionSubject(tx, actor);
      const current = await this.identities.authenticate(tx, token, 'CUSTOMER');
      if (current.subjectId !== actor.subjectId || current.sessionId !== actor.sessionId) throw new TokenValidationError('TOKEN_INVALID');
      const select = { id: true, phone: true, nickname: true, status: true, createdAt: true } as const;
      const before = await tx.customer.findUniqueOrThrow({ where: { id: actor.subjectId }, select });
      if (before.nickname === input.nickname) return { ...before, avatarUrl: null };
      const customer = await tx.customer.update({ where: { id: actor.subjectId }, data: { nickname: input.nickname }, select });
      await this.audit.appendAudit(tx, { actor: { type: 'CUSTOMER', id: actor.subjectId },
        action: 'customer.profile.update', targetId: actor.subjectId, requestId,
        before: { nickname: before.nickname }, after: { nickname: customer.nickname } });
      return { ...customer, avatarUrl: null };
    });
  }
}
