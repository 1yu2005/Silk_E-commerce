// 作用：固定任务查询、时间线、领取和释放的公开契约；经既有工具生成类型和调用器，不手写共享DTO。
import type { ApiQueryOptions, OpenAPIObject } from '@nestjs/swagger';
import { DeadlineEventType, TaskBusinessType, TaskHistoryAction, TaskStage, TaskStatus } from '@prisma/client';
type Schema = NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>[string];
const uuid: Schema = { type: 'string', format: 'uuid' }; const date: Schema = { type: 'string', format: 'date-time' };
const integer = (minimum = 0, maximum = 2147483647): Schema => ({ type: 'integer', minimum, maximum });
const text = (maxLength: number): Schema => ({ type: 'string', minLength: 1, maxLength });
const enumeration = (values: readonly string[]): Schema => ({ type: 'string', enum: [...values] });
const object = (properties: Record<string, Schema>): Schema & { properties: Record<string, Schema> } => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const envelope = (data: Schema) => object({ data, requestId: uuid });
const pageFields = { total: integer(0, Number.MAX_SAFE_INTEGER), page: integer(1, Number.MAX_SAFE_INTEGER), pageSize: integer(1, 100) };
export const pageParameters: ApiQueryOptions[] = [{ name: 'page', required: false, schema: { ...pageFields.page, default: 1 } },
  { name: 'pageSize', required: false, schema: { ...pageFields.pageSize, default: 20 } }];
export const taskQueryParameters: ApiQueryOptions[] = [
  { name: 'view', required: false, schema: { ...enumeration(['mine', 'pool', 'reassign']), default: 'mine' } },
  { name: 'stage', required: false, schema: enumeration(Object.values(TaskStage)) }, { name: 'status', required: false, schema: enumeration(Object.values(TaskStatus)) },
  { name: 'businessType', required: false, schema: enumeration(Object.values(TaskBusinessType)) }, { name: 'businessId', required: false, schema: uuid },
  { name: 'overdue', required: false, schema: { type: 'boolean' } },
];
const task = object({ id: uuid, businessType: enumeration(Object.values(TaskBusinessType)), businessId: uuid, stage: enumeration(Object.values(TaskStage)), round: integer(1),
  status: enumeration(Object.values(TaskStatus)), assignee: { ...object({ id: uuid, displayName: text(40) }), nullable: true },
  requiredPermissions: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string' } }, startedAt: date,
  originalDueAt: { ...date, nullable: true }, dueAt: { ...date, nullable: true }, isCurrentlyOverdue: { type: 'boolean' }, hasEverOverdue: { type: 'boolean' },
  firstOverdueAt: { ...date, nullable: true }, reassignNeeded: { type: 'boolean' }, version: integer(),
  allowedActions: { type: 'array', uniqueItems: true, items: enumeration(['claim', 'release', 'transfer', 'extendDeadline']) },
  business: object({ number: text(100), label: text(100), detailPath: { type: 'string', nullable: true, description: '由真实业务提供的安全应用内详情路径；未接页面时为null' } }) });
const deadline = object({ id: uuid, kind: enumeration(['DEADLINE_EVENT']), occurredAt: date, eventType: enumeration(Object.values(DeadlineEventType)),
  deadlineAt: date, newDueAt: { ...date, nullable: true }, detectedAt: date, reason: { type: 'string', maxLength: 500, nullable: true } });
const change = object({ id: uuid, kind: enumeration(['TASK_CHANGE']), occurredAt: date, action: enumeration(Object.values(TaskHistoryAction)),
  beforeStatus: { ...enumeration(Object.values(TaskStatus)), nullable: true }, afterStatus: enumeration(Object.values(TaskStatus)),
  fromAssigneeId: { ...uuid, nullable: true }, toAssigneeId: { ...uuid, nullable: true }, reason: { type: 'string', maxLength: 500, nullable: true } });
export const claimTaskBody = object({ expectedVersion: integer() });
export const releaseTaskBody = object({ expectedVersion: integer(), reason: text(500) });
export const transferTaskBody = object({ targetEmployeeId: uuid, expectedVersion: integer(), reason: text(500) });
export const extendTaskDeadlineBody = object({ newDueAt: { ...date, pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$',
  description: '真实有效的ISO UTC时刻，必须带Z，精度最多毫秒；必须晚于当前截止及服务器当前时间' }, expectedVersion: integer(), reason: text(500) });
export const taskListSchema = envelope(object({ items: { type: 'array', maxItems: 100, items: task }, ...pageFields }));
export const taskCommandSchema = envelope(object({ changed: { type: 'boolean' }, task }));
export const taskDetailSchema = envelope(object({ ...task.properties, settingsVersionId: { ...uuid, nullable: true }, closedAt: { ...date, nullable: true },
  ruleSnapshot: object({ ruleCode: { type: 'string', nullable: true }, source: { type: 'string', nullable: true }, sourceField: { type: 'string', nullable: true },
    unit: { type: 'string', nullable: true }, amount: { ...integer(1), nullable: true }, settingsVersionNumber: { ...integer(1), nullable: true },
    timeZone: { type: 'string', nullable: true }, algorithmVersion: { type: 'string', nullable: true }, stageCatalogVersion: { type: 'string', nullable: true } }),
  latestDeadlineEvent: { ...deadline, nullable: true } }));
export const taskHistorySchema = envelope(object({ items: { type: 'array', maxItems: 100, items: { oneOf: [change, deadline] } }, ...pageFields }));
export const taskSummarySchema = envelope(object({ myPending: integer(0, Number.MAX_SAFE_INTEGER), eligibleOpen: integer(0, Number.MAX_SAFE_INTEGER),
  currentOverdue: integer(0, Number.MAX_SAFE_INTEGER), everOverdue: integer(0, Number.MAX_SAFE_INTEGER), reassignNeeded: { ...integer(0, Number.MAX_SAFE_INTEGER), nullable: true },
  countsOverlap: { type: 'boolean', enum: [true] }, asOf: date }));
