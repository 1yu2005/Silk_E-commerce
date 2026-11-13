// 作用：定义真实业务的归属、经办人、锁与状态迁移接入契约；未注册适配器时明确拒绝。
import { Injectable } from '@nestjs/common';
import type { BusinessAggregateType, CommunicationScopeType, Prisma } from '@prisma/client';
import type { AuditActor } from '../audit/audit.service.js';
import type { CurrentIdentity } from '../auth/current-identity.service.js';
import { BusinessModuleNotReadyError, RecordInputError } from './record-support.js';

export interface StateTransition {
  aggregateType: BusinessAggregateType;
  aggregateId: string;
  dimension: string;
  commandKey: string;
  fromState: string | null;
  toState: string;
  requestId: string;
  reason?: string | null;
  publicText?: string | null;
}
export type CommunicationAccessMode = 'WRITE' | 'INTERNAL_READ' | 'PUBLIC_READ';
export interface CommunicationScopeAdapter {
  readonly scopeType: CommunicationScopeType;
  /** 已锁主体；此处按全局锁序锁真实业务，验证存在、顾客归属、服务范围及经办人。不得自行提交事务。 */
  lockAndAuthorize(tx: Prisma.TransactionClient, actor: CurrentIdentity, scopeId: string, mode: CommunicationAccessMode): Promise<void>;
}
export interface StateHistoryAdapter {
  readonly aggregateType: BusinessAggregateType;
  /** 领域命令先完成主体授权；此处在同事务校验真实聚合与合法迁移，领域变更须与历史一起提交。 */
  lockAndValidate(tx: Prisma.TransactionClient, actor: AuditActor, transition: Readonly<StateTransition>): Promise<void>;
}

@Injectable()
export class BusinessRecordAdapters {
  private readonly scopes = new Map<CommunicationScopeType, CommunicationScopeAdapter>();
  private readonly histories = new Map<BusinessAggregateType, StateHistoryAdapter>();

  // 由真实领域模块启动时显式注册；生产模块不导入测试适配器。
  registerCommunication(adapter: CommunicationScopeAdapter): void {
    if (!['ORDER', 'AFTER_SALE'].includes(adapter.scopeType) || typeof adapter.lockAndAuthorize !== 'function'
      || this.scopes.has(adapter.scopeType)) throw new RecordInputError('沟通适配器无效或重复注册');
    this.scopes.set(adapter.scopeType, adapter);
  }
  registerStateHistory(adapter: StateHistoryAdapter): void {
    if (!['ORDER', 'FULFILLMENT', 'AFTER_SALE'].includes(adapter.aggregateType) || typeof adapter.lockAndValidate !== 'function'
      || this.histories.has(adapter.aggregateType)) throw new RecordInputError('状态适配器无效或重复注册');
    this.histories.set(adapter.aggregateType, adapter);
  }
  communication(type: CommunicationScopeType): CommunicationScopeAdapter {
    const adapter = this.scopes.get(type);
    if (!adapter) throw new BusinessModuleNotReadyError();
    return adapter;
  }
  stateHistory(type: BusinessAggregateType): StateHistoryAdapter {
    const adapter = this.histories.get(type);
    if (!adapter) throw new BusinessModuleNotReadyError();
    return adapter;
  }
}
