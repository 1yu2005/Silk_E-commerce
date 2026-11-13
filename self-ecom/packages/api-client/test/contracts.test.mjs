/** 文件作用：验证前端公开契约可用且共享密码规则符合接口约定。 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';

// 读取已发布声明，用真实OpenAPI核对字段和必填性，防止客户端类型悄悄偏离API。
const file = fileURLToPath(new URL('../../shared/dist/index.d.ts', import.meta.url));
const program = ts.createProgram([file], { strict: true, noEmit: true, skipLibCheck: true }); const checker = program.getTypeChecker();
const source = program.getSourceFile(file); const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(source));
const spec = JSON.parse(readFileSync(new URL('../../../docs/openapi/openapi.json', import.meta.url), 'utf8'));
const request = (path, method) => spec.paths[path][method].requestBody.content['application/json'].schema;
const data = (path, method = 'get', status = '200') => spec.paths[path][method].responses[status].content['application/json'].schema.properties.data;
function type(name) {
  const symbol = exports.find(symbol => symbol.name === name); assert.ok(symbol, name);
  return checker.getDeclaredTypeOfSymbol(symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol);
}
const contracts = [
  ['EmployeeLoginInput', request('/api/v1/admin/auth/login', 'post')],
  ['CustomerLoginInput', request('/api/v1/store/auth/login', 'post')],
  ['CustomerRegisterInput', request('/api/v1/store/auth/register', 'post')],
  ['CustomerProfileInput', request('/api/v1/store/me', 'patch')],
  ['ChangePasswordInput', request('/api/v1/store/auth/change-password', 'post')],
  ['EmployeeProfile', data('/api/v1/admin/me')], ['CustomerProfile', data('/api/v1/store/me')],
  ['EmployeeLoginData', data('/api/v1/admin/auth/login', 'post')], ['CustomerLoginData', data('/api/v1/store/auth/login', 'post')],
  ['CustomerRegisterData', data('/api/v1/store/auth/register', 'post', '201')], ['EmployeePermissions', data('/api/v1/admin/me/permissions')],
  ['ChangePasswordData', data('/api/v1/store/auth/change-password', 'post')], ['LogoutData', data('/api/v1/auth/logout', 'post')],
  ['EmployeeListItem', data('/api/v1/admin/employees').properties.items.items],
  ['EmployeeListData', data('/api/v1/admin/employees')], ['EmployeeDetail', data('/api/v1/admin/employees/{id}')],
  ['EmployeeListQuery', { properties: Object.fromEntries(spec.paths['/api/v1/admin/employees'].get.parameters.map(parameter => [parameter.name, parameter.schema])), required: [] }],
  ['EmployeeCreateInput', request('/api/v1/admin/employees', 'post')],
  ['EmployeeCreateData', data('/api/v1/admin/employees', 'post', '201')],
  ['EmployeeProfileInput', request('/api/v1/admin/employees/{id}/profile', 'patch')],
  ['EmployeeProfileData', data('/api/v1/admin/employees/{id}/profile', 'patch')],
  ['EmployeeCommandInput', request('/api/v1/admin/employees/{id}/disable', 'post')],
  ['EmployeeStatusData', data('/api/v1/admin/employees/{id}/enable', 'post')],
  ['EmployeePasswordResetInput', request('/api/v1/admin/employees/{id}/reset-password', 'post')],
  ['EmployeePasswordResetData', data('/api/v1/admin/employees/{id}/reset-password', 'post')],
  ['EmployeeRoleInput', request('/api/v1/admin/employees/{id}/change-role', 'post')],
  ['EmployeeRoleData', data('/api/v1/admin/employees/{id}/change-role', 'post')],
  ['EmployeeExtraPermissionsInput', request('/api/v1/admin/employees/{id}/extra-permissions', 'put')],
  ['EmployeeExtraPermissionsData', data('/api/v1/admin/employees/{id}/extra-permissions', 'put')],
  ['PermissionCatalog', data('/api/v1/admin/permissions')],
  ['PermissionDefinition', data('/api/v1/admin/permissions').properties.permissions.items],
  ['FileMetadata', data('/api/v1/files/{id}')],
  ['CustomerAvatarData', data('/api/v1/store/me/avatar', 'put')],
  ['CustomerAvatarData', data('/api/v1/store/me/avatar', 'delete')],
];
for (const [name, schema] of contracts) {
  test(`${name}声明的字段及必填性与导出OpenAPI一致`, () => {
    const fields = checker.getPropertiesOfType(type(name)); assert.deepEqual(fields.map(field => field.name).sort(), Object.keys(schema.properties).sort());
    assert.deepEqual(fields.filter(field => !(field.flags & ts.SymbolFlags.Optional)).map(field => field.name).sort(), [...schema.required].sort());
  });
}
test('岗位、可用顾客状态及固定成功标记与API枚举一致', () => {
  for (const [name, field, schema] of [['EmployeeProfile', 'role', data('/api/v1/admin/me')], ['EmployeeProfile', 'status', data('/api/v1/admin/me')],
    ['CustomerProfile', 'status', data('/api/v1/store/me')],
    ['EmployeeLoginData', 'tokenType', data('/api/v1/admin/auth/login', 'post')], ['ChangePasswordData', 'changed', data('/api/v1/store/auth/change-password', 'post')],
    ['ChangePasswordData', 'requireLogin', data('/api/v1/store/auth/change-password', 'post')], ['LogoutData', 'loggedOut', data('/api/v1/auth/logout', 'post')]]) {
    const symbol = checker.getPropertyOfType(type(name), field); const value = checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration);
    const values = (value.isUnion() ? value.types : [value]).map(item => item.flags & ts.TypeFlags.Null ? null : item.flags & ts.TypeFlags.BooleanLiteral ? item.intrinsicName === 'true' : item.value);
    assert.deepEqual(values.sort(), [...schema.properties[field].enum].sort(), `${name}.${field}`);
  }
});

test('员工查询枚举、可空登录时间及分页元素与导出OpenAPI一致', () => {
  for (const field of ['role', 'status']) {
    const symbol = checker.getPropertyOfType(type('EmployeeListItem'), field);
    const value = checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration);
    assert.deepEqual(value.types.map(item => item.value).sort(), [...data('/api/v1/admin/employees').properties.items.items.properties[field].enum].sort());
  }
  const lastLogin = checker.getPropertyOfType(type('EmployeeDetail'), 'lastLoginAt');
  const lastLoginType = checker.getTypeOfSymbolAtLocation(lastLogin, lastLogin.valueDeclaration);
  assert.ok(lastLoginType.types.some(value => value.flags & ts.TypeFlags.Null));
  assert.equal(data('/api/v1/admin/employees/{id}').properties.lastLoginAt.nullable, true);
  const items = checker.getPropertyOfType(type('EmployeeListData'), 'items');
  const itemType = checker.getIndexTypeOfType(checker.getTypeOfSymbolAtLocation(items, items.valueDeclaration), ts.IndexKind.Number);
  assert.equal(checker.typeToString(itemType), 'EmployeeListItem');
});

test('头像声明为string|null，设置和移除成功响应均明确声明该结构', () => {
  const symbol = checker.getPropertyOfType(type('CustomerProfile'), 'avatarUrl');
  const value = checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration);
  assert.ok(value.types.some(item => item.flags & ts.TypeFlags.Null));
  assert.ok(value.types.some(item => item.flags & ts.TypeFlags.String));
  for (const schema of [data('/api/v1/store/me'), data('/api/v1/store/me/avatar', 'put'), data('/api/v1/store/me/avatar', 'delete')]) {
    assert.equal(schema.properties.avatarUrl.type, 'string'); assert.equal(schema.properties.avatarUrl.nullable, true);
  }
});
