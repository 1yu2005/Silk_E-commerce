// 作用：在一致快照内读取本人/岗位池/待安排、摘要、详情和统一时间线，范围和业务摘要都经过真实适配器裁剪。
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type DeadlineEvent, type Task, type TaskHistoryAction, type TaskStatus } from '@prisma/client';
import { paginationWindow } from '@shop/shared';
import { AccessDeniedError } from '../auth/access-denied.error.js';
import type { CurrentIdentity } from '../auth/current-identity.service.js';
import { checkedId } from '../auth/session-support.js';
import { Clock } from '../common/time/clock.js';
import { PaginationDto } from '../common/http/pagination.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { activeTaskSql, canReassign, eligibleTaskSql, TaskAccessService } from './task-access.service.js';
import type { TaskQueryDto } from './task.dto.js';
import { TaskError } from './task.errors.js';

const readOptions = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 5000 };
interface TimelineRow {
  id: string; kind: 'TASK_CHANGE' | 'DEADLINE_EVENT'; occurredAt: Date; reason: string | null;
  action: TaskHistoryAction | null; beforeStatus: TaskStatus | null; afterStatus: TaskStatus | null;
  fromAssigneeId: string | null; toAssigneeId: string | null; eventType: DeadlineEvent['eventType'] | null;
  deadlineAt: Date | null; newDueAt: Date | null; detectedAt: Date | null;
}
function eventView(event: DeadlineEvent, reasons: boolean) {
  return { id: event.id, kind: 'DEADLINE_EVENT' as const, occurredAt: event.occurredAt, eventType: event.eventType,
    deadlineAt: event.deadlineAt, newDueAt: event.newDueAt, detectedAt: event.detectedAt, reason: reasons ? event.reason : null };
}
@Injectable()
export class TaskQueryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(TaskAccessService) private readonly access: TaskAccessService,
    @Inject(Clock) private readonly clock: Clock) {}
  list(actor: CurrentIdentity, token: string, query: TaskQueryDto) {
    return this.prisma.$transaction(async tx => {
      const current = await this.access.authenticate(tx, actor, token); const now = this.clock.now();
      if (query.view === 'reassign' && !canReassign(current)) throw new AccessDeniedError('FORBIDDEN');
      const clauses = [await this.access.scope(tx, current)];
      if (query.view === 'mine') clauses.push(Prisma.sql`t.assignee_id=${current.subjectId}::uuid`);
      if (query.view === 'pool') clauses.push(Prisma.sql`t.status='OPEN' AND (${eligibleTaskSql(current)})`);
      if (query.view === 'reassign') clauses.push(Prisma.sql`t.reassign_needed=true AND ${activeTaskSql}`);
      if (query.stage) clauses.push(Prisma.sql`t.stage=${query.stage}::"TaskStage"`);
      if (query.status) clauses.push(Prisma.sql`t.status=${query.status}::"TaskStatus"`);
      if (query.businessType) clauses.push(Prisma.sql`t.business_type=${query.businessType}::"TaskBusinessType"`);
      if (query.businessId) clauses.push(Prisma.sql`t.business_id=${query.businessId}::uuid`);
      const overdue = Prisma.sql`(${activeTaskSql} AND t.due_at IS NOT NULL AND t.due_at<=${now})`;
      if (query.overdue !== undefined) clauses.push(query.overdue ? overdue : Prisma.sql`NOT (${overdue})`);
      const where = Prisma.join(clauses.map(clause => Prisma.sql`(${clause})`), ' AND ');
      const [count] = await tx.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM task t WHERE ${where}`;
      const total = Number(count!.total); const window = paginationWindow(query, total);
      const rows = window.skip === null ? [] : await tx.$queryRaw<{ id: string }[]>`SELECT t.id FROM task t WHERE ${where}
        ORDER BY t.due_at ASC NULLS LAST,t.created_at ASC,t.id ASC LIMIT ${window.take} OFFSET ${window.skip}`;
      const tasks = await tx.task.findMany({ where: { id: { in: rows.map(row => row.id) } } }); const byId = new Map(tasks.map(task => [task.id, task]));
      const items = []; for (const row of rows) items.push(await this.access.present(tx, current, byId.get(row.id)!, now));
      return { items, total, page: query.page, pageSize: query.pageSize };
    }, readOptions);
  }
  summary(actor: CurrentIdentity, token: string) {
    return this.prisma.$transaction(async tx => {
      const current = await this.access.authenticate(tx, actor, token); const scope = await this.access.scope(tx, current); const now = this.clock.now();
      const overdue = Prisma.sql`(${activeTaskSql} AND t.due_at IS NOT NULL AND t.due_at<=${now})`;
      const [row] = await tx.$queryRaw<{ myPending: bigint; eligibleOpen: bigint; currentOverdue: bigint; everOverdue: bigint; reassignNeeded: bigint }[]>`
        SELECT count(*) FILTER (WHERE t.assignee_id=${current.subjectId}::uuid AND ${activeTaskSql}) AS "myPending",
          count(*) FILTER (WHERE t.status='OPEN' AND (${eligibleTaskSql(current)})) AS "eligibleOpen",
          count(*) FILTER (WHERE ${overdue}) AS "currentOverdue",
          count(*) FILTER (WHERE t.ever_overdue OR ${overdue}) AS "everOverdue",
          count(*) FILTER (WHERE t.reassign_needed AND ${activeTaskSql}) AS "reassignNeeded" FROM task t WHERE ${scope}`;
      return { myPending: Number(row!.myPending), eligibleOpen: Number(row!.eligibleOpen), currentOverdue: Number(row!.currentOverdue),
        everOverdue: Number(row!.everOverdue), reassignNeeded: canReassign(current) ? Number(row!.reassignNeeded) : null, countsOverlap: true, asOf: now };
    }, readOptions);
  }
  detail(actor: CurrentIdentity, token: string, id: string) {
    return this.prisma.$transaction(async tx => {
      const current = await this.access.authenticate(tx, actor, token); const task = await this.visible(tx, current, id);
      const view = await this.access.businessView(tx, current, task); const latest = await tx.deadlineEvent.findFirst({ where: { taskId: task.id }, orderBy: [{ occurredAt: 'desc' }, { id: 'asc' }] });
      // 规则快照只投影阶段内核定义的键，不透传任意JSON或领域内部资料。
      const rule = task.ruleSnapshot as Record<string, Prisma.JsonValue>;
      const ruleSnapshot = Object.fromEntries(['ruleCode', 'source', 'sourceField', 'unit', 'amount', 'settingsVersionNumber', 'timeZone', 'algorithmVersion', 'stageCatalogVersion']
        .map(key => [key, rule[key] ?? null]));
      return { ...await this.access.present(tx, current, task, this.clock.now()), settingsVersionId: task.settingsVersionId,
        ruleSnapshot, closedAt: task.closedAt, latestDeadlineEvent: latest ? eventView(latest, view.canReadHistoryReasons) : null };
    }, readOptions);
  }
  history(actor: CurrentIdentity, token: string, id: string, query: PaginationDto) {
    return this.prisma.$transaction(async tx => {
      const current = await this.access.authenticate(tx, actor, token); const task = await this.visible(tx, current, id);
      const view = await this.access.businessView(tx, current, task);
      const total = await tx.taskHistory.count({ where: { taskId: task.id } }) + await tx.deadlineEvent.count({ where: { taskId: task.id } });
      const window = paginationWindow(query, total);
      const rows = window.skip === null ? [] : await tx.$queryRaw<TimelineRow[]>`SELECT * FROM (
        SELECT h.id,'TASK_CHANGE' AS kind,h.created_at AS "occurredAt",h.reason,h.action::text AS action,
          h.before_status::text AS "beforeStatus",h.after_status::text AS "afterStatus",h.from_assignee_id AS "fromAssigneeId",h.to_assignee_id AS "toAssigneeId",
          NULL::text AS "eventType",NULL::timestamptz AS "deadlineAt",NULL::timestamptz AS "newDueAt",NULL::timestamptz AS "detectedAt" FROM task_history h WHERE h.task_id=${task.id}::uuid
        UNION ALL SELECT e.id,'DEADLINE_EVENT',e.occurred_at,e.reason,NULL::text,NULL::text,NULL::text,NULL::uuid,NULL::uuid,
          e.event_type::text,e.deadline_at,e.new_due_at,e.detected_at FROM deadline_event e WHERE e.task_id=${task.id}::uuid
      ) timeline ORDER BY "occurredAt" DESC,kind ASC,id ASC LIMIT ${window.take} OFFSET ${window.skip}`;
      const items = rows.map(row => row.kind === 'TASK_CHANGE' ? { id: row.id, kind: row.kind, occurredAt: row.occurredAt, action: row.action!,
        beforeStatus: row.beforeStatus, afterStatus: row.afterStatus!, fromAssigneeId: row.fromAssigneeId, toAssigneeId: row.toAssigneeId, reason: view.canReadHistoryReasons ? row.reason : null }
        : { id: row.id, kind: row.kind, occurredAt: row.occurredAt, eventType: row.eventType!, deadlineAt: row.deadlineAt!, newDueAt: row.newDueAt,
          detectedAt: row.detectedAt!, reason: view.canReadHistoryReasons ? row.reason : null });
      return { items, total, page: query.page, pageSize: query.pageSize };
    }, readOptions);
  }
  private async visible(tx: Prisma.TransactionClient, actor: Parameters<TaskAccessService['requireVisible']>[1], id: string): Promise<Task> {
    const task = await tx.task.findUnique({ where: { id: checkedId(id) } }); if (!task) throw new TaskError('TASK_NOT_FOUND');
    await this.access.requireVisible(tx, actor, task); return task;
  }
}
