// 作用：注册真实业务的文件归属解析器；未实现领域默认拒绝，禁止以任意UUID建立引用。
import { Injectable } from '@nestjs/common';
import type { FileAudience, FileOwnerType, Prisma } from '@prisma/client';
import type { CurrentIdentity } from '../auth/current-identity.service.js';
import { FileError } from './file.errors.js';

export interface FileTarget { ownerType: FileOwnerType; ownerId: string; slot: string; audience: FileAudience }
export interface FileBusinessAdapter {
  ownerType: FileOwnerType;
  /** 聚合标识必须来自不可变的真实关联；此只读方法不得在文件锁后反向取得业务锁。 */
  aggregate(tx: Prisma.TransactionClient, target: FileTarget): Promise<string>;
  /** 上层已锁主体；在文件锁前验证真实业务、归属、状态、经办人、数量及用途细分权限。 */
  authorize(tx: Prisma.TransactionClient, actor: CurrentIdentity, target: FileTarget, mode: 'BIND' | 'READ'): Promise<void>;
}
@Injectable()
export class FileBusinessAdapters {
  private readonly adapters = new Map<FileOwnerType, FileBusinessAdapter>();
  constructor() {
    // 顾客表已存在，可真实校验头像；后续头像命令仍负责当前指针与审计的同事务更新。
    this.register({ ownerType: 'CUSTOMER_AVATAR',
      async aggregate(tx, target) {
        if (!await tx.customer.findUnique({ where: { id: target.ownerId }, select: { id: true } })) throw new FileError('FILE_NOT_FOUND');
        return `CUSTOMER:${target.ownerId}`;
      },
      async authorize(tx, actor, target) {
        if (actor.subjectType !== 'CUSTOMER' || actor.subjectId !== target.ownerId || target.slot !== 'avatar' || target.audience !== 'PUBLIC') {
          throw new FileError('FILE_NOT_FOUND');
        }
        await tx.$queryRaw`SELECT id FROM customer WHERE id=${target.ownerId}::uuid FOR UPDATE`;
      },
    });
  }
  register(adapter: FileBusinessAdapter) {
    if (this.adapters.has(adapter.ownerType)) throw new Error('文件业务解析器不得重复注册');
    this.adapters.set(adapter.ownerType, adapter);
  }
  get(type: FileOwnerType) {
    const adapter = this.adapters.get(type);
    if (!adapter) throw new FileError('FILE_BUSINESS_NOT_READY');
    return adapter;
  }
}
