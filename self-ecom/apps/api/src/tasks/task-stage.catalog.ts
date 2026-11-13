// 作用：固化20个任务阶段、全部候选资格与期限来源；不提供动态工作流或浏览器自定规则。
import { TaskStage, type TaskBusinessType } from '@prisma/client';
import { permissionDefinitions, type PermissionCode } from '../permissions/permission-catalog.js';
import { TaskError } from './task.errors.js';

export const TASK_STAGE_CATALOG_VERSION = 'M0-04.stages.v1';
type SettingRule = 'reviewWorkdays' | 'supplementDays' | 'returnShipDays' | 'inspectionWorkdays' | 'refundWorkdays';
interface Definition {
  readonly businesses: readonly TaskBusinessType[];
  readonly permissions: readonly PermissionCode[];
  readonly deadline: null | { readonly field: SettingRule; readonly unit: 'WORKDAY' | 'NATURAL_DAY' };
}
const definitions = {
  INVENTORY_POST: { businesses: ['INVENTORY_ADJUSTMENT'], permissions: ['inventory.read', 'inventory.adjustment.claim', 'inventory.adjustment.post'], deadline: null },
  INVENTORY_RECONCILE: { businesses: ['INVENTORY_ADJUSTMENT'], permissions: ['inventory.read', 'inventory.adjustment.post'], deadline: null },
  SHIPMENT_PROCESS: { businesses: ['ORDER'], permissions: ['order.fulfillment.read', 'shipment.claim', 'shipment.pack', 'shipment.handover'], deadline: null },
  HANDOVER_VERIFY: { businesses: ['ORDER'], permissions: ['order.fulfillment.read', 'shipment.handover'], deadline: null },
  PHYSICAL_VERIFY: { businesses: ['ORDER'], permissions: ['order.fulfillment.read', 'order.physical.check'], deadline: null },
  STOCK_EXCEPTION_VERIFY: { businesses: ['ORDER'], permissions: ['inventory.read', 'inventory.order-exception.manage'], deadline: null },
  SHIPMENT_EXCEPTION_VERIFY: { businesses: ['ORDER'], permissions: ['order.fulfillment.read', 'shipment.exception.manage'], deadline: null },
  CUSTOMER_CONTACT: { businesses: ['ORDER'], permissions: ['order.service.read', 'shipment.customer-confirm'], deadline: null },
  AFTER_SALE_REVIEW: { businesses: ['AFTER_SALE'], permissions: ['after-sale.service.read', 'after-sale.review'], deadline: { field: 'reviewWorkdays', unit: 'WORKDAY' } },
  SUPPLEMENT_FOLLOW: { businesses: ['AFTER_SALE'], permissions: ['after-sale.service.read', 'after-sale.review'], deadline: { field: 'supplementDays', unit: 'NATURAL_DAY' } },
  RETURN_FOLLOW: { businesses: ['AFTER_SALE'], permissions: ['after-sale.service.read', 'after-sale.return.follow'], deadline: { field: 'returnShipDays', unit: 'NATURAL_DAY' } },
  RETURN_RECEIVE: { businesses: ['AFTER_SALE'], permissions: ['after-sale.inspection.read', 'after-sale.receipt.record'], deadline: null },
  RETURN_INSPECT: { businesses: ['AFTER_SALE'], permissions: ['after-sale.inspection.read', 'inventory.read', 'after-sale.inspection.confirm'], deadline: { field: 'inspectionWorkdays', unit: 'WORKDAY' } },
  INSPECTION_EXCEPTION_CONTACT: { businesses: ['AFTER_SALE'], permissions: ['after-sale.service.read', 'after-sale.return.follow'], deadline: null },
  REFUND_PROCESS: { businesses: ['AFTER_SALE'], permissions: ['after-sale.service.read', 'after-sale.refund.execute'], deadline: { field: 'refundWorkdays', unit: 'WORKDAY' } },
  ADMIN_DISPUTE: { businesses: ['AFTER_SALE', 'OFFLINE_CASE'], permissions: ['after-sale.dispute.decide'], deadline: null },
  ADMIN_STOCK_REVIEW: { businesses: ['ORDER'], permissions: ['task.transfer'], deadline: null },
  PROXY_INPUT: { businesses: ['ORDER'], permissions: ['customer.frozen.proxy', 'customer.read', 'after-sale.service.read'], deadline: null },
  OFFLINE_FOLLOW: { businesses: ['OFFLINE_CASE'], permissions: ['offline-case.manage', 'order.service.read'], deadline: null },
  CUSTODY_EXECUTE: { businesses: ['CUSTODY_ARRANGEMENT'], permissions: ['after-sale.inspection.read', 'after-sale.inspection.confirm'], deadline: null },
} as const satisfies Record<TaskStage, Definition>;

const permissions = new Map(permissionDefinitions.map(item => [item.code, item]));
function allRequired(codes: readonly string[]): readonly string[] {
  const found = new Set<string>();
  const add = (code: string) => {
    if (found.has(code)) return;
    const definition = permissions.get(code as PermissionCode); if (!definition) throw new Error('任务阶段包含未知权限');
    found.add(code); definition.dependencies.forEach(add);
  };
  codes.forEach(add); return Object.freeze([...found].sort());
}
// 依赖只用于判定所需资格，不为任何员工发放权限；每层冻结避免进程内误改。
export const taskStageCatalog = Object.freeze(Object.fromEntries(Object.entries(definitions).map(([stage, definition]) => [stage,
  Object.freeze({ businesses: Object.freeze([...definition.businesses]), requiredPermissions: allRequired(definition.permissions),
    deadline: definition.deadline ? Object.freeze({ ...definition.deadline }) : null }),
])) as Record<TaskStage, { readonly businesses: readonly TaskBusinessType[]; readonly requiredPermissions: readonly string[]; readonly deadline: Definition['deadline'] }>);

export function taskStageDefinition(stage: TaskStage, businessType: TaskBusinessType) {
  if (!Object.hasOwn(taskStageCatalog, stage)) throw new TaskError('TASK_INPUT_INVALID');
  const definition = taskStageCatalog[stage];
  if (!definition.businesses.includes(businessType)) throw new TaskError('TASK_STAGE_NOT_APPLICABLE');
  return definition;
}
