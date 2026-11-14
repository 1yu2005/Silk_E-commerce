// 作用：让文件服务复用真实沟通记录及订单/售后scope授权；未注册真实scope时仍拒绝，不放宽客服边界。
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { CurrentIdentity } from '../auth/current-identity.service.js';
import { FileBusinessAdapters, type FileTarget } from '../files/file-business-adapters.js';
import { FileError } from '../files/file.errors.js';
import { OrderError } from '../orders/order.errors.js';
import { BusinessRecordAdapters } from './business-record-adapters.js';
import { BusinessModuleNotReadyError } from './record-support.js';

@Injectable()
export class CommunicationFilesAdapter implements OnModuleInit {
  constructor(@Inject(FileBusinessAdapters) private readonly files: FileBusinessAdapters,
    @Inject(BusinessRecordAdapters) private readonly records: BusinessRecordAdapters) {}
  private async record(tx: Prisma.TransactionClient, target: FileTarget) {
    const record = await tx.communication.findUnique({ where: { id: target.ownerId }, select: { scopeType: true, scopeId: true, publicText: true } });
    if (!record || target.slot !== 'evidence' || target.audience === 'PUBLIC') throw new FileError('FILE_NOT_FOUND');
    return record;
  }
  onModuleInit() {
    this.files.register({ ownerType: 'COMMUNICATION',
      aggregate: async (tx, target) => { const row = await this.record(tx, target); return `${row.scopeType}:${row.scopeId}`; },
      authorize: async (tx, actor: CurrentIdentity, target, mode) => {
        const row = await this.record(tx, target);
        if (target.audience === 'CUSTOMER_VISIBLE' && row.publicText === null) throw new FileError('FILE_INVALID_BINDING');
        if (actor.subjectType === 'CUSTOMER') {
          if (mode !== 'READ' || target.audience !== 'CUSTOMER_VISIBLE') throw new FileError('FILE_NOT_FOUND');
        } else {
          const permission = mode === 'BIND' ? 'communication.service.write' : 'order.service.read';
          if (actor.mustChangePassword || !actor.effectivePermissions.includes(permission)
            || (row.scopeType === 'AFTER_SALE' && !actor.effectivePermissions.includes('after-sale.service.read'))) throw new FileError('FILE_NOT_FOUND');
        }
        try {
          await this.records.communication(row.scopeType).lockAndAuthorize(tx, actor, row.scopeId,
            actor.subjectType === 'CUSTOMER' ? 'PUBLIC_READ' : mode === 'BIND' ? 'WRITE' : 'INTERNAL_READ');
        } catch (error) {
          if (error instanceof BusinessModuleNotReadyError) throw new FileError('FILE_BUSINESS_NOT_READY');
          // 文件入口统一隐藏真实订单不存在/不归属；不能据领域错误推断附件关联业务。
          // 只转换已知拒绝，数据库故障和其它领域冲突必须继续抛出。
          if (error instanceof OrderError && error.code === 'ORDER_NOT_FOUND') throw new FileError('FILE_NOT_FOUND');
          throw error;
        }
        if (mode === 'BIND') {
          await tx.$queryRaw`SELECT id FROM communication WHERE id=${target.ownerId}::uuid FOR UPDATE`;
          // 每条沟通最多5个附件，不依赖上传次数实现整条记录上限。
          if (await tx.fileReference.count({ where: { ownerType: 'COMMUNICATION', ownerId: target.ownerId } }) > 5) throw new FileError('FILE_INVALID_BINDING');
        }
      },
    });
  }
}
