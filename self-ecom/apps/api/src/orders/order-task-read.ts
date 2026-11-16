// 作用：分页内一次读取订单任务摘要；谓词与FulfillmentTaskPolicy.active保持同一业务条件。
import { Prisma, type Task } from '@prisma/client';
import { isTaskEligible } from '../tasks/task-access.service.js';
import type { TaskBusinessView, TaskEmployee } from '../tasks/task-business-adapters.js';
import { TaskError } from '../tasks/task.errors.js';
import { orderReader } from './order-access.service.js';

export const orderTaskScope = (actor: TaskEmployee) => orderReader(actor) || actor.effectivePermissions.includes('inventory.order-exception.manage')
  ? Prisma.sql`EXISTS (SELECT 1 FROM "order" o WHERE o.id=t.business_id)` : Prisma.sql`false`;

export async function describeOrderTasks(tx: Prisma.TransactionClient, actor: TaskEmployee, tasks: readonly Task[], now: Date): Promise<ReadonlyMap<string, TaskBusinessView>> {
  if (!orderReader(actor) && !actor.effectivePermissions.includes('inventory.order-exception.manage')) throw new TaskError('TASK_ENTRY_BLOCKED');
  if (!tasks.length) return new Map();
  const rows = await tx.$queryRaw<{id: string; orderId: string; number: string; valid: boolean}[]>`
    SELECT t.id,o.id AS "orderId",o.number,CASE
      WHEN t.stage='SHIPMENT_PROCESS' THEN o.status='WAIT_SHIPMENT'
        AND NOT EXISTS (SELECT 1 FROM handover_attempt h WHERE h.order_id=o.id AND h.status IN ('IN_PROGRESS','UNCERTAIN'))
        AND NOT EXISTS (SELECT 1 FROM order_block b WHERE b.order_id=o.id AND b.active AND b.blocks_shipment)
        AND NOT EXISTS (SELECT 1 FROM after_sale s WHERE s.order_id=o.id AND s.status NOT IN ('REJECTED','WITHDRAWN','CLOSED','SUCCEEDED'))
      WHEN t.stage='PROXY_INPUT' THEN EXISTS (SELECT 1 FROM customer c
        JOIN proxy_context p ON p.order_id=o.id AND p.status='VERIFIED' AND p.customer_status_version=c.status_version AND p.expires_at>${now}
        JOIN task_business_source src ON src.task_id=t.id AND src.status='ACTIVE' AND src.source_type='PROXY_CONTEXT' AND src.source_id=p.id
        WHERE c.id=o.customer_id AND c.status='LOGIN_FROZEN')
      ELSE EXISTS (SELECT 1 FROM task_business_source src WHERE src.task_id=t.id AND src.status='ACTIVE')
      END AS valid
    FROM task t JOIN "order" o ON o.id=t.business_id
    WHERE t.business_type='ORDER' AND t.id=ANY(${tasks.map(t => t.id)}::uuid[])`;
  const byId = new Map(rows.map(row => [row.id, row]));
  return new Map(tasks.map(task => {
    const row = byId.get(task.id); if (!row) throw new TaskError('TASK_NOT_FOUND');
    return [task.id, {number: row.number, label: task.stage === 'SHIPMENT_PROCESS' ? '订单待发货' : '订单实物异常跟进',
      detailPath: '/orders/' + row.orderId, canClaim: row.valid && task.status === 'OPEN' && isTaskEligible(actor, task),
      canRelease: row.valid && task.status === 'CLAIMED' && task.assigneeId === actor.subjectId, canReadHistoryReasons: true,
      canTransfer: row.valid, canExtendDeadline: row.valid}];
  }));
}
