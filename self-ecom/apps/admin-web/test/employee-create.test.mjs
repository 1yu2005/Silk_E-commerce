/** 文件作用：验证员工创建权限、输入边界和请求白名单。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validatePassword } from '@shop/api-client';
import { canCreateEmployees, employeeCreateInput, employeeDisplayNameIssue, employeeReasonIssue, employeeRoleIssue, employeeUsernameIssue } from '../src/employees/create.ts';

test('创建入口按有效权限判断，查看权限不能冒充创建资格', () => {
  assert.equal(canCreateEmployees(null), false); assert.equal(canCreateEmployees({ effectivePermissions: ['employee.read'] }), false);
  assert.equal(canCreateEmployees({ effectivePermissions: ['employee.create'] }), true);
});
test('账号大小写与空白规范化，长度和字符规则与接口一致', () => {
  for (const value of [' abcd ', 'SERVICE_A', 'a' + '0'.repeat(31)]) assert.equal(employeeUsernameIssue(value), null);
  for (const value of [undefined, null, 123, '', 'abc', 'a'.repeat(33), '_abc', '1abc', '员工账号', 'a bc', 'abc-']) assert.ok(employeeUsernameIssue(value));
});
test('显示名必填且按Unicode码点校验40字符，保留中间空白', () => {
  for (const value of [undefined, null, '', ' \t ', '😀'.repeat(41)]) assert.ok(employeeDisplayNameIssue(value));
  for (const value of [' 😀 ', '😀'.repeat(40), '客服 甲']) assert.equal(employeeDisplayNameIssue(value), null);
});
test('创建原因必填，trim后最多500个Unicode字符', () => {
  for (const value of [undefined, '', ' \n ', '😀'.repeat(501)]) assert.ok(employeeReasonIssue(value));
  assert.equal(employeeReasonIssue(' ' + '😀'.repeat(500) + '\n'), null);
});
test('岗位仅允许固定三种，不能以对象继承属性绕过校验', () => {
  for (const role of ['SUPER_ADMIN', 'MERCH_WAREHOUSE', 'CUSTOMER_SERVICE']) assert.equal(employeeRoleIssue(role), null);
  for (const role of [undefined, '', 'admin', 'UNKNOWN', 'toString', 'constructor']) assert.ok(employeeRoleIssue(role));
});
test('规范化只处理文本，初始密码保留原文，确认和内部字段不发API', () => {
  const password = ' Raw#2026 ';
  const input = { username: ' SERVICE_A ', displayName: ' 客服 甲 ', role: 'CUSTOMER_SERVICE', initialPassword: password, reason: ' 新增客服 ',
    confirmation: password, status: 'DISABLED', mustChangePassword: false, version: 99 };
  assert.deepEqual(employeeCreateInput(input), { username: 'service_a', displayName: '客服 甲', role: 'CUSTOMER_SERVICE', initialPassword: password, reason: '新增客服' });
  assert.equal(input.username, ' SERVICE_A ');
});
test('初始密码复用共享字符和字节规则，不trim或截断', () => {
  for (const password of ['1234567', 'a'.repeat(65), '😀'.repeat(19), 'abcdefgh\ud800']) assert.ok(validatePassword(password));
  for (const password of [' '.repeat(8), ' Raw#2026 ', '😀'.repeat(18), 'a'.repeat(64)]) assert.equal(validatePassword(password), null);
});
