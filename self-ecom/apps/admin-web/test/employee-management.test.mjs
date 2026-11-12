/** 文件作用：验证员工管理权限、原因、依赖预览和旧登录写入隔离。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthSessionStore } from '@shop/api-client';
import { canManageEmployee, managementReasonIssue, previewExtraPermissions, runEmployeeMutation } from '../src/employees/management.ts';

const ordinary = ['query', 'claim', 'pack', 'handover', 'service'];
const catalog = { permissions: [
  { code: 'query', name: '查询', dependencies: [], adminOnly: false },
  { code: 'claim', name: '认领', dependencies: ['query'], adminOnly: false },
  { code: 'pack', name: '打包', dependencies: ['claim'], adminOnly: false },
  { code: 'handover', name: '交接', dependencies: ['pack'], adminOnly: false },
  { code: 'service', name: '客服', dependencies: [], adminOnly: false },
  { code: 'admin', name: '管理', dependencies: [], adminOnly: true },
], roleTemplates: { SUPER_ADMIN: [...ordinary, 'admin'], MERCH_WAREHOUSE: ordinary.slice(0, 4), CUSTOMER_SERVICE: ['service'] } };
test('管理入口逐项依据有效权限而非岗位名称', () => {
  for (const [operation, code] of Object.entries({ profile: 'employee.profile.update', status: 'employee.status.manage', reset: 'employee.password.reset', role: 'employee.role.change', permissions: 'employee.permission.manage' })) {
    assert.equal(canManageEmployee(null, operation), false);
    assert.equal(canManageEmployee({ role: 'SUPER_ADMIN', effectivePermissions: [] }, operation), false);
    assert.equal(canManageEmployee({ effectivePermissions: [code] }, operation), true);
  }
});
test('管理原因trim并按Unicode码点校验，不截断emoji', () => {
  for (const value of [null, '', ' \n ']) assert.ok(managementReasonIssue(value));
  assert.equal(managementReasonIssue(' 😀 '.repeat(1)), null); assert.equal(managementReasonIssue('😀'.repeat(500)), null);
  assert.ok(managementReasonIssue('😀'.repeat(501)));
});
test('新增操作递归补齐、排序去重，默认码不存额外且不修改输入', () => {
  const requested = ['handover', 'handover', 'service']; const before = structuredClone(catalog);
  assert.deepEqual(previewExtraPermissions(catalog, 'CUSTOMER_SERVICE', [], requested), {
    defaultPermissions: ['service'], resolvedExtraPermissions: ['claim', 'handover', 'pack', 'query'], effectivePermissions: ['claim', 'handover', 'pack', 'query', 'service'],
    addedByDependency: ['claim', 'pack', 'query'], removedByDependency: [], normalizedDefaultPermissions: ['service'],
  });
  assert.deepEqual(catalog, before); assert.deepEqual(requested, ['handover', 'handover', 'service']);
});
test('撤销旧依赖优先级联，另一新增操作不能补回', () => {
  const result = previewExtraPermissions(catalog, 'CUSTOMER_SERVICE', ['query', 'claim', 'pack'], ['claim', 'pack', 'handover']);
  assert.deepEqual(result.resolvedExtraPermissions, []); assert.deepEqual(result.removedByDependency, ['claim', 'handover', 'pack']);
  assert.deepEqual(result.effectivePermissions, ['service']);
});
test('完整旧集合无变化、清空、默认权限不能撤销', () => {
  const before = ['query', 'claim', 'pack'];
  assert.deepEqual(previewExtraPermissions(catalog, 'CUSTOMER_SERVICE', before, before).resolvedExtraPermissions, ['claim', 'pack', 'query']);
  assert.deepEqual(previewExtraPermissions(catalog, 'CUSTOMER_SERVICE', before, []).resolvedExtraPermissions, []);
  assert.deepEqual(previewExtraPermissions(catalog, 'MERCH_WAREHOUSE', ['service'], []).effectivePermissions, ordinary.slice(0, 4).sort());
});
test('管理员目标、未知码、管理员专属码和旧缺依赖拒绝预览', () => {
  for (const [role, old, requested] of [['SUPER_ADMIN', [], []], ['CUSTOMER_SERVICE', [], ['unknown']], ['CUSTOMER_SERVICE', [], ['admin']], ['CUSTOMER_SERVICE', ['pack'], []]]) {
    assert.throws(() => previewExtraPermissions(catalog, role, old, requested));
  }
});
test('目录重复、未知依赖、循环、模板缺依赖或管理员码禁止保存', () => {
  const mutations = [
    copy => copy.permissions.push(copy.permissions[0]), copy => copy.permissions[0].dependencies.push('unknown'),
    copy => copy.permissions[0].dependencies.push('pack'), copy => copy.roleTemplates.MERCH_WAREHOUSE.splice(0, 1),
    copy => copy.roleTemplates.CUSTOMER_SERVICE.push('admin'), copy => copy.roleTemplates.SUPER_ADMIN.pop(),
    copy => copy.permissions[0].dependencies.push('admin'),
  ];
  for (const mutate of mutations) { const copy = structuredClone(catalog); mutate(copy); assert.throws(() => previewExtraPermissions(copy, 'CUSTOMER_SERVICE', [], [])); }
});
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture() {
  const session = new AuthSessionStore('EMPLOYEE', { storage: () => null });
  const save = () => session.save({ accessToken: 'same-token', tokenType: 'Bearer', expiresAt: new Date(Date.now() + 60_000).toISOString() });
  save(); return { session, save };
}
test('当前写成功仅一次提交与缓存回调，当前错误原样传递', async () => {
  const { session } = fixture(); let calls = 0; let committed = 0;
  const result = await runEmployeeMutation(session, async () => { calls++; return { data: { version: 2 } }; }, () => { committed++; });
  assert.deepEqual(result, { version: 2 }); assert.equal(calls, 1); assert.equal(committed, 1);
  const failure = new Error('失败'); await assert.rejects(runEmployeeMutation(session, async () => { throw failure; }, () => { committed++; }), failure); assert.equal(committed, 1);
});
test('旧登录迟到成功与失败不能失效新缓存或刷新身份，即使token相同', async () => {
  for (const failure of [false, true]) {
    const { session, save } = fixture(); const gate = deferred(); let commits = 0;
    const pending = runEmployeeMutation(session, () => gate.promise, () => { commits++; }); save();
    if (failure) gate.reject(new Error('旧错误')); else gate.resolve({ data: { version: 2 } });
    assert.equal(await pending, null); assert.equal(commits, 0); assert.ok(session.current().credential);
  }
});
test('未登录不发命令，退出后在途成功不执行回调', async () => {
  const { session } = fixture(); const gate = deferred(); let commits = 0;
  const pending = runEmployeeMutation(session, () => gate.promise, () => { commits++; }); session.clear(); gate.resolve({ data: true });
  assert.equal(await pending, null); assert.equal(await runEmployeeMutation(session, () => { throw new Error('不能请求'); }, () => { commits++; }), null); assert.equal(commits, 0);
});
