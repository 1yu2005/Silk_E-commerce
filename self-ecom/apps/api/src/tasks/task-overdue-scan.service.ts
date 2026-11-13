// 作用：真实扫描未处理到期事实；任务事务逐项隔离，运行会话锁识别崩溃，失败诊断不冒充业务成功。
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Client } from 'pg';
import { runAuthTransaction } from '../auth/auth-transaction.js';
import { Clock } from '../common/time/clock.js';
import { APP_CONFIG, type EnvironmentConfig } from '../config/environment.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TaskBusinessAdapters } from './task-business-adapters.js';
import { TaskDeadlineEventsService } from './task-deadline-events.service.js';
import { TaskLockService } from './task-lock.service.js';
import { TaskError } from './task.errors.js';

const JOB = 'task-overdue-scan';
export function scanFailure(error: unknown) {
  const errorCode = error instanceof TaskError ? error.code : error instanceof Prisma.PrismaClientKnownRequestError && /^P\d{4}$/.test(error.code) ? error.code : 'TASK_SCAN_FAILED';
  return { errorCode, sanitizedMessage: '任务超期扫描失败，事务已回滚；按运行编号排查并等待重扫' };
}
@Injectable()
export class TaskOverdueScanService {
  private readonly instanceId = randomUUID();
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(TaskLockService) private readonly locks: TaskLockService,
    @Inject(TaskBusinessAdapters) private readonly adapters: TaskBusinessAdapters, @Inject(TaskDeadlineEventsService) private readonly events: TaskDeadlineEventsService,
    @Inject(Clock) private readonly clock: Clock, @Inject(APP_CONFIG) private readonly config: EnvironmentConfig) {}
  async scan(batchSize = 100) {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new Error('扫描批量须为1～500整数');
    const id = randomUUID(); const requestId = randomUUID(); const asOf = this.clock.now();
    const guard = new Client({ connectionString: this.config.databaseUrl, connectionTimeoutMillis: 750, statement_timeout: 750, query_timeout: 1000 });
    let disconnected = false; guard.on('error', () => { disconnected = true; });
    let created = false; let scannedCount = 0; let changedCount = 0; let failedCount = 0;
    try {
      await guard.connect();
      // 锁先于可见RUNNING行建立；其它实例不能把刚创建但还没上锁的正常运行误判为崩溃。
      await guard.query('SELECT pg_advisory_lock(hashtextextended($1,0))', ['task-overdue-run:' + id]);
      await this.recoverAbandoned(guard, asOf);
      await this.prisma.schedulerRun.create({ data: { id, jobName: JOB, instanceId: this.instanceId, startedAt: asOf, requestId } }); created = true;
      let cursor: { id: string; dueAt: Date } | undefined;
      for (;;) {
        if (disconnected) throw new Error('扫描运行锁连接失效');
        const candidates: { id: string; dueAt: Date }[] = await this.prisma.$queryRaw(Prisma.sql`
          SELECT t.id,t.due_at AS "dueAt" FROM task t WHERE t.status IN ('OPEN','CLAIMED','SUSPENDED') AND t.due_at<=${asOf}
          AND NOT EXISTS(SELECT 1 FROM deadline_event d WHERE d.task_id=t.id AND d.event_type='OVERDUE' AND d.deadline_at=t.due_at)
          ${cursor ? Prisma.sql`AND (t.due_at,t.id)>(${cursor.dueAt},${cursor.id}::uuid)` : Prisma.empty}
          ORDER BY t.due_at,t.id LIMIT ${batchSize}`);
        if (!candidates.length) break;
        for (const candidate of candidates) {
          if (disconnected) throw new Error('扫描运行锁连接失效');
          scannedCount++;
          try { if (await this.scanTask(candidate.id, asOf, requestId)) changedCount++; }
          catch (error) {
            failedCount++;
            // 单项业务事务已退出；独立事务保存固定脱敏诊断，失败任务下一轮仍可重试。
            await this.prisma.$transaction(tx => tx.schedulerFailure.create({ data: { runId: id, taskId: candidate.id,
              ...scanFailure(error), occurredAt: this.clock.now() } }));
          }
        }
        cursor = candidates[candidates.length - 1];
      }
      if (disconnected) throw new Error('扫描运行锁连接失效');
      const status = failedCount ? (changedCount ? 'PARTIAL_FAILED' : 'FAILED') : 'SUCCEEDED';
      const result = await this.prisma.schedulerRun.updateMany({ where: { id, status: 'RUNNING' }, data: { status,
        scannedCount, changedCount, failedCount, finishedAt: this.clock.now() } });
      if (result.count !== 1) throw new Error('扫描运行已失效');
      return { id, requestId, status, scannedCount, changedCount, failedCount };
    } catch (error) {
      if (created) await this.prisma.$transaction(async tx => {
        const result = await tx.schedulerRun.updateMany({ where: { id, status: 'RUNNING' }, data: { status: 'FAILED',
          scannedCount, changedCount, failedCount: failedCount + 1, finishedAt: new Date(Math.max(+asOf, +this.clock.now())) } });
        if (result.count) await tx.schedulerFailure.create({ data: { runId: id, taskId: null, ...scanFailure(error), occurredAt: this.clock.now() } });
      });
      throw error;
    } finally { await guard.end(); }
  }
  private async recoverAbandoned(guard: Client, now: Date) {
    const rows = await this.prisma.schedulerRun.findMany({ where: { jobName: JOB, status: 'RUNNING' }, select: { id: true, startedAt: true } });
    for (const row of rows) {
      await guard.query('BEGIN');
      try {
        const lock = await guard.query<{ locked: boolean }>('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked', ['task-overdue-run:' + row.id]);
        if (lock.rows[0]?.locked) await guard.query("UPDATE scheduler_run SET status='ABANDONED',finished_at=$2 WHERE id=$1 AND status='RUNNING'", [row.id, new Date(Math.max(+now, +row.startedAt))]);
        await guard.query('COMMIT');
      } catch (error) { await guard.query('ROLLBACK'); throw error; }
    }
  }
  private scanTask(id: string, asOf: Date, requestId: string) {
    return runAuthTransaction(this.prisma, async tx => {
      const before = await tx.task.findUnique({ where: { id } }); if (!before) return false;
      const employees = await this.locks.acquire(tx, [before], []);
      await tx.$queryRaw`SELECT id FROM task_stage_cursor WHERE id=${before.cursorId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM task WHERE id=${id}::uuid FOR UPDATE`;
      const task = await tx.task.findUniqueOrThrow({ where: { id } });
      if (task.assigneeId && !employees.has(task.assigneeId)) throw new TaskError('TASK_LOCK_PLAN_CHANGED');
      await this.adapters.require(task.businessType).authorize(tx, task, { subjectType: 'SYSTEM' });
      if (!task.dueAt || task.dueAt > asOf) return false;
      return this.events.recordOverdue(tx, task, { type: 'SYSTEM' }, requestId, this.clock.now());
    }, error => error instanceof TaskError && error.code === 'TASK_LOCK_PLAN_CHANGED');
  }
}
