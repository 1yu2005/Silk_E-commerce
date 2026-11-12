// 作用：定义固定权限目录和岗位模板查询的 Swagger 响应结构。
import type { OpenAPIObject } from '@nestjs/swagger';
import { permissionDefinitions } from './permission-catalog.js';

type Schema = NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>[string];
const permissionCode: Schema = { type: 'string', enum: permissionDefinitions.map(item => item.code) };
const codeArray: Schema = { type: 'array', uniqueItems: true, maxItems: permissionDefinitions.length, items: permissionCode };
export const permissionCatalogSuccessSchema: Schema = {
  type: 'object', additionalProperties: false, required: ['data', 'requestId'], properties: {
    requestId: { type: 'string', format: 'uuid' },
    data: { type: 'object', additionalProperties: false, required: ['permissions', 'roleTemplates'], properties: {
      permissions: { type: 'array', minItems: permissionDefinitions.length, maxItems: permissionDefinitions.length,
        items: { type: 'object', additionalProperties: false, required: ['code', 'name', 'description', 'adminOnly', 'dependencies'],
          properties: { code: permissionCode, name: { type: 'string' }, description: { type: 'string' },
            adminOnly: { type: 'boolean' }, dependencies: codeArray } } },
      roleTemplates: { type: 'object', additionalProperties: false,
        required: ['SUPER_ADMIN', 'MERCH_WAREHOUSE', 'CUSTOMER_SERVICE'], properties: {
          SUPER_ADMIN: codeArray, MERCH_WAREHOUSE: codeArray, CUSTOMER_SERVICE: codeArray,
        } },
    } },
  },
};
