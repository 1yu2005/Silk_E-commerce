// 作用：编译校验生成任务查询/动作及时间线判别联合，不维护第二套共享任务DTO。
import type { AxiosInstance } from 'axios';
import { createGeneratedClient } from '../src/generated/client.js';
import type { operations } from '../src/generated/schema.js';
declare const transport: AxiosInstance; const api = createGeneratedClient(transport);
void api.listTasks({ query: { view: 'pool', overdue: false, page: 2 } });
void api.claimTask({ path: { id: 'id' }, body: { expectedVersion: 0 } });
void api.releaseTask({ path: { id: 'id' }, body: { expectedVersion: 1, reason: '交班' } });
void api.transferTask({ path: { id: 'id' }, body: { targetEmployeeId: 'id', expectedVersion: 1, reason: '交接' } });
void api.extendTaskDeadline({ path: { id: 'id' }, body: { expectedVersion: 1, newDueAt: '2026-11-20T02:00:00.000Z', reason: '进一步核实' } });
// @ts-expect-error 延期必须提供新截止。
void api.extendTaskDeadline({ path: { id: 'id' }, body: { expectedVersion: 1, reason: '核实' } });
// @ts-expect-error 延期原因必填。
void api.extendTaskDeadline({ path: { id: 'id' }, body: { expectedVersion: 1, newDueAt: '2026-11-20T02:00:00.000Z' } });
// @ts-expect-error 延期不能改原截止。
void api.extendTaskDeadline({ path: { id: 'id' }, body: { expectedVersion: 1, newDueAt: '2026-11-20T02:00:00.000Z', reason: '核实', originalDueAt: '2026-11-01' } });
// @ts-expect-error 版本不能是字符串。
void api.extendTaskDeadline({ path: { id: 'id' }, body: { expectedVersion: '1', newDueAt: '2026-11-20T02:00:00.000Z', reason: '核实' } });
// @ts-expect-error 转交目标必填。
void api.transferTask({ path: { id: 'id' }, body: { expectedVersion: 1, reason: '交接' } });
// @ts-expect-error 转交原因必填。
void api.transferTask({ path: { id: 'id' }, body: { targetEmployeeId: 'id', expectedVersion: 1 } });
// @ts-expect-error 转交不能夹带新截止。
void api.transferTask({ path: { id: 'id' }, body: { targetEmployeeId: 'id', expectedVersion: 1, reason: '交接', dueAt: '2026-11-14' } });
// @ts-expect-error 任务视图为固定集合。
void api.listTasks({ query: { view: 'all' } });
// @ts-expect-error 查询布尔值不接受字符串。
void api.listTasks({ query: { overdue: 'false' } });
// @ts-expect-error 版本必须为数字。
void api.claimTask({ path: { id: 'id' }, body: { expectedVersion: '0' } });
// @ts-expect-error 不得指定他人为经办。
void api.claimTask({ path: { id: 'id' }, body: { expectedVersion: 0, assigneeId: 'id' } });
// @ts-expect-error 释放原因必填。
void api.releaseTask({ path: { id: 'id' }, body: { expectedVersion: 0 } });
// @ts-expect-error 必须提供任务路径ID。
void api.getTaskHistory({});
type Row = operations['getTaskHistory']['responses'][200]['content']['application/json']['data']['items'][number];
export function timelineKind(row: Row) { return row.kind === 'TASK_CHANGE' ? row.action : row.eventType; }
type Detail = operations['getTaskDetail']['responses'][200]['content']['application/json']['data'];
export function assigneeName(detail: Detail) { return detail.assignee?.displayName ?? null; }
