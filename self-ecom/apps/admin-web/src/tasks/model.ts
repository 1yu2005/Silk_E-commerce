/** 文件作用：从生成契约派生任务类型，校验地址筛选及北京时间输入，不在页面重算任务资格。 */
import type { ApiOperations, EmployeePermissions } from '@shop/api-client';

export type TaskQuery = NonNullable<ApiOperations['listTasks']['parameters']['query']>;
export type TaskSearch = TaskQuery & { view: 'mine' | 'pool' | 'reassign'; page: number; pageSize: number };
export type TaskList = ApiOperations['listTasks']['responses'][200]['content']['application/json']['data'];
export type TaskItem = TaskList['items'][number];
export type TaskDetail = ApiOperations['getTaskDetail']['responses'][200]['content']['application/json']['data'];
export type TaskHistory = ApiOperations['getTaskHistory']['responses'][200]['content']['application/json']['data'];
export type TaskSummary = ApiOperations['getTaskSummary']['responses'][200]['content']['application/json']['data'];
export type TaskAction = TaskItem['allowedActions'][number];
export const taskViews = { mine: '我的待办', pool: '岗位池', reassign: '管理员待安排' } as const;
export const taskStatuses = { OPEN: '待领取', CLAIMED: '已领取', SUSPENDED: '已暂停', COMPLETED: '本环节完成', CANCELLED: '已取消' } as const;
export const taskBusinesses = { INVENTORY_ADJUSTMENT: '库存调整', ORDER: '订单', AFTER_SALE: '售后', OFFLINE_CASE: '线下工单', CUSTODY_ARRANGEMENT: '实物保管' } as const;
export const taskStages = {
  INVENTORY_POST: '库存入账', INVENTORY_RECONCILE: '库存差异核实', SHIPMENT_PROCESS: '发货处理', HANDOVER_VERIFY: '交运核实',
  PHYSICAL_VERIFY: '实物核实', STOCK_EXCEPTION_VERIFY: '库存异常核实', SHIPMENT_EXCEPTION_VERIFY: '发货异常核实', CUSTOMER_CONTACT: '顾客沟通',
  AFTER_SALE_REVIEW: '售后审核', SUPPLEMENT_FOLLOW: '补材料跟进', RETURN_FOLLOW: '寄回跟进', RETURN_RECEIVE: '退货收包', RETURN_INSPECT: '退货验收',
  INSPECTION_EXCEPTION_CONTACT: '验收异常沟通', REFUND_PROCESS: '退款处理', ADMIN_DISPUTE: '争议处理', ADMIN_STOCK_REVIEW: '库存协调',
  PROXY_INPUT: '代客录入', OFFLINE_FOLLOW: '线下跟进', CUSTODY_EXECUTE: '保管与寄还',
} as const satisfies Record<TaskItem['stage'], string>;
export const taskActions = { claim: '领取任务', release: '释放任务', transfer: '指派或转交', extendDeadline: '调整截止时间' } as const;
export function canArrangeTasks(permissions: EmployeePermissions | null): boolean {
  return permissions?.role === 'SUPER_ADMIN' && permissions.effectivePermissions.includes('task.transfer');
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const taskIdIssue = (value: string) => uuid.test(value) ? null : '任务或业务编号格式不正确';
export function parseTaskSearch(search: string): { query: TaskSearch; error?: never } | { query?: never; error: string } {
  const params = new URLSearchParams(search); const query: TaskSearch = { view: 'mine', page: 1, pageSize: 20 };
  const allowed = ['view', 'page', 'pageSize', 'stage', 'status', 'businessType', 'businessId', 'overdue'];
  for (const key of params.keys()) if (!allowed.includes(key) || params.getAll(key).length !== 1) return { error: '筛选地址含未知或重复参数，请重置筛选。' };
  for (const key of ['page', 'pageSize'] as const) {
    if (!params.has(key)) continue; const text = params.get(key)!;
    if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) > (key === 'pageSize' ? 100 : 2147483647)) return { error: '页码或每页数量不正确，请重置筛选。' };
    query[key] = Number(text);
  }
  const view = params.get('view'); if (view !== null) { if (!Object.hasOwn(taskViews, view)) return { error: '任务列表类型不正确。' }; query.view = view as TaskSearch['view']; }
  for (const [key, catalog] of [['stage', taskStages], ['status', taskStatuses], ['businessType', taskBusinesses]] as const) {
    const value = params.get(key); if (value === null) continue; if (!Object.hasOwn(catalog, value)) return { error: '阶段、状态或业务类型不正确。' };
    Object.assign(query, { [key]: value });
  }
  const businessId = params.get('businessId'); if (businessId !== null) { if (taskIdIssue(businessId)) return { error: '业务编号格式不正确。' }; query.businessId = businessId.toLowerCase(); }
  const overdue = params.get('overdue'); if (overdue !== null) { if (!['true', 'false'].includes(overdue)) return { error: '逾期筛选不正确。' }; query.overdue = overdue === 'true'; }
  return { query };
}
export function taskSearchParams(query: TaskSearch): URLSearchParams {
  const params = new URLSearchParams({ view: query.view, page: String(query.page), pageSize: String(query.pageSize) });
  for (const key of ['stage', 'status', 'businessType', 'businessId', 'overdue'] as const) if (query[key] !== undefined) params.set(key, String(query[key]));
  return params;
}
/** 浏览器时区不参与换算，先按北京时间验证真实日历，再返回严格UTC供服务器最终核验。 */
export function beijingDeadline(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return null;
  const normalized = value.length === 16 ? value + ':00' : value;
  const millis = Date.parse(normalized + '+08:00'); if (!Number.isFinite(millis)) return null;
  const local = new Date(millis + 8 * 3600_000).toISOString().slice(0, 19);
  return local === normalized ? new Date(millis).toISOString() : null;
}
export const safeBusinessPath = (value: string | null) => value && /^\/(?!\/)[A-Za-z0-9/_-]+$/.test(value) ? value : null;

