// 作用：按分页批量投影售后任务；保留settlementStageActive的阶段/entryKey及争议条件。
import { Prisma, type Task } from '@prisma/client';
import { isTaskEligible } from '../tasks/task-access.service.js';
import type { TaskBusinessView, TaskEmployee } from '../tasks/task-business-adapters.js';
import { TaskError } from '../tasks/task.errors.js';
import { inspectionReader, serviceReader } from './after-sale.access.js';

export const afterSaleTaskScope = (actor: TaskEmployee) => serviceReader(actor) || inspectionReader(actor)
  ? Prisma.sql`EXISTS (SELECT 1 FROM after_sale s WHERE s.id=t.business_id)` : Prisma.sql`false`;

export async function describeAfterSaleTasks(tx: Prisma.TransactionClient, actor: TaskEmployee, tasks: readonly Task[]): Promise<ReadonlyMap<string, TaskBusinessView>> {
  if (!serviceReader(actor) && !inspectionReader(actor)) throw new TaskError('TASK_NOT_FOUND');
  if (!tasks.length) return new Map();
  const rows = await tx.$queryRaw<{id: string; saleId: string; number: string; valid: boolean}[]>`
    SELECT t.id,s.id AS "saleId",s.number,CASE t.stage
      WHEN 'AFTER_SALE_REVIEW' THEN s.status='PENDING_REVIEW' OR s.status='WAIT_FULFILLMENT_CHECK' AND t.entry_key LIKE 'handover:%'
      WHEN 'SUPPLEMENT_FOLLOW' THEN s.status='WAIT_SUPPLEMENT'
      WHEN 'RETURN_FOLLOW' THEN s.status IN ('WAIT_RETURN','WAIT_RECEIPT','WAIT_INSPECTION')
      WHEN 'RETURN_RECEIVE' THEN s.status IN ('WAIT_RECEIPT','WAIT_INSPECTION','INSPECTION_EXCEPTION','FINAL_INSPECTION')
      WHEN 'RETURN_INSPECT' THEN s.status IN ('WAIT_INSPECTION','FINAL_INSPECTION')
      WHEN 'ADMIN_DISPUTE' THEN s.status='INSPECTION_EXCEPTION' OR EXISTS (SELECT 1 FROM dispute_request d WHERE d.after_sale_id=s.id AND d.status='OPEN')
      WHEN 'INSPECTION_EXCEPTION_CONTACT' THEN s.status='INSPECTION_EXCEPTION' OR t.entry_key LIKE 'dispute-followup:%' AND s.status IN ('WAIT_RETURN','WAIT_RECEIPT','WAIT_INSPECTION','FINAL_INSPECTION','WAIT_FULFILLMENT_CHECK','WAIT_REFUND','REFUND_FAILED')
      WHEN 'REFUND_PROCESS' THEN s.status IN ('WAIT_REFUND','REFUND_FAILED') ELSE false END AS valid
    FROM task t JOIN after_sale s ON s.id=t.business_id
    WHERE t.business_type='AFTER_SALE' AND t.id=ANY(${tasks.map(t => t.id)}::uuid[])`;
  const byId = new Map(rows.map(row => [row.id, row]));
  return new Map(tasks.map(task => {
    const row = byId.get(task.id); if (!row) throw new TaskError('TASK_NOT_FOUND');
    return [task.id, {number: row.number, label: '售后处理', detailPath: '/after-sales/' + row.saleId,
      canClaim: row.valid && task.status === 'OPEN' && isTaskEligible(actor, task), canRelease: row.valid && task.status === 'CLAIMED' && task.assigneeId === actor.subjectId,
      canReadHistoryReasons: serviceReader(actor), canTransfer: row.valid, canExtendDeadline: row.valid && !!task.dueAt}];
  }));
}
