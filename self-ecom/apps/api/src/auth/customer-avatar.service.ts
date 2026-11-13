// 作用：锁定当前顾客，在同一事务中更新头像、保留历史引用并写审计；无变化命令不重复写入。
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { FileAccessService, type FileAccess } from '../files/file-access.service.js';
import { FileBindingService } from '../files/file-binding.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { runAuthTransaction } from './auth-transaction.js';
import { TokenValidationError } from './jwt-token.service.js';

@Injectable()
export class CustomerAvatarService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FileAccessService) private readonly access: FileAccessService,
    @Inject(FileBindingService) private readonly files: FileBindingService,
    @Inject(AuditService) private readonly audit: AuditService) {}
  async change(access: FileAccess, fileId: string | null, requestId: string) {
    if (access.identity.subjectType !== 'CUSTOMER') throw new TokenValidationError('TOKEN_SUBJECT_MISMATCH');
    return runAuthTransaction(this.prisma, async tx => {
      const actor = await this.access.current(tx, access);
      const before = await tx.customer.findUniqueOrThrow({ where: { id: actor.subjectId }, select: { avatarAssetId: true } });
      if (fileId !== null) {
        const [reference] = await this.files.bindFiles(tx, access, { ownerType: 'CUSTOMER_AVATAR', ownerId: actor.subjectId,
          slot: 'avatar', audience: 'PUBLIC', fileIds: [fileId], commandKey: requestId });
        if (!reference) throw new Error('头像绑定未返回引用');
        fileId = reference.fileId;
      }
      const changed = before.avatarAssetId !== fileId;
      if (changed) {
        await tx.customer.update({ where: { id: actor.subjectId }, data: { avatarAssetId: fileId } });
        await this.audit.appendAudit(tx, { actor: { type: 'CUSTOMER', id: actor.subjectId }, action: 'customer.avatar.change',
          targetId: actor.subjectId, requestId, before: { avatarAssetId: before.avatarAssetId }, after: { avatarAssetId: fileId } });
      }
      return { avatarAssetId: fileId, avatarUrl: fileId ? `/api/v1/files/${fileId}/content` : null, changed };
    });
  }
}
