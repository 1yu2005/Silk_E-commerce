// 作用：声明版本化固定权限目录、直接依赖及三个不可动态编辑的岗位模板。
import type { EmployeeRole } from '@prisma/client';

// 权限目录是版本化代码配置；不提供修改岗位模板或下放管理员能力的入口。
const definitions = [
  { code: 'category.read', name: '查看后台分类', description: '查看后台分类', defaultRole: 'MERCH_WAREHOUSE', adminOnly: false, dependencies: [] },
  { code: 'category.manage', name: '新增修改排序删除分类', description: '新增修改排序删除分类', defaultRole: 'MERCH_WAREHOUSE', adminOnly: false, dependencies: ['category.read'] },
  { code: 'product.read', name: '查看后台商品公开及运营资料', description: '查看后台商品公开及运营资料', defaultRole: 'MERCH_WAREHOUSE', adminOnly: false, dependencies: ['category.read'] },
  { code: 'product.cost.read', name: '查看商品及授权订单成本字段', description: '查看商品及授权订单成本字段', defaultRole: 'MERCH_WAREHOUSE', adminOnly: false, dependencies: ['product.read'] },
  { code: 'product.manage', name: '草稿、资料、价格、规格、图片维护', description: '草稿、资料、价格、规格、图片维护', defaultRole: 'MERCH_WAREHOUSE', adminOnly: false, dependencies: ['product.read', 'product.cost.read'] },
  { code: 'product.publish', name: '单项/批量上下架、SKU启停', description: '单项/批量上下架、SKU启停', defaultRole: 'MERCH_WAREHOUSE', adminOnly: false, dependencies: ['product.read'] },
  { code: 'inventory.read', name: '余额、来源、流水、预警查询', description: '余额、来源、流水、预警查询', defaultRole: 'MERCH_WAREHOUSE', adminOnly: false, dependencies: ['product.read'] },
  { code: 'inventory.adjustment.create', name: '创建待确认登记、更正登记', description: '创建待确认登记、更正登记', defaultRole: 'MERCH_WAREHOUSE', adminOnly: false, dependencies: ['inventory.read'] },
  { code: 'inventory.adjustment.claim', name: '领取登记', description: '领取登记', defaultRole: 'MERCH_WAREHOUSE', adminOnly: false, dependencies: ['inventory.read'] },
  { code: 'inventory.adjustment.post', name: '核实并确认入账', description: '核实并确认入账', defaultRole: 'MERCH_WAREHOUSE', adminOnly: false, dependencies: ['inventory.read', 'inventory.adjustment.claim'] },
  { code: 'inventory.adjustment.void', name: '作废待确认登记', description: '作废待确认登记', defaultRole: 'MERCH_WAREHOUSE', adminOnly: false, dependencies: ['inventory.read', 'inventory.adjustment.claim'] },
  { code: 'inventory.source.manage', name: '来源行核实数量维护', description: '来源行核实数量维护', defaultRole: 'MERCH_WAREHOUSE', adminOnly: false, dependencies: ['inventory.read'] },
  { code: 'inventory.alert.manage', name: '设置SKU预警线', description: '设置SKU预警线', defaultRole: 'MERCH_WAREHOUSE', adminOnly: false, dependencies: ['inventory.read'] },
  { code: 'order.fulfillment.read', name: '查询履约订单、必要收货信息及业务记录', description: '查询履约订单、必要收货信息及业务记录', defaultRole: 'MERCH_WAREHOUSE', adminOnly: false, dependencies: [] },
  { code: 'shipment.claim', name: '领取发货', description: '领取发货', defaultRole: 'MERCH_WAREHOUSE', adminOnly: false, dependencies: ['order.fulfillment.read'] },
  { code: 'shipment.pack', name: '拣货、打包、运单准备', description: '拣货、打包、运单准备', defaultRole: 'MERCH_WAREHOUSE', adminOnly: false, dependencies: ['order.fulfillment.read', 'shipment.claim'] },
  { code: 'shipment.handover', name: '开始交运、确认交运、核实交运结果', description: '开始交运、确认交运、核实交运结果', defaultRole: 'MERCH_WAREHOUSE', adminOnly: false, dependencies: ['order.fulfillment.read', 'shipment.claim'] },
  { code: 'shipment.tracking.correct', name: '允许阶段的运单修正', description: '允许阶段的运单修正', defaultRole: 'MERCH_WAREHOUSE', adminOnly: false, dependencies: ['order.fulfillment.read'] },
  { code: 'shipment.exception.manage', name: '登记发货异常、核实齐货', description: '登记发货异常、核实齐货', defaultRole: 'MERCH_WAREHOUSE', adminOnly: false, dependencies: ['order.fulfillment.read'] },
  { code: 'order.physical.check', name: '未交运备货可售/损耗及位置核实', description: '未交运备货可售/损耗及位置核实', defaultRole: 'MERCH_WAREHOUSE', adminOnly: false, dependencies: ['order.fulfillment.read'] },
  { code: 'inventory.order-exception.manage', name: '待付受损分配、备货损耗记录及阻塞核实', description: '待付受损分配、备货损耗记录及阻塞核实', defaultRole: 'MERCH_WAREHOUSE', adminOnly: false, dependencies: ['inventory.read', 'order.fulfillment.read'] },
  { code: 'after-sale.inspection.read', name: '读取退货物流、验收所需单据与证据', description: '读取退货物流、验收所需单据与证据', defaultRole: 'MERCH_WAREHOUSE', adminOnly: false, dependencies: ['order.fulfillment.read'] },
  { code: 'after-sale.receipt.record', name: '登记实物到仓', description: '登记实物到仓', defaultRole: 'MERCH_WAREHOUSE', adminOnly: false, dependencies: ['after-sale.inspection.read'] },
  { code: 'after-sale.inspection.confirm', name: '草稿、异常、正常验收及批准后最终核实', description: '草稿、异常、正常验收及批准后最终核实', defaultRole: 'MERCH_WAREHOUSE', adminOnly: false, dependencies: ['after-sale.inspection.read', 'inventory.read'] },
  { code: 'dashboard.read', name: '全店经营看板', description: '全店经营看板', defaultRole: 'MERCH_WAREHOUSE', adminOnly: false, dependencies: [] },
  { code: 'order.service.read', name: '服务范围订单、付款退款与客服记录查询', description: '服务范围订单、付款退款与客服记录查询', defaultRole: 'CUSTOMER_SERVICE', adminOnly: false, dependencies: [] },
  { code: 'communication.service.write', name: '新增及追加更正客服记录、公开说明', description: '新增及追加更正客服记录、公开说明', defaultRole: 'CUSTOMER_SERVICE', adminOnly: false, dependencies: ['order.service.read'] },
  { code: 'customer.read', name: '顾客资料及完整地址簿查询', description: '顾客资料及完整地址簿查询', defaultRole: 'CUSTOMER_SERVICE', adminOnly: false, dependencies: [] },
  { code: 'after-sale.service.read', name: '查询售后及服务材料', description: '查询售后及服务材料', defaultRole: 'CUSTOMER_SERVICE', adminOnly: false, dependencies: ['order.service.read'] },
  { code: 'after-sale.review', name: '审核、拒绝、补材料要求', description: '审核、拒绝、补材料要求', defaultRole: 'CUSTOMER_SERVICE', adminOnly: false, dependencies: ['after-sale.service.read'] },
  { code: 'after-sale.close', name: '仅允许阶段的未退款结案', description: '仅允许阶段的未退款结案', defaultRole: 'CUSTOMER_SERVICE', adminOnly: false, dependencies: ['after-sale.service.read'] },
  { code: 'after-sale.return.follow', name: '跟进寄回、补寄与物流核实', description: '跟进寄回、补寄与物流核实', defaultRole: 'CUSTOMER_SERVICE', adminOnly: false, dependencies: ['after-sale.service.read'] },
  { code: 'after-sale.refund.execute', name: '执行全额模拟退款', description: '执行全额模拟退款', defaultRole: 'CUSTOMER_SERVICE', adminOnly: false, dependencies: ['after-sale.service.read'] },
  { code: 'after-sale.refund.retry', name: '失败沿用原退款业务重试', description: '失败沿用原退款业务重试', defaultRole: 'CUSTOMER_SERVICE', adminOnly: false, dependencies: ['after-sale.service.read', 'after-sale.refund.execute'] },
  { code: 'shipment.customer-confirm', name: '登记顾客等待/退款/继续履约意见', description: '登记顾客等待/退款/继续履约意见', defaultRole: 'CUSTOMER_SERVICE', adminOnly: false, dependencies: ['order.service.read', 'communication.service.write'] },
  { code: 'offline-case.manage', name: '线下诉求、处理结果及证据记录', description: '线下诉求、处理结果及证据记录', defaultRole: 'CUSTOMER_SERVICE', adminOnly: false, dependencies: ['order.service.read'] },
  { code: 'customer.frozen.proxy', name: '核实身份后代录冻结顾客原单诉求', description: '核实身份后代录冻结顾客原单诉求', defaultRole: 'CUSTOMER_SERVICE', adminOnly: false, dependencies: ['customer.read', 'after-sale.service.read'] },
  { code: 'employee.read', name: '员工列表、详情和权限目录', description: '员工列表、详情和权限目录', defaultRole: 'SUPER_ADMIN', adminOnly: true, dependencies: [] },
  { code: 'employee.create', name: '创建员工，包括新增管理员', description: '创建员工，包括新增管理员', defaultRole: 'SUPER_ADMIN', adminOnly: true, dependencies: [] },
  { code: 'employee.profile.update', name: '修改员工显示名', description: '修改员工显示名', defaultRole: 'SUPER_ADMIN', adminOnly: true, dependencies: [] },
  { code: 'employee.status.manage', name: '员工启停', description: '员工启停', defaultRole: 'SUPER_ADMIN', adminOnly: true, dependencies: [] },
  { code: 'employee.password.reset', name: '重置他人密码', description: '重置他人密码', defaultRole: 'SUPER_ADMIN', adminOnly: true, dependencies: [] },
  { code: 'employee.role.change', name: '调岗，包含升降管理员', description: '调岗，包含升降管理员', defaultRole: 'SUPER_ADMIN', adminOnly: true, dependencies: [] },
  { code: 'employee.permission.manage', name: '个人额外权限设置', description: '个人额外权限设置', defaultRole: 'SUPER_ADMIN', adminOnly: true, dependencies: [] },
  { code: 'customer.status.manage', name: '顾客限制交易、冻结、恢复', description: '顾客限制交易、冻结、恢复', defaultRole: 'SUPER_ADMIN', adminOnly: true, dependencies: [] },
  { code: 'store.setting.manage', name: '全店设置', description: '全店设置', defaultRole: 'SUPER_ADMIN', adminOnly: true, dependencies: [] },
  { code: 'audit.read', name: '全店审计查询', description: '全店审计查询', defaultRole: 'SUPER_ADMIN', adminOnly: true, dependencies: [] },
  { code: 'order.unpaid.close', name: '手动关闭未付款订单', description: '手动关闭未付款订单', defaultRole: 'SUPER_ADMIN', adminOnly: true, dependencies: [] },
  { code: 'shipment.history.correct', name: '完成/退款后的历史运单纠错', description: '完成/退款后的历史运单纠错', defaultRole: 'SUPER_ADMIN', adminOnly: true, dependencies: [] },
  { code: 'after-sale.dispute.decide', name: '争议处理、异常退款批准、受限阶段关闭', description: '争议处理、异常退款批准、受限阶段关闭', defaultRole: 'SUPER_ADMIN', adminOnly: true, dependencies: [] },
  { code: 'deadline.extend', name: '原因明确的特殊延期', description: '原因明确的特殊延期', defaultRole: 'SUPER_ADMIN', adminOnly: true, dependencies: [] },
  { code: 'task.transfer', name: '跨人员转交、显式接手和无人接手协调', description: '跨人员转交、显式接手和无人接手协调', defaultRole: 'SUPER_ADMIN', adminOnly: true, dependencies: [] },
] as const;

export type PermissionCode = typeof definitions[number]['code'];
export interface PermissionDefinition {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly adminOnly: boolean;
  readonly dependencies: readonly string[];
}
export type RoleTemplates = Readonly<Record<EmployeeRole, readonly string[]>>;

// 冻结每一层，避免进程内误改配置影响其他员工的授权计算。
export const permissionDefinitions = Object.freeze(definitions.map(item => Object.freeze({
  ...item, dependencies: Object.freeze([...item.dependencies]),
})));
export const roleTemplates: RoleTemplates = Object.freeze({
  SUPER_ADMIN: Object.freeze(permissionDefinitions.map(item => item.code)),
  MERCH_WAREHOUSE: Object.freeze(permissionDefinitions.filter(item => item.defaultRole === 'MERCH_WAREHOUSE').map(item => item.code)),
  CUSTOMER_SERVICE: Object.freeze(permissionDefinitions.filter(item => item.defaultRole === 'CUSTOMER_SERVICE').map(item => item.code)),
});
