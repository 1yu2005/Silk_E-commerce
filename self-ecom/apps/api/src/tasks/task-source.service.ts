// 作用：多个真实来源共用一个阶段任务；仅最后来源结束才按领域规则终结任务，所有写入复用调用方事务。
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { checkedId } from '../auth/session-support.js';
import { Clock } from '../common/time/clock.js';
import { TaskBusinessAdapters, type TaskBusinessReference, type TaskStageEntry } from './task-business-adapters.js';
import { TaskEntryService, type TaskEntryContext } from './task-entry.service.js';
import { lockedContextTask, taskAuditActor, TaskLifecycleService, taskText, taskVersion } from './task-lifecycle.service.js';
import { TASK_SOURCE_TYPES, taskActorKey, type TaskSourceReference } from './task-source.contract.js';
import { TaskError } from './task.errors.js';

export interface TaskSourceInput extends TaskBusinessReference, TaskSourceReference {
  readonly taskId: string; readonly expectedVersion: number; readonly commandKey: string; readonly reason: string;
}
@Injectable()
export class TaskSourceService {
  constructor(@Inject(TaskEntryService) private readonly entry: TaskEntryService, @Inject(TaskLifecycleService) private readonly lifecycle: TaskLifecycleService,
    @Inject(TaskBusinessAdapters) private readonly adapters: TaskBusinessAdapters, @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Clock) private readonly clock: Clock) {}
  /** 同阶段新增来源复用现有有效任务；真正的新阶段仍由enterStage验证与建立轮次。 */
  attach(context: TaskEntryContext, input: TaskStageEntry & TaskSourceReference) {
    return this.entry.inContext(context, input, async scope => {
      this.adapters.requireSources(input.businessType);
      const active = await scope.tx.task.findFirst({ where: { businessType: input.businessType, businessId: input.businessId, stage: input.stage, status: { in: ['OPEN', 'CLAIMED', 'SUSPENDED'] } } });
      const task = active ?? (await this.entry.enterStage(context, input)).task;
      return this.add(context, { ...input, taskId: task.id, expectedVersion: task.version, commandKey: input.entryKey });
    });
  }
  add(context: TaskEntryContext, input: TaskSourceInput) { return this.change(context, input, 'ACTIVE'); }
  resolve(context: TaskEntryContext, input: TaskSourceInput, outcome: 'COMPLETED' | 'CANCELLED' = 'COMPLETED') { return this.change(context, input, 'RESOLVED', outcome); }
  cancel(context: TaskEntryContext, input: TaskSourceInput, outcome: 'COMPLETED' | 'CANCELLED' = 'CANCELLED') { return this.change(context, input, 'CANCELLED', outcome); }
  private change(context: TaskEntryContext, input: TaskSourceInput, status: 'ACTIVE' | 'RESOLVED' | 'CANCELLED', outcome?: 'COMPLETED' | 'CANCELLED') {
    const source = { sourceType: input.sourceType, sourceId: checkedId(input.sourceId) };
    if (!TASK_SOURCE_TYPES.includes(source.sourceType) || (outcome && !['COMPLETED', 'CANCELLED'].includes(outcome))) throw new TaskError('TASK_INPUT_INVALID');
    const commandKey = taskText(input.commandKey, 150); const reason = taskText(input.reason, 500); taskVersion(input.expectedVersion);
    return this.entry.inContext(context, input, async scope => {
      const { tx, requestId } = scope; let task = await lockedContextTask(scope, input, input.taskId);
      const port = this.adapters.requireSources(task.businessType); await port.assertSource(tx, scope.actor, task, source);
      const prior = await port.find(tx, task, source); const actor = await scope.revalidate(); const actorKey = taskActorKey(actor);
      if (prior && (status === 'ACTIVE' ? prior.addCommandKey === commandKey && prior.addReason === reason && prior.addActorKey === actorKey
        : prior.status === status && prior.resolutionCommandKey === commandKey && prior.resolutionReason === reason && prior.resolutionActorKey === actorKey && prior.resolutionOutcome === outcome)) {
        return { changed: false, task, source: prior };
      }
      if (task.version !== input.expectedVersion) throw new TaskError('VERSION_CONFLICT');
      if (['COMPLETED', 'CANCELLED'].includes(task.status)) throw new TaskError('TASK_TRANSITION_BLOCKED');
      if (status === 'ACTIVE' ? !!prior : !prior || prior.status !== 'ACTIVE') throw new TaskError('TASK_SOURCE_CONFLICT');
      const metadata = { commandKey, reason, requestId, actor, now: this.clock.now(), outcome };
      const result = status === 'ACTIVE' ? await port.add(tx, task, source, metadata) : await port.finish(tx, task, prior!, status, metadata);
      const finalActor = await scope.revalidate();
      await this.audit.appendAudit(tx, { actor: taskAuditActor(finalActor), action: status === 'ACTIVE' ? 'task.source.add' : status === 'RESOLVED' ? 'task.source.resolve' : 'task.source.cancel',
        targetId: task.id, requestId, reason, after: { sourceType: source.sourceType, sourceId: source.sourceId, sourceStatus: result.status } });
      if (status !== 'ACTIVE' && !(await port.listActive(tx, task)).length) task = (await this.lifecycle.transition(context, { ...input, taskId: task.id,
        action: outcome!, expectedVersion: task.version, commandKey, reason })).task;
      return { changed: true, task, source: result };
    });
  }
}
