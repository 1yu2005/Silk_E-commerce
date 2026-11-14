// 作用：为审计读取重新定义展示白名单；写入白名单和管理员身份均不能替代展示投影。
import {TaskBusinessType,TaskStage,TaskStatus} from '@prisma/client';
import {permissionDefinitions} from '../permissions/permission-catalog.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type SafeValue = string | number | boolean | string[] | null;
type Validator = (value: unknown) => value is Exclude<SafeValue, null>;
const oneOf = (...values: string[]): Validator => (value): value is string => typeof value === 'string' && values.includes(value);
const natural: Validator = (value): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 2147483647;
const boolean: Validator = (value): value is boolean => typeof value === 'boolean';
const id: Validator = (value): value is string => typeof value === 'string' && uuid.test(value);
const date: Validator = (value): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const permissionCodes=new Set<string>(permissionDefinitions.map(p=>p.code));
const permissions: Validator = (value): value is string[] => Array.isArray(value) && value.length <= 200
  && value.every(v => typeof v === 'string' && permissionCodes.has(v));
const fields = {
  role: ['岗位', oneOf('SUPER_ADMIN', 'MERCH_WAREHOUSE', 'CUSTOMER_SERVICE')],
  status: ['账号状态', oneOf('ACTIVE', 'DISABLED', 'NORMAL', 'TRADE_RESTRICTED', 'LOGIN_FROZEN')],
  extraPermissions: ['额外权限', permissions], mustChangePassword: ['下次登录需改密', boolean],
  passwordChanged: ['密码已变更', boolean], loggedOut: ['会话已退出', boolean],
  orderStatus: ['订单状态', oneOf('WAIT_PAYMENT', 'WAIT_SHIPMENT', 'SHIPPED', 'COMPLETED', 'CLOSED', 'REFUNDED')],
  orderVersion: ['订单版本', natural], amountCents: ['金额（分）', natural], paymentId: ['支付编号', id],
  closeReasonCode: ['关闭类型', oneOf('USER_CANCELLED', 'ADMIN_CLOSED', 'PAYMENT_TIMEOUT')],
  fulfillmentAction: ['履约动作', oneOf('PACK','PREPARE','START','CONFIRM','UNCERTAIN','RESOLVE','EXCEPTION','WAREHOUSE_READY','CUSTOMER_WAIT','CUSTOMER_CONTINUE','CUSTOMER_REQUEST_REFUND','RELEASE_EXCEPTION','TRACKING','PHYSICAL_CHECK','CLAIM')],
  fulfillmentStage: ['履约阶段', oneOf('UNCLAIMED','PREPARING','READY','HANDOVER_IN_PROGRESS','HANDOVER_UNCERTAIN','SHIPPED')],
  receiptSource: ['收货来源', oneOf('CUSTOMER','SYSTEM')],
  afterSaleStatus: ['售后状态', oneOf('PENDING_REVIEW','WAIT_SUPPLEMENT','WAIT_FULFILLMENT_CHECK','WAIT_REFUND','WAIT_RETURN','WAIT_RECEIPT','WAIT_INSPECTION','INSPECTION_EXCEPTION','FINAL_INSPECTION','REFUNDING','REFUND_FAILED','REJECTED','WITHDRAWN','CLOSED','SUCCEEDED')],
  afterSaleVersion: ['售后版本', natural], orderId: ['订单编号', id],
  coordinationStatus: ['协作状态', oneOf('OPEN','HANDED_OFF','RESOLVED','CANCELLED','IN_PROGRESS','WAIT_EXTERNAL','CLOSED','VERIFIED','CONSUMED','INVALIDATED','DECIDED','WITHDRAWN','PLANNED','COMPLETED','EXCEPTION')],
  coordinationVersion: ['协作版本', natural], proxyContextId: ['单动作核实编号', id], sourceId: ['来源编号', id],
  businessId: ['业务编号', id], businessType: ['业务类型', oneOf(...Object.values(TaskBusinessType))],
  inventoryOperation: ['库存动作', oneOf('MANUAL_POST','RESERVE','PAY','CLOSE','RETURN_RESTOCK','UNSHIPPED_REFUND_RESTOCK','PAID_PREPARATION_LOSS','ALLOCATE_REPLACEMENT','REFUNDED_AVAILABLE_LOSS','CREATE','EDIT','VERIFY','CONVERT','POST','VOID','CHECK','RESOLVE','THRESHOLD','BLOCK','UNBLOCK')],
  inventoryVersion: ['库存版本', natural], inventoryQuantity: ['数量', natural],
  incidentVersion: ['异常版本', natural], affectedCount: ['影响项数', natural],
  catalogVersion: ['商品版本', natural], customerStatusVersion: ['顾客状态版本', natural],
  quantity: ['件数', natural], selected: ['已选中', boolean], deleted: ['已移除', boolean], isDefault: ['默认地址', boolean],
  cartVersion: ['购物车版本', natural], addressVersion: ['地址版本', natural], skuId: ['SKU编号', id],
  scopeType: ['沟通对象类型', oneOf('ORDER','AFTER_SALE')], scopeId: ['沟通对象编号', id],
  channel: ['沟通渠道', oneOf('PHONE','EXTERNAL_MESSAGE','IN_PERSON','OTHER')], hasPublicText: ['有公开说明', boolean], correctsId: ['更正原记录', id],
  purpose: ['图片用途', oneOf('CUSTOMER_AVATAR','PRODUCT_IMAGE','AFTER_SALE_EVIDENCE','INVENTORY_EVIDENCE','FULFILLMENT_EVIDENCE','INSPECTION_EVIDENCE','COMMUNICATION_EVIDENCE')],
  mimeType: ['图片类型', oneOf('image/jpeg','image/png','image/webp')], byteSize: ['文件字节数', natural], width: ['图片宽度', natural], height: ['图片高度', natural],
  state: ['文件状态', oneOf('STAGED')], versionNumber: ['设置版本', natural], settingVersionId: ['设置版本编号', id],
  round: ['任务轮次', natural], taskVersion: ['任务版本', natural], assigneeId: ['经办员工编号', id], reassignNeeded: ['需重新安排', boolean],
  taskStatus: ['任务状态', oneOf(...Object.values(TaskStatus))],
  stage: ['任务阶段', oneOf(...Object.values(TaskStage))],
  sourceType: ['来源类型', oneOf('AFTER_SALE','SHIPMENT_EXCEPTION','STOCK_EXCEPTION','HANDOVER_UNCERTAIN','ADDRESS_REQUEST','RETURN_PARCEL','PROXY_CONTEXT','DISPUTE_REQUEST')],
  sourceStatus: ['来源状态', oneOf('ACTIVE','RESOLVED','CANCELLED')], settingsVersionId: ['期限设置编号', id],
  dueAt: ['截止时刻', date], firstOverdueAt: ['首次逾期', date], startedAt: ['起算时刻', date],
  timerState: ['收货计时状态', oneOf('UNSHIPPED','HANDOVER_UNKNOWN','SHIPPED','COMPLETED','REFUNDED')],
  cycleNo: ['计时周期', natural], remainingMs: ['剩余毫秒', (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0],
} satisfies Record<string, readonly [string, Validator]>;

type Field = keyof typeof fields;
const policy = (label: string, target: string, names: Field[]) => ({ label, target, fields: names });
const orderFields: Field[] = ['orderStatus','orderVersion','fulfillmentAction','fulfillmentStage','sourceId'];
const taskFields: Field[] = ['businessType','businessId','stage','round','taskStatus','dueAt','settingsVersionId','assigneeId','taskVersion','reassignNeeded','startedAt','firstOverdueAt'];
export const auditDisplayPolicies = {
  'coordination.change': policy('异常协作与物品后续变更','Coordination',['orderId','businessId','businessType','coordinationStatus','coordinationVersion','sourceId','proxyContextId']),
  'after-sale.change': policy('售后处理','AfterSale',['afterSaleStatus','afterSaleVersion','orderId']),
  'order.after-sale.pause': policy('售后暂停履约','Order',orderFields),
  'order.fulfillment': policy('订单履约处理','Order',orderFields),
  'order.receipt': policy('订单收货','Order',['orderStatus','orderVersion','receiptSource','dueAt']),
  'order.create': policy('创建订单','Order',['orderStatus','orderVersion','amountCents']),
  'order.pay': policy('订单模拟支付','Order',['orderStatus','orderVersion','amountCents','paymentId']),
  'order.close': policy('关闭订单','Order',['orderStatus','orderVersion','closeReasonCode']),
  'stock.incident': policy('库存异常处理','StockIncident',['incidentVersion','affectedCount']),
  'customer.status.change': policy('顾客状态变更','Customer',['status','customerStatusVersion']),
  'address.change': policy('地址簿变更','Address',['isDefault','addressVersion']),
  'cart.change': policy('购物车变更','CartItem',['skuId','quantity','selected','cartVersion','deleted']),
  'inventory.action': policy('库存动作','InventoryAction',['inventoryOperation','inventoryVersion','inventoryQuantity']),
  'inventory.source': policy('库存来源登记','InventorySource',['inventoryOperation','inventoryVersion','inventoryQuantity']),
  'inventory.adjustment': policy('库存调整','InventoryAdjustment',['inventoryOperation','inventoryVersion','inventoryQuantity']),
  'inventory.threshold': policy('库存预警线变更','InventoryBalance',['inventoryOperation','inventoryVersion','inventoryQuantity']),
  'inventory.block': policy('库存购买阻塞变更','InventoryPurchaseBlock',['inventoryOperation','inventoryVersion','inventoryQuantity']),
  'category.change': policy('商品分类变更','Category',['catalogVersion','affectedCount']),
  'product.change': policy('商品资料变更','Product',['catalogVersion','affectedCount']),
  'employee.create': policy('创建员工','Employee',['role','status','mustChangePassword']),
  'employee.profile.update': policy('员工资料变更','Employee',[]),
  'employee.disable': policy('停用员工','Employee',['status']),
  'employee.enable': policy('启用员工','Employee',['status']),
  'employee.password.reset': policy('重置员工密码','Employee',['passwordChanged','mustChangePassword']),
  'employee.role.change': policy('员工岗位变更','Employee',['role','extraPermissions']),
  'employee.permission.replace': policy('员工额外权限变更','Employee',['extraPermissions']),
  'employee.password.change': policy('员工修改密码','Employee',['passwordChanged','mustChangePassword']),
  'customer.register': policy('顾客注册','Customer',['status']),
  'customer.profile.update': policy('顾客资料变更','Customer',[]),
  'customer.password.change': policy('顾客修改密码','Customer',['passwordChanged']),
  'customer.avatar.change': policy('顾客头像变更','Customer',[]),
  'file.upload': policy('上传业务图片','FileAsset',['purpose','mimeType','byteSize','width','height','state']),
  'communication.append': policy('追加业务沟通','Communication',['scopeType','scopeId','channel','hasPublicText']),
  'communication.correct': policy('更正业务沟通','Communication',['scopeType','scopeId','channel','hasPublicText','correctsId']),
  'auth.logout': policy('退出登录','AuthSession',['loggedOut']),
  'store.setting.update': policy('全店设置变更','StoreSettingVersion',['versionNumber','settingVersionId']),
  'task.create': policy('生成任务','Task',taskFields),
  'task.stage.complete': policy('完成任务阶段','Task',taskFields),
  'task.stage.cancel': policy('取消任务阶段','Task',taskFields),
  'task.overdue.record': policy('记录任务逾期','Task',taskFields),
  'task.claim': policy('领取任务','Task',taskFields),
  'task.release': policy('释放任务','Task',taskFields),
  'task.transfer': policy('转交任务','Task',taskFields),
  'task.qualification.lost': policy('任务资格失效','Task',taskFields),
  'task.deadline.extend': policy('延长任务期限','Task',taskFields),
  'task.receipt-start.correct': policy('更正实收起算时刻','Task',taskFields),
  'task.stage.suspend': policy('暂停任务阶段','Task',taskFields),
  'task.stage.resume': policy('恢复任务阶段','Task',taskFields),
  'task.source.add': policy('增加任务来源','Task',['sourceType','sourceId','sourceStatus']),
  'task.source.resolve': policy('解决任务来源','Task',['sourceType','sourceId','sourceStatus']),
  'task.source.cancel': policy('取消任务来源','Task',['sourceType','sourceId','sourceStatus']),
  'order.timer.block.add': policy('增加收货计时阻塞','Order',['dueAt','timerState','cycleNo','remainingMs']),
  'order.timer.block.release': policy('解除收货计时阻塞','Order',['dueAt','timerState','cycleNo','remainingMs']),
  'order.timer.handover.record': policy('登记交运计时','Order',['dueAt','timerState','cycleNo','remainingMs']),
  'order.timer.finish': policy('结束收货计时','Order',['dueAt','timerState','cycleNo','remainingMs']),
} as const;
export const auditActionNames = Object.keys(auditDisplayPolicies);
export const auditTargetTypes = [...new Set(Object.values(auditDisplayPolicies).map(p => p.target))];
export const auditBusinessTypes = ['ORDER','AFTER_SALE','REFUND','INVENTORY_ADJUSTMENT','OFFLINE_CASE'] as const;
export const auditActorTypes = ['EMPLOYEE','CUSTOMER','SYSTEM'] as const;
export const safeAuditId = (value: string): string | null => uuid.test(value) ? value.toLowerCase() : null;
export const safeAuditRequestId = (value: string): string | null => uuid.test(value) || /^[a-f0-9]{32}$/i.test(value) ? value : null;
export const safeBusinessNo = (value: string | null,type:string): string | null => {
  const pattern:Record<string,RegExp>={ORDER:/^O[A-Z0-9]{1,99}$/,AFTER_SALE:/^AS[A-Z0-9]{1,98}$/,REFUND:/^RF[A-Z0-9]{1,98}$/,INVENTORY_ADJUSTMENT:/^INV-[A-Z0-9]{1,96}$/,OFFLINE_CASE:/^OC[A-Z0-9]{1,98}$/};
  return value&&pattern[type]?.test(value)?value:null;
};
export function safeEmployeeIdentity(employee: {id: string; username: string; status: string}) {
  // 显示名是自由文本，不因出现在账号表中就原样返回；账号只接受固定语法的工作标识。
  return { id: employee.id, username: /^[a-z][a-z0-9_]{3,31}$/.test(employee.username) ? employee.username : null,
    displayName: `员工 ${employee.id.slice(0,8)}`, disabled: employee.status === 'DISABLED' };
}
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype ? value as Record<string, unknown> : null;
export function projectAuditDetails(action: string, targetType: string, beforeData: unknown, afterData: unknown, reason: string | null) {
  const known = Object.hasOwn(auditDisplayPolicies,action) ? auditDisplayPolicies[action as keyof typeof auditDisplayPolicies] : undefined;
  const recognized = known?.target === targetType;
  const before = object(beforeData), after = object(afterData);
  const changes: {field:string;label:string;before:SafeValue;after:SafeValue}[] = [];
  if (recognized) for (const field of known.fields) {
    const [label, validate] = fields[field];
    const clean = (source: Record<string,unknown> | null): SafeValue | undefined => {
      if (!source || !Object.hasOwn(source,field)) return undefined;
      const value=source[field]; return value===null ? null : validate(value) ? value : undefined;
    };
    const previous=clean(before), next=clean(after);
    if (previous!==undefined || next!==undefined) changes.push({field,label,before:previous??null,after:next??null});
  }
  // 无法可靠判断任意自由文本是否含姓名/地址/核实摘要/口令，故只给固定提示，绝不兜底原文。
  return { action: recognized ? action : 'UNKNOWN', actionLabel: recognized ? known.label : '未识别的历史动作',
    detailsAvailable: recognized, detailNotice: recognized ? '仅展示必要的状态、数量、金额和业务标识；自由文本已隐藏' : '该动作暂无安全详情展示',
    hasReason: Boolean(reason), reason: reason ? '已记录操作原因；自由文本不在审计查询中展示' : null, changes };
}
