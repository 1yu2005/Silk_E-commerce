// 作用：统一任务读取范围、完整资格和白名单投影；业务读取权不能被历史经办或管理员任务权限代替。
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type Task, type TaskBusinessType } from '@prisma/client';
import { AccessDeniedError } from '../auth/access-denied.error.js';
import { CurrentIdentityService, type CurrentIdentity } from '../auth/current-identity.service.js';
import { TokenValidationError } from '../auth/jwt-token.service.js';
import { checkedId } from '../auth/session-support.js';
import { permissionDefinitions } from '../permissions/permission-catalog.js';
import { TaskBusinessAdapters, type TaskBusinessView, type TaskEmployee } from './task-business-adapters.js';
import { taskStageCatalog, taskStageDefinition } from './task-stage.catalog.js';
import { TaskError } from './task.errors.js';

const codes = new Set<string>(permissionDefinitions.map(item => item.code));
export const activeTaskSql = Prisma.sql`t.status IN ('OPEN','CLAIMED','SUSPENDED')`;
export const isTaskActive = (task: Task) => ['OPEN', 'CLAIMED', 'SUSPENDED'].includes(task.status);
export function isTaskEligible(actor: TaskEmployee, task: Task): boolean {
  return hasTaskPermissions(actor.effectivePermissions, task);
}
export function hasTaskPermissions(permissions: readonly string[], task: Task): boolean {
  const base = taskStageDefinition(task.stage, task.businessType).requiredPermissions;
  return Array.isArray(task.requiredPermissions) && task.requiredPermissions.length > 0
    && [...base, ...task.requiredPermissions].every(code => typeof code === 'string' && codes.has(code) && permissions.includes(code));
}
export const canReassign = (actor: TaskEmployee) => actor.role === 'SUPER_ADMIN' && actor.effectivePermissions.includes('task.transfer');
export const canExtendDeadline = (actor: TaskEmployee) => actor.role === 'SUPER_ADMIN' && actor.effectivePermissions.includes('deadline.extend');
export function eligibleTaskSql(actor: TaskEmployee): Prisma.Sql {
  const stages = Object.entries(taskStageCatalog).filter(([, value]) => value.requiredPermissions.every(code => actor.effectivePermissions.includes(code))).map(([stage]) => stage);
  return stages.length ? Prisma.sql`t.stage::text IN (${Prisma.join(stages)}) AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(t.required_permissions) AS required(code)
    WHERE NOT (required.code = ANY(${actor.effectivePermissions}::text[])))` : Prisma.sql`false`;
}
export function assignedBeforeSql(actor: TaskEmployee) {
  return Prisma.sql`EXISTS (SELECT 1 FROM task_history h WHERE h.task_id=t.id
    AND (h.from_assignee_id=${actor.subjectId}::uuid OR h.to_assignee_id=${actor.subjectId}::uuid))`;
}

@Injectable()
export class TaskAccessService {
  constructor(@Inject(TaskBusinessAdapters) private readonly adapters: TaskBusinessAdapters,
    @Inject(CurrentIdentityService) private readonly identities: CurrentIdentityService) {}
  async authenticate(tx: Prisma.TransactionClient, actor: CurrentIdentity, token: string): Promise<TaskEmployee> {
    if (actor.subjectType !== 'EMPLOYEE') throw new TokenValidationError('TOKEN_SUBJECT_MISMATCH');
    const current = await this.identities.authenticate(tx, token, 'EMPLOYEE');
    if (current.subjectType !== 'EMPLOYEE' || current.subjectId !== actor.subjectId || current.sessionId !== actor.sessionId) throw new TokenValidationError('TOKEN_INVALID');
    if (current.mustChangePassword) throw new AccessDeniedError('PASSWORD_CHANGE_REQUIRED');
    return current;
  }
  async scope(tx: Prisma.TransactionClient, actor: TaskEmployee): Promise<Prisma.Sql> {
    const parts: Prisma.Sql[] = [];
    for (const [type, adapter] of this.adapters.accessEntries()) {
      const ids = [...new Set((await adapter.visibleBusinessIds(tx, actor)).map(checkedId))];
      if (ids.length) parts.push(Prisma.sql`(t.business_type=${type}::"TaskBusinessType" AND t.business_id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))}))`);
    }
    // 没有真实适配器时是真实空范围；不能仅凭任意业务UUID或旧经办显示孤立任务。
    const business = parts.length ? Prisma.sql`(${Prisma.join(parts, ' OR ')})` : Prisma.sql`false`;
    const participation = canReassign(actor) ? Prisma.sql`true` : Prisma.sql`(t.assignee_id=${actor.subjectId}::uuid OR (${eligibleTaskSql(actor)}) OR ${assignedBeforeSql(actor)})`;
    return Prisma.sql`(${business}) AND (${participation})`;
  }
  async requireVisible(tx: Prisma.TransactionClient, actor: TaskEmployee, task: Task) {
    const scope = await this.scope(tx, actor);
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT t.id FROM task t WHERE t.id=${task.id}::uuid AND (${scope})`;
    if (!rows.length) throw new TaskError('TASK_NOT_FOUND');
  }
  async businessView(tx: Prisma.TransactionClient, actor: TaskEmployee, task: Task): Promise<TaskBusinessView> {
    const adapter = this.adapters.access(task.businessType); if (!adapter) throw new TaskError('BUSINESS_MODULE_NOT_READY');
    const view = await adapter.describe(tx, actor, task);
    // 即使真实领域误传多余字段也不扩散；链接仅允许应用内无查询串的详情路径。
    if (!view || typeof view.number !== 'string' || !view.number.trim() || [...view.number].length > 100
      || typeof view.label !== 'string' || !view.label.trim() || [...view.label].length > 100
      || !['canClaim', 'canRelease', 'canReadHistoryReasons'].every(key => typeof view[key as keyof TaskBusinessView] === 'boolean')
      || (view.detailPath !== null && (typeof view.detailPath !== 'string' || !/^\/(?!\/)[A-Za-z0-9/_-]+$/.test(view.detailPath)))) throw new TaskError('TASK_ENTRY_BLOCKED');
    return { number: view.number, label: view.label, detailPath: view.detailPath, canClaim: view.canClaim,
      canRelease: view.canRelease, canReadHistoryReasons: view.canReadHistoryReasons,
      canTransfer: view.canTransfer === true && !!this.adapters.getHandoff(task.businessType),
      canExtendDeadline: view.canExtendDeadline === true && !!this.adapters.getDeadline(task.businessType) };
  }
  async present(tx: Prisma.TransactionClient, actor: TaskEmployee, task: Task, now: Date) {
    const view = await this.businessView(tx, actor, task);
    const assignee = task.assigneeId ? await tx.employee.findUnique({ where: { id: task.assigneeId }, select: { id: true, displayName: true } }) : null;
    const isCurrentlyOverdue = isTaskActive(task) && task.dueAt !== null && now >= task.dueAt;
    const allowedActions: ('claim' | 'release' | 'transfer' | 'extendDeadline')[] = [];
    if (task.version < 2147483647 && task.status === 'OPEN' && isTaskEligible(actor, task) && view.canClaim) allowedActions.push('claim');
    if (task.version < 2147483647 && task.status === 'CLAIMED' && task.assigneeId === actor.subjectId && view.canRelease) allowedActions.push('release');
    if (task.version < 2147483647 && ['OPEN', 'CLAIMED'].includes(task.status) && canReassign(actor) && view.canTransfer) allowedActions.push('transfer');
    if (task.version < 2147483647 && isTaskActive(task) && canExtendDeadline(actor) && view.canExtendDeadline) allowedActions.push('extendDeadline');
    return { id: task.id, businessType: task.businessType, businessId: task.businessId, stage: task.stage, round: task.round,
      status: task.status, assignee, requiredPermissions: task.requiredPermissions as string[], startedAt: task.startedAt,
      originalDueAt: task.originalDueAt, dueAt: task.dueAt, isCurrentlyOverdue, hasEverOverdue: task.everOverdue || isCurrentlyOverdue,
      firstOverdueAt: task.firstOverdueAt, reassignNeeded: task.reassignNeeded, version: task.version, allowedActions,
      business: { number: view.number, label: view.label, detailPath: view.detailPath } };
  }
  requireBusinessAccess(type: TaskBusinessType) {
    const adapter = this.adapters.access(type); if (!adapter) throw new TaskError('BUSINESS_MODULE_NOT_READY'); return adapter;
  }
}
