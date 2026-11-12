// 作用：验证固定权限目录、岗位模板、依赖补齐和撤销依赖优先规则。
import { expect, it } from 'vitest';
import { permissionDefinitions, roleTemplates, type PermissionDefinition, type RoleTemplates } from '../src/permissions/permission-catalog.js';
import { PermissionInputError, PermissionService, validatePermissionCatalog } from '../src/permissions/permission.service.js';

const permissions = new PermissionService();
const service = 'CUSTOMER_SERVICE';
const warehouse = 'MERCH_WAREHOUSE';

it('公开目录返回独立的嵌套数据，不允许调用方污染固定模板或后续权限计算', () => {
  const before = permissions.catalog(); const changed = permissions.catalog();
  const shipment = changed.permissions.find(item => item.code === 'shipment.handover')!;
  shipment.name = before.permissions[0]!.name; shipment.dependencies.length = 0; changed.permissions.pop();
  changed.roleTemplates.SUPER_ADMIN.length = 0; changed.roleTemplates.CUSTOMER_SERVICE.push('employee.read');
  expect(permissions.catalog()).toEqual(before);
  expect(permissions.effectivePermissions('CUSTOMER_SERVICE', [])).not.toContain('employee.read');
  expect(permissions.effectivePermissions('SUPER_ADMIN', [])).toHaveLength(52);
});

it('固定岗位符合业务分工，管理员拥有全部能力，普通岗位不含管理员权限', () => {
  expect(permissionDefinitions).toHaveLength(52);
  expect(roleTemplates.MERCH_WAREHOUSE).toHaveLength(25);
  expect(roleTemplates.CUSTOMER_SERVICE).toHaveLength(12);
  expect(permissions.effectivePermissions('SUPER_ADMIN', [])).toHaveLength(52);
  expect(roleTemplates.MERCH_WAREHOUSE).toContain('product.cost.read');
  expect(roleTemplates.MERCH_WAREHOUSE).not.toContain('customer.read');
  expect(roleTemplates.MERCH_WAREHOUSE).not.toContain('after-sale.refund.execute');
  expect(roleTemplates.CUSTOMER_SERVICE).toContain('after-sale.refund.execute');
  expect(roleTemplates.CUSTOMER_SERVICE).not.toContain('product.cost.read');
  expect(roleTemplates.CUSTOMER_SERVICE).not.toContain('shipment.handover');
  for (const item of permissionDefinitions.filter(item => item.adminOnly)) {
    expect(roleTemplates.MERCH_WAREHOUSE).not.toContain(item.code);
    expect(roleTemplates.CUSTOMER_SERVICE).not.toContain(item.code);
  }
});

it('客服完整发货授权补齐查询和领取，不获得商品或库存权限', () => {
  const result = permissions.resolveExtraPermissions(service, [], ['shipment.pack', 'shipment.handover', 'shipment.tracking.correct']);
  expect(result.resolvedExtraPermissions).toEqual(['order.fulfillment.read', 'shipment.claim', 'shipment.handover', 'shipment.pack', 'shipment.tracking.correct']);
  expect(result.addedByDependency).toEqual(['order.fulfillment.read', 'shipment.claim']);
  expect(result.removedByDependency).toEqual([]);
  expect(result.effectivePermissions).not.toContain('product.read');
  expect(result.effectivePermissions).not.toContain('inventory.read');
});

it('只授交运可补齐查询和领取，但不隐式授予打包或退款之外的新职责', () => {
  const result = permissions.resolveExtraPermissions(service, [], ['shipment.handover']);
  expect(result.resolvedExtraPermissions).toEqual(['order.fulfillment.read', 'shipment.claim', 'shipment.handover']);
  expect(result.effectivePermissions).not.toContain('shipment.pack');
});

it('只授运单修正不隐式获得领取或交运', () => {
  expect(permissions.resolveExtraPermissions(service, [], ['shipment.tracking.correct']).resolvedExtraPermissions)
    .toEqual(['order.fulfillment.read', 'shipment.tracking.correct']);
});

it('撤销旧履约查询优先级联删除操作，不会被闭包补回', () => {
  const old = permissions.resolveExtraPermissions(service, [], ['shipment.pack', 'shipment.handover', 'shipment.tracking.correct']).resolvedExtraPermissions;
  const result = permissions.resolveExtraPermissions(service, old, old.filter(code => code !== 'order.fulfillment.read'));
  expect(result.resolvedExtraPermissions).toEqual([]);
  expect(result.removedByDependency).toEqual(['shipment.claim', 'shipment.handover', 'shipment.pack', 'shipment.tracking.correct']);
  expect(result.effectivePermissions).toEqual([...roleTemplates.CUSTOMER_SERVICE].sort());
});

it('撤销领取会删除交运和打包，仍保留独立运单修正', () => {
  const old = permissions.resolveExtraPermissions(service, [], ['shipment.pack', 'shipment.handover', 'shipment.tracking.correct']).resolvedExtraPermissions;
  const result = permissions.resolveExtraPermissions(service, old, old.filter(code => code !== 'shipment.claim'));
  expect(result.resolvedExtraPermissions).toEqual(['order.fulfillment.read', 'shipment.tracking.correct']);
  expect(result.removedByDependency).toEqual(['shipment.handover', 'shipment.pack']);
});

it('新操作同样不能绕过明确撤销的旧依赖', () => {
  const result = permissions.resolveExtraPermissions(service, ['order.fulfillment.read'], ['shipment.handover']);
  expect(result.resolvedExtraPermissions).toEqual([]);
  expect(result.removedByDependency).toEqual(['shipment.handover']);
});

it('此前未存在的依赖属于新增补齐，不视为撤销', () => {
  const result = permissions.resolveExtraPermissions(service, ['dashboard.read'], ['dashboard.read', 'shipment.handover']);
  expect(result.resolvedExtraPermissions).toContain('shipment.handover');
  expect(result.addedByDependency).toEqual(['order.fulfillment.read', 'shipment.claim']);
});

it('退货验收递归补齐库存和商品查询，但不授予成本、管理、退款', () => {
  const result = permissions.resolveExtraPermissions(service, [], ['after-sale.inspection.confirm']);
  expect(result.resolvedExtraPermissions).toEqual(['after-sale.inspection.confirm', 'after-sale.inspection.read', 'category.read', 'inventory.read', 'order.fulfillment.read', 'product.read']);
  expect(result.effectivePermissions).not.toContain('product.cost.read');
  expect(result.effectivePermissions).not.toContain('product.manage');
  expect(result.resolvedExtraPermissions).not.toContain('after-sale.refund.execute');
});

it('仓储额外退款重试包含退款执行和服务查询，不获得管理员能力', () => {
  const result = permissions.resolveExtraPermissions(warehouse, [], ['after-sale.refund.retry']);
  expect(result.resolvedExtraPermissions).toEqual(['after-sale.refund.execute', 'after-sale.refund.retry', 'after-sale.service.read', 'order.service.read']);
  expect(result.effectivePermissions).not.toContain('after-sale.dispute.decide');
});

it('清空额外权限保留全部默认权限，默认项重复提交只规范化不移除', () => {
  const result = permissions.resolveExtraPermissions(warehouse, ['customer.read'], ['inventory.read', 'inventory.read']);
  expect(result.resolvedExtraPermissions).toEqual([]);
  expect(result.normalizedDefaultPermissions).toEqual(['inventory.read']);
  expect(result.effectivePermissions).toEqual([...roleTemplates.MERCH_WAREHOUSE].sort());
});

it('查询依赖由默认岗位提供时不重复存储为额外权限', () => {
  const result = permissions.resolveExtraPermissions(warehouse, [], ['shipment.handover']);
  expect(result.resolvedExtraPermissions).toEqual([]);
  expect(result.normalizedDefaultPermissions).toEqual(['shipment.handover']);
  expect(result.addedByDependency).toEqual([]);
});

it('普通员工逐个授权全部可下放动作后依赖完整，且绝不含管理员能力', () => {
  for (const role of [service, warehouse] as const) {
    for (const definition of permissionDefinitions.filter(item => !item.adminOnly)) {
      const result = permissions.resolveExtraPermissions(role, [], [definition.code]);
      expect(result.effectivePermissions).toContain(definition.code);
      expect(permissions.effectivePermissions(role, result.resolvedExtraPermissions)).toEqual(result.effectivePermissions);
      for (const code of result.effectivePermissions) {
        const item = permissionDefinitions.find(item => item.code === code)!;
        expect(item.adminOnly).toBe(false);
        for (const dependency of item.dependencies) expect(result.effectivePermissions).toContain(dependency);
      }
    }
  }
});

it.each(['employee.permission.manage', 'customer.status.manage', 'audit.read', 'after-sale.dispute.decide', 'unknown.permission'])('拒绝下放%s并提供稳定错误码', code => {
  expect(() => permissions.resolveExtraPermissions(service, [], [code])).toThrow(PermissionInputError);
  try { permissions.resolveExtraPermissions(service, [], [code]); }
  catch (error) { expect(error).toMatchObject({ code: 'PERMISSION_NOT_GRANTABLE' }); }
});

it('所有管理员专属权限均不能下放，即使和合法权限混合也整次失败', () => {
  for (const item of permissionDefinitions.filter(item => item.adminOnly)) {
    expect(() => permissions.resolveExtraPermissions(service, [], ['shipment.handover', item.code]))
      .toThrow('额外权限包含未知或不可下放的权限');
  }
});

it('超级管理员禁止个人授权入口，包括空集合', () => {
  for (const requested of [[], ['shipment.handover']]) {
    expect(() => permissions.resolveExtraPermissions('SUPER_ADMIN', [], requested)).toThrow('超级管理员不使用个人额外权限');
  }
});

it('读取不默默修复脏授权或扩大权限', () => {
  expect(() => permissions.effectivePermissions(service, ['shipment.handover'])).toThrow('已保存的员工权限缺少依赖');
  expect(() => permissions.effectivePermissions(service, ['employee.create'])).toThrow(PermissionInputError);
  expect(() => permissions.effectivePermissions(service, ['unknown.permission'])).toThrow(PermissionInputError);
});

it('授权计算无副作用，不修改同岗位他人、调用方数组或固定模板', () => {
  const old: string[] = []; const requested = ['shipment.handover', 'shipment.handover'];
  const unchanged = permissions.effectivePermissions(service, []);
  const result = permissions.resolveExtraPermissions(service, old, requested);
  result.effectivePermissions.length = 0;
  expect(old).toEqual([]);
  expect(requested).toEqual(['shipment.handover', 'shipment.handover']);
  expect(permissions.effectivePermissions(service, [])).toEqual(unchanged);
  expect(Object.isFrozen(roleTemplates.CUSTOMER_SERVICE)).toBe(true);
  expect(Object.isFrozen(permissionDefinitions[0]?.dependencies)).toBe(true);
});

const definition = (code: string, dependencies: string[] = [], adminOnly = false): PermissionDefinition => ({ code, name: '测试权限', description: '测试', adminOnly, dependencies });
const templates = (all: string[], warehouse: string[], service: string[] = []): RoleTemplates => ({ SUPER_ADMIN: all, MERCH_WAREHOUSE: warehouse, CUSTOMER_SERVICE: service });

it.each([
  { name: '重复目录码', definitions: [definition('a'), definition('a')], roles: templates(['a'], ['a']), message: '权限目录存在重复码' },
  { name: '未知依赖', definitions: [definition('a', ['b'])], roles: templates(['a'], ['a']), message: '权限目录依赖不存在' },
  { name: '自环', definitions: [definition('a', ['a'])], roles: templates(['a'], ['a']), message: '权限依赖存在环' },
  { name: '多层环', definitions: [definition('a', ['b']), definition('b', ['c']), definition('c', ['a'])], roles: templates(['a', 'b', 'c'], ['a', 'b', 'c']), message: '权限依赖存在环' },
  { name: '模板缺依赖', definitions: [definition('a', ['b']), definition('b')], roles: templates(['a', 'b'], ['a'], ['b']), message: '岗位模板缺少依赖' },
  { name: '模板下放管理权', definitions: [definition('a', [], true)], roles: templates(['a'], ['a']), message: '普通岗位不得拥有管理员能力' },
  { name: '普通动作依赖管理权', definitions: [definition('a', ['b']), definition('b', [], true)], roles: templates(['a', 'b'], ['a']), message: '普通权限不得依赖管理员能力' },
  { name: '管理员未拥有全部', definitions: [definition('a'), definition('b')], roles: templates(['a'], ['a', 'b']), message: '超级管理员必须拥有全部目录权限' },
  { name: '孤立普通权限', definitions: [definition('a')], roles: templates(['a'], []), message: '普通权限必须归属普通岗位模板' },
])('配置错误$name必须失败', ({ definitions, roles, message }) => {
  expect(() => validatePermissionCatalog(definitions, roles)).toThrow(message);
});
