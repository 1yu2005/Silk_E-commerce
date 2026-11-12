// 作用：定义员工认证、本人权限、改密及公共认证错误的 Swagger 结构。
import type { OpenAPIObject } from '@nestjs/swagger';
import { permissionDefinitions } from '../permissions/permission-catalog.js';
type Schema = NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>[string];
const requestId: Schema = { type: 'string', format: 'uuid' };
export const employeeSummarySchema: Schema = { type: 'object', additionalProperties: false,
  required: ['id', 'username', 'displayName', 'role', 'status', 'mustChangePassword'], properties: {
    id: { type: 'string', format: 'uuid' }, username: { type: 'string' }, displayName: { type: 'string' },
    role: { type: 'string', enum: ['SUPER_ADMIN', 'MERCH_WAREHOUSE', 'CUSTOMER_SERVICE'] },
    status: { type: 'string', enum: ['ACTIVE', 'DISABLED'] }, mustChangePassword: { type: 'boolean' },
  } };
export const employeeLoginBodySchema: Schema = { type: 'object', additionalProperties: false, required: ['username', 'password'], properties: {
  username: { type: 'string', minLength: 4, maxLength: 32, description: '去首尾空白并转小写后为字母开头，后接字母、数字或下划线', example: 'service_a' },
  password: { type: 'string', format: 'password', writeOnly: true, minLength: 8, maxLength: 64,
    description: '8～64个Unicode码点且UTF-8最多72字节，保留首尾空格，不截断或归一化', example: 'TempDemo#2026' },
} };
const changePasswordField: Schema = { type: 'string', format: 'password', writeOnly: true, minLength: 8, maxLength: 64,
  description: '8～64个Unicode码点且UTF-8最多72字节，保留空格，不截断或归一化；新旧密码必须不同' };
export const changePasswordBodySchema: Schema = { type: 'object', additionalProperties: false,
  required: ['oldPassword', 'newPassword'], properties: { oldPassword: changePasswordField, newPassword: changePasswordField } };
export const changePasswordSuccessSchema: Schema = { type: 'object', additionalProperties: false,
  required: ['data', 'requestId'], properties: { requestId, data: { type: 'object', additionalProperties: false,
    required: ['changed', 'requireLogin'], properties: { changed: { type: 'boolean', enum: [true] }, requireLogin: { type: 'boolean', enum: [true] } } } } };
const permissionCodesSchema: Schema = { type: 'array', uniqueItems: true, maxItems: permissionDefinitions.length,
  items: { type: 'string', enum: permissionDefinitions.map(item => item.code) } };
export const employeePermissionsSuccessSchema: Schema = { type: 'object', additionalProperties: false,
  required: ['data', 'requestId'], properties: { requestId, data: { type: 'object', additionalProperties: false,
    required: ['role', 'permissionVersion', 'defaultPermissions', 'extraPermissions', 'effectivePermissions'], properties: {
      role: { type: 'string', enum: ['SUPER_ADMIN', 'MERCH_WAREHOUSE', 'CUSTOMER_SERVICE'] },
      permissionVersion: { type: 'integer', minimum: 0, description: '当前数据库权限版本，调岗或授权变更后递增' },
      defaultPermissions: { ...permissionCodesSchema, description: '当前岗位固定默认权限，按权限码排序' },
      extraPermissions: { ...permissionCodesSchema, description: '当前个人额外授权，按权限码排序' },
      effectivePermissions: { ...permissionCodesSchema, description: '默认与额外授权合并后的最终权限，按权限码排序' },
    } } } };
export function employeeAuthSuccessSchema(login: boolean): Schema {
  return { type: 'object', additionalProperties: false, required: ['data', 'requestId'], properties: { requestId,
    data: login ? { type: 'object', additionalProperties: false,
      required: ['accessToken', 'tokenType', 'expiresAt', 'mustChangePassword', 'employee'], properties: {
        accessToken: { type: 'string', description: '仅登录成功返回的JWT，Authorize输入token本体' },
        tokenType: { type: 'string', enum: ['Bearer'] }, expiresAt: { type: 'string', format: 'date-time' },
        mustChangePassword: { type: 'boolean' }, employee: employeeSummarySchema,
      } } : employeeSummarySchema,
  } };
}
export function authErrorSchema(codes: string[]): Schema {
  return { type: 'object', required: ['code', 'message', 'requestId'], properties: {
    code: { type: 'string', enum: codes }, message: { type: 'string' }, requestId,
    details: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, message: { type: 'string' } } } },
  } };
}
