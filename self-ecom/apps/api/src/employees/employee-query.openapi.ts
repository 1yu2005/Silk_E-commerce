// 作用：定义查询员工列表、详情及权限的 Swagger 请求规则、成功结构及错误响应。
import type { OpenAPIObject } from '@nestjs/swagger';
import { permissionDefinitions } from '../permissions/permission-catalog.js';

type Schema = NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>[string];
export const employeeRoles = ['SUPER_ADMIN', 'MERCH_WAREHOUSE', 'CUSTOMER_SERVICE'];
export const employeeStatuses = ['ACTIVE', 'DISABLED'];
const itemProperties: Record<string, Schema> = {
  id: { type: 'string', format: 'uuid' }, username: { type: 'string' }, displayName: { type: 'string' },
  role: { type: 'string', enum: employeeRoles }, status: { type: 'string', enum: employeeStatuses },
  mustChangePassword: { type: 'boolean' }, version: { type: 'integer', minimum: 0 },
  createdAt: { type: 'string', format: 'date-time' }, lastLoginAt: { type: 'string', format: 'date-time', nullable: true },
};
const permissionArray: Schema = { type: 'array', uniqueItems: true, maxItems: permissionDefinitions.length,
  items: { type: 'string', enum: permissionDefinitions.map(item => item.code) } };
function envelope(data: Schema): Schema {
  return { type: 'object', additionalProperties: false, required: ['data', 'requestId'],
    properties: { requestId: { type: 'string', format: 'uuid' }, data } };
}
export const employeePublicSchema: Schema = { type: 'object', additionalProperties: false,
  required: Object.keys(itemProperties), properties: itemProperties };
export const employeeListSuccessSchema = envelope({ type: 'object', additionalProperties: false,
  required: ['items', 'total', 'page', 'pageSize'], properties: {
    items: { type: 'array', maxItems: 100, items: employeePublicSchema },
    total: { type: 'integer', minimum: 0 }, page: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
  } });
const detailProperties = { ...itemProperties, permissionVersion: { type: 'integer', minimum: 0 } as Schema,
  defaultPermissions: permissionArray, extraPermissions: permissionArray, effectivePermissions: permissionArray };
export const employeeDetailSuccessSchema = envelope({ type: 'object', additionalProperties: false,
  required: Object.keys(detailProperties), properties: detailProperties });
