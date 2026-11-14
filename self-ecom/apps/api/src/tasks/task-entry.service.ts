// 作用：在业务自己的事务内按主体→完整领域锁计划→游标/任务进入阶段，原子保存轮次、快照、历史与审计。
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, Task } from '@prisma/client';
import { AuditService, type AuditActor } from '../audit/audit.service.js';
import { AccessDeniedError } from '../auth/access-denied.error.js';
import { CurrentIdentityService } from '../auth/current-identity.service.js';
import { TokenValidationError } from '../auth/jwt-token.service.js';
import { checkedId, requireSessionTransaction } from '../auth/session-support.js';
import { Clock } from '../common/time/clock.js';
import { BUSINESS_TIME_ZONE, calculateDeadline, DEADLINE_ALGORITHM_VERSION } from '../common/time/deadline.js';
import { StoreSettingsService } from '../settings/store-settings.service.js';
import { businessKey, checkedBusiness, TaskBusinessAdapters,
  type TaskBusinessReference, type TaskCommandActor, type TaskStageEntry, type TaskLockResource } from './task-business-adapters.js';
import { TASK_STAGE_CATALOG_VERSION, taskStageDefinition } from './task-stage.catalog.js';
import { TaskError } from './task.errors.js';
import { TaskLockService } from './task-lock.service.js';
import { TaskDeadlineEventsService } from './task-deadline-events.service.js';

export type TaskActorAccess = { readonly type: 'SYSTEM' }
  | { readonly type: 'EMPLOYEE' | 'CUSTOMER'; readonly subjectId: string; readonly token: string };
// 上下文只有本服务可签发，且仅在withContext回调存活期间有效；类型强转不能绕过WeakMap检查。
export interface TaskEntryContext { readonly requestId: string }
/** 内部事务端口使用已签发上下文；revalidate须在领域等待后、最终写入前调用。 */
export interface TaskTransactionScope {
  readonly tx: Prisma.TransactionClient; readonly actor: TaskCommandActor; readonly requestId: string;
  readonly employees: ReadonlySet<string>; readonly revalidate: () => Promise<TaskCommandActor>;
}
interface Context {
  tx: Prisma.TransactionClient; actor: TaskCommandActor; references: ReadonlySet<string>; employees: ReadonlySet<string>; requestId: string;
  access: TaskActorAccess;
}
const validText = (value: unknown, max: number) => typeof value === 'string' && !!value.trim() && [...value.trim()].length <= max;
const dateValue = (value: Date): number => {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()) || value.getTime() < 0) throw new TaskError('TASK_INPUT_INVALID');
  return value.getTime();
};
const auditActor = (actor: TaskCommandActor): AuditActor => actor.subjectType === 'SYSTEM' ? { type: 'SYSTEM' } : { type: actor.subjectType, id: actor.subjectId };
const historyActor = (actor: TaskCommandActor) => ({ actorType: actor.subjectType === 'EMPLOYEE' ? 'EMPLOYEE' as const : 'SYSTEM' as const,
  actorEmployeeId: actor.subjectType === 'EMPLOYEE' ? actor.subjectId : null });

@Injectable()
export class TaskEntryService {
  private readonly contexts = new WeakMap<TaskEntryContext, Context>();
  constructor(@Inject(TaskBusinessAdapters) private readonly adapters: TaskBusinessAdapters,
    @Inject(TaskLockService) private readonly locks: TaskLockService,
    @Inject(CurrentIdentityService) private readonly identities: CurrentIdentityService,
    @Inject(StoreSettingsService) private readonly settings: StoreSettingsService,
    @Inject(AuditService) private readonly audit: AuditService, @Inject(Clock) private readonly clock: Clock,
    @Inject(TaskDeadlineEventsService) private readonly events: TaskDeadlineEventsService) {}

  /** 调用方拥有整个事务及有限重试；必须在取得领域锁前进入本端口。回调内可更新业务再进入一个或多个阶段。 */
  async withContext<T>(tx: Prisma.TransactionClient, access: TaskActorAccess, references: readonly TaskBusinessReference[],
    requestId: string, command: (context: TaskEntryContext) => Promise<T>, extraLocks: readonly TaskLockResource[] = []): Promise<T> {
    requireSessionTransaction(tx); requestId = checkedId(requestId);
    if (!access || !['EMPLOYEE', 'CUSTOMER', 'SYSTEM'].includes(access.type) || !Array.isArray(references) || !references.length) throw new TaskError('TASK_INPUT_INVALID');
    const refs = [...new Map(references.map(item => { const ref = checkedBusiness(item); return [businessKey(ref), ref]; })).values()]
      .sort((a, b) => businessKey(a) < businessKey(b) ? -1 : 1);
    const subjectId = access.type === 'SYSTEM' ? null : checkedId(access.subjectId);
    const employeeIds = await this.locks.acquire(tx, refs, access.type === 'EMPLOYEE' ? [subjectId!] : [],
      [...(access.type === 'CUSTOMER' ? [{ kind: 'CUSTOMER' as const, id: subjectId! }] : []), ...extraLocks]);
    let actor: TaskCommandActor = { subjectType: 'SYSTEM' };
    if (access.type !== 'SYSTEM') {
      actor = await this.identities.authenticate(tx, access.token, access.type);
      if (actor.subjectId !== subjectId) throw new TokenValidationError('TOKEN_INVALID');
      if (actor.subjectType === 'EMPLOYEE' && actor.mustChangePassword) throw new AccessDeniedError('PASSWORD_CHANGE_REQUIRED');
    }
    for (const ref of refs) await this.adapters.require(ref.businessType).authorize(tx, ref, actor);
    const context = Object.freeze({ requestId }); this.contexts.set(context, { tx, actor, requestId, access, references: new Set(refs.map(businessKey)), employees: employeeIds });
    try { return await command(context); } finally { this.contexts.delete(context); }
  }

  async enterStage(context: TaskEntryContext, input: TaskStageEntry): Promise<{ task: Task; changed: boolean }> {
    const scope = this.contexts.get(context); if (!scope) throw new TaskError('TASK_CONTEXT_INVALID');
    const reference = checkedBusiness(input);
    if (!scope.references.has(businessKey(reference))) throw new TaskError('TASK_CONTEXT_INVALID');
    if (!validText(input.entryKey, 150) || !validText(input.reason, 500)) throw new TaskError('TASK_INPUT_INVALID');
    // 严格取白名单，不传播调用方夹带的requiredPermissions、assignee、ruleSnapshot或dueAt。
    const entry = { ...reference, stage: input.stage, entryKey: input.entryKey.trim(), reason: input.reason.trim() };
    const definition = taskStageDefinition(entry.stage, entry.businessType); const { tx, requestId } = scope;
    await this.reauthorize(scope, reference);
    const unique = { businessType: entry.businessType, businessId: entry.businessId, stage: entry.stage };
    const repeated = await tx.task.findUnique({ where: { businessType_businessId_stage_entryKey: { ...unique, entryKey: entry.entryKey } } });
    // 已授权、已锁定后重放原结果；即使原轮已结束也不复活、不重算期限或新增审计。
    if (repeated) return { task: repeated, changed: false };
    const beforeDecision = this.clock.now(); dateValue(beforeDecision);
    await tx.taskStageCursor.createMany({ data: [{ ...unique, lastRound: 0, createdAt: beforeDecision, updatedAt: beforeDecision }], skipDuplicates: true });
    await tx.$queryRaw`SELECT id FROM task_stage_cursor WHERE business_type=${entry.businessType}::"TaskBusinessType"
      AND business_id=${entry.businessId}::uuid AND stage=${entry.stage}::"TaskStage" FOR UPDATE`;
    const cursor = await tx.taskStageCursor.findUniqueOrThrow({ where: { businessType_businessId_stage: unique } });
    await tx.$queryRaw`SELECT id FROM task WHERE cursor_id=${cursor.id}::uuid ORDER BY id FOR UPDATE`;
    const active = await tx.task.findFirst({ where: { cursorId: cursor.id, status: { in: ['OPEN', 'CLAIMED', 'SUSPENDED'] } } });
    if (active?.assigneeId && !scope.employees.has(active.assigneeId)) throw new TaskError('TASK_LOCK_PLAN_CHANGED');
    const decision = await this.adapters.require(entry.businessType).resolveEntry(tx, entry, scope.actor, active);
    // 等待游标/任务或领域检查期间凭证也可能到期；最终写入前再读当前身份，不重用早先授权。
    await this.reauthorize(scope, reference); const actor = scope.actor;
    const now = this.clock.now(); dateValue(now);
    if (!decision || dateValue(decision.startedAt) > dateValue(now)) throw new TaskError('TASK_ENTRY_BLOCKED');
    if (cursor.lastRound >= 2_147_483_647) throw new TaskError('TASK_ENTRY_BLOCKED');
    if (active && !decision.replaces) throw new TaskError('TASK_STAGE_ACTIVE');
    if (decision.replaces) {
      if (!active || checkedId(decision.replaces.taskId) !== active.id || !['COMPLETED', 'CANCELLED'].includes(decision.replaces.outcome)) throw new TaskError('TASK_ENTRY_BLOCKED');
      if (active.version !== decision.replaces.expectedVersion) throw new TaskError('VERSION_CONFLICT');
      if (active.status === 'SUSPENDED' && decision.replaces.outcome === 'COMPLETED') throw new TaskError('TASK_TRANSITION_BLOCKED');
      if (active.version >= 2147483647) throw new TaskError('TASK_VERSION_EXHAUSTED');
      const sources = this.adapters.getSources(active.businessType);
      if (sources && (await sources.listActive(tx, active)).length) throw new TaskError('TASK_SOURCE_ACTIVE');
    }
    const setting = definition.deadline ? await this.settings.requireCurrent(tx) : null;
    const rule = definition.deadline && setting ? { unit: definition.deadline.unit, amount: setting[definition.deadline.field] } : null;
    const dueAt = rule ? calculateDeadline(decision.startedAt, rule) : null;
    if (active && decision.replaces) await this.closeReplaced(scope, active, decision.replaces.outcome, entry, now);
    const task = await tx.task.create({ data: { ...unique, cursorId: cursor.id, round: cursor.lastRound + 1, entryKey: entry.entryKey,
      requiredPermissions: [...definition.requiredPermissions], status: 'OPEN', assigneeId: null,
      startedAt: decision.startedAt, originalDueAt: dueAt, dueAt, settingsVersionId: setting?.id ?? null,
      ruleSnapshot: { ruleCode: entry.stage, source: rule ? 'STORE_SETTING' : 'NO_DEFAULT_SLA', sourceField: definition.deadline?.field ?? null,
        unit: rule?.unit ?? null, amount: rule?.amount ?? null, settingsVersionNumber: setting?.versionNumber ?? null,
        timeZone: BUSINESS_TIME_ZONE, algorithmVersion: DEADLINE_ALGORITHM_VERSION, stageCatalogVersion: TASK_STAGE_CATALOG_VERSION },
      createdAt: now, updatedAt: now } });
    await tx.taskStageCursor.update({ where: { id: cursor.id }, data: { lastRound: task.round, updatedAt: now } });
    await tx.taskHistory.create({ data: { taskId: task.id, action: 'CREATED', ...historyActor(actor), beforeStatus: null, afterStatus: 'OPEN',
      reason: entry.reason, commandKey: entry.entryKey, requestId, createdAt: now } });
    await this.audit.appendAudit(tx, { actor: auditActor(actor), action: 'task.create', targetId: task.id, requestId, reason: entry.reason,
      after: { businessType: task.businessType, businessId: task.businessId, stage: task.stage, round: task.round, taskStatus: task.status,
        dueAt: dueAt?.toISOString() ?? null, settingsVersionId: task.settingsVersionId } });
    return { task, changed: true };
  }

  async inContext<T>(context: TaskEntryContext, reference: TaskBusinessReference, command: (scope: TaskTransactionScope) => Promise<T>): Promise<T> {
    const scope = this.contexts.get(context); if (!scope) throw new TaskError('TASK_CONTEXT_INVALID');
    const ref = checkedBusiness(reference); if (!scope.references.has(businessKey(ref))) throw new TaskError('TASK_CONTEXT_INVALID');
    await this.reauthorize(scope, ref);
    return command(Object.freeze({ tx: scope.tx, actor: scope.actor, requestId: scope.requestId, employees: scope.employees,
      revalidate: async () => { await this.reauthorize(scope, ref); return scope.actor; } }));
  }

  private async reauthorize(scope: Context, reference: TaskBusinessReference) {
    if (scope.access.type !== 'SYSTEM') {
      const current = await this.identities.authenticate(scope.tx, scope.access.token, scope.access.type);
      if (scope.actor.subjectType === 'SYSTEM' || current.subjectId !== scope.actor.subjectId || current.sessionId !== scope.actor.sessionId) throw new TokenValidationError('TOKEN_INVALID');
      if (current.subjectType === 'EMPLOYEE' && current.mustChangePassword) throw new AccessDeniedError('PASSWORD_CHANGE_REQUIRED');
      scope.actor = current;
    }
    await this.adapters.require(reference.businessType).authorize(scope.tx, reference, scope.actor);
  }

  private async closeReplaced(scope: Context, task: Task, outcome: 'COMPLETED' | 'CANCELLED', entry: TaskStageEntry, now: Date) {
    const { tx, actor, requestId } = scope;
    await this.events.recordOverdue(tx, task, auditActor(actor), requestId, now);
    await tx.task.update({ where: { id: task.id }, data: { status: outcome, assigneeId: null, closedAt: now, version: { increment: 1 }, updatedAt: now } });
    await tx.taskHistory.create({ data: { taskId: task.id, action: outcome, ...historyActor(actor), fromAssigneeId: task.assigneeId,
      toAssigneeId: null, beforeStatus: task.status, afterStatus: outcome, reason: entry.reason, commandKey: entry.entryKey, requestId, createdAt: now } });
    await this.audit.appendAudit(tx, { actor: auditActor(actor), action: outcome === 'COMPLETED' ? 'task.stage.complete' : 'task.stage.cancel', targetId: task.id,
      requestId, reason: entry.reason, before: { taskStatus: task.status, assigneeId: task.assigneeId, round: task.round },
      after: { taskStatus: outcome, assigneeId: null, round: task.round } });
  }
}
