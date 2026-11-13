// 作用：复用领域事务追加状态历史；不替代领域状态机、业务幂等结果或资金库存事实。
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuditActor } from '../audit/audit.service.js';
import { BusinessRecordAdapters, type StateTransition } from './business-record-adapters.js';
import { optionalRecordText, recordId, RecordInputError, recordObject, recordText, requireRecordTransaction } from './record-support.js';

@Injectable()
export class StateHistoryService {
  constructor(@Inject(BusinessRecordAdapters) private readonly adapters: BusinessRecordAdapters) {}

  async appendStateHistory(tx: Prisma.TransactionClient, actor: AuditActor, input: StateTransition) {
    requireRecordTransaction(tx);
    recordObject(input, ['aggregateType', 'aggregateId', 'dimension', 'commandKey', 'fromState', 'toState', 'requestId', 'reason', 'publicText']);
    if (!actor || !['EMPLOYEE', 'CUSTOMER', 'SYSTEM'].includes(actor.type)
      || !['PRODUCT', 'ORDER', 'FULFILLMENT', 'AFTER_SALE'].includes(input.aggregateType)) throw new RecordInputError();
    recordObject(actor, actor.type === 'SYSTEM' ? ['type'] : ['type', 'id']);
    const checkedActor: AuditActor = actor.type === 'SYSTEM' ? { type: 'SYSTEM' } : { type: actor.type, id: recordId(actor.id) };
    const transition = Object.freeze({ aggregateType: input.aggregateType, aggregateId: recordId(input.aggregateId),
      dimension: recordText(input.dimension, 50), commandKey: recordText(input.commandKey, 150),
      fromState: input.fromState === null ? null : recordText(input.fromState, 80), toState: recordText(input.toState, 80),
      requestId: recordId(input.requestId), reason: optionalRecordText(input.reason, 500), publicText: optionalRecordText(input.publicText, 2000) });
    await this.adapters.stateHistory(transition.aggregateType).lockAndValidate(tx, checkedActor, transition);
    // 相同动作键的数据库唯一冲突向上抛出，不能据此假装领域命令已经成功重放。
    return tx.businessStateHistory.create({ data: { ...transition, actorType: checkedActor.type,
      actorEmployeeId: checkedActor.type === 'EMPLOYEE' ? checkedActor.id : null,
      actorCustomerId: checkedActor.type === 'CUSTOMER' ? checkedActor.id : null }, select: { id: true } });
  }
}
