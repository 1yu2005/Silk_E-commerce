// 作用：BR-05规则与真实领域仓储的事务桥接；复用已签发完整锁上下文，默认无订单仓储时拒绝。
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { checkedId } from '../auth/session-support.js';
import { Clock } from '../common/time/clock.js';
import type { TaskCommandActor } from './task-business-adapters.js';
import { TaskEntryService, type TaskEntryContext } from './task-entry.service.js';
import { taskAuditActor } from './task-lifecycle.service.js';
import { applyOrderTimer, type OrderTimerCommand, type OrderTimerState } from './order-timer.rules.js';
import { taskActorKey, type TaskSourceReference } from './task-source.contract.js';
import { TaskError } from './task.errors.js';
export interface OrderTimerRepository {
  /** 验证真实订单状态和动作资格；来源必须解析真实实体及其所属订单，不能只收浏览器UUID。 */
  assertAllowed(tx: Prisma.TransactionClient, actor: TaskCommandActor, orderId: string, command: OrderTimerCommand): Promise<void>;
  load(tx: Prisma.TransactionClient, orderId: string, command?: OrderTimerCommand): Promise<OrderTimerState>;
  /** 订单已由上下文锁定；须按expectedVersion保存状态、周期、阻塞、命令回执及只追加领域历史，失败抛错。 */
  save(tx: Prisma.TransactionClient, state: OrderTimerState, expectedVersion: number, command: OrderTimerCommand, actor: TaskCommandActor, requestId: string): Promise<void>;
}
@Injectable()
export class OrderTimerRepositories {
  private port?: OrderTimerRepository;
  register(port: OrderTimerRepository) {
    if (this.port || !port || !['assertAllowed', 'load', 'save'].every(key => typeof port[key as keyof OrderTimerRepository] === 'function')) throw new Error('订单暂停计时仓储不完整或重复');
    this.port = port;
  }
  require() { if (!this.port) throw new TaskError('BUSINESS_MODULE_NOT_READY'); return this.port; }
}
@Injectable()
export class OrderTimerService {
  constructor(@Inject(TaskEntryService) private readonly entry: TaskEntryService, @Inject(OrderTimerRepositories) private readonly repositories: OrderTimerRepositories,
    @Inject(Clock) private readonly clock: Clock, @Inject(AuditService) private readonly audit: AuditService) {}
  addBlock(context: TaskEntryContext, orderId: string, source: TaskSourceReference, metadata: Pick<OrderTimerCommand, 'commandKey' | 'reason'>) {
    return this.apply(context, orderId, { ...metadata, action: 'ADD_BLOCK', source });
  }
  releaseBlock(context: TaskEntryContext, orderId: string, source: TaskSourceReference, metadata: Pick<OrderTimerCommand, 'commandKey' | 'reason'>) {
    return this.apply(context, orderId, { ...metadata, action: 'RELEASE_BLOCK', source });
  }
  recordActualHandover(context: TaskEntryContext, orderId: string, actualAt: Date, metadata: Pick<OrderTimerCommand, 'commandKey' | 'reason'>) {
    return this.apply(context, orderId, { ...metadata, action: 'RECORD_HANDOVER', actualAt });
  }
  finishOrderTimer(context: TaskEntryContext, orderId: string, terminal: 'COMPLETED' | 'REFUNDED', metadata: Pick<OrderTimerCommand, 'commandKey' | 'reason'>) {
    return this.apply(context, orderId, { ...metadata, action: 'FINISH', terminal });
  }
  apply(context: TaskEntryContext, orderId: string, command: OrderTimerCommand) {
    orderId = checkedId(orderId);
    return this.entry.inContext(context, { businessType: 'ORDER', businessId: orderId }, async scope => {
      const port = this.repositories.require(); await port.assertAllowed(scope.tx, scope.actor, orderId, command);
      const before = await port.load(scope.tx, orderId, command);
      if (before.orderId !== orderId) throw new TaskError('ORDER_TIMER_STATE_INVALID');
      let actor = await scope.revalidate();
      const result = applyOrderTimer(before, command, this.clock.now(), taskActorKey(actor)); if (!result.changed) return result;
      await port.save(scope.tx, result.state, before.version, command, actor, scope.requestId);
      actor = await scope.revalidate();
      const fields = (state: OrderTimerState) => ({ dueAt: state.dueAt?.toISOString() ?? null, timerState: state.status,
        cycleNo: state.pauses.length, remainingMs: state.pauses.find(row => row.status === 'ACTIVE')?.remainingMs ?? null });
      const action = ({ ADD_BLOCK: 'order.timer.block.add', RELEASE_BLOCK: 'order.timer.block.release', RECORD_HANDOVER: 'order.timer.handover.record', FINISH: 'order.timer.finish' } as const)[command.action];
      await this.audit.appendAudit(scope.tx, { actor: taskAuditActor(actor), action, targetId: orderId, requestId: scope.requestId, reason: command.reason,
        before: fields(before), after: fields(result.state) }); return result;
    });
  }
}
