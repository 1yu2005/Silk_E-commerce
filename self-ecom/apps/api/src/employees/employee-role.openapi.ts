// 作用：定义调整员工岗位并清空额外权限的 Swagger 请求规则、成功结构及错误响应。
import type { OpenAPIObject } from '@nestjs/swagger';
import { permissionDefinitions } from '../permissions/permission-catalog.js';

type Schema = NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>[string];
const roleSchema: Schema = { type: 'string', enum: ['SUPER_ADMIN', 'MERCH_WAREHOUSE', 'CUSTOMER_SERVICE'] };
export const employeeRoleBodySchema: Schema = { type: 'object', additionalProperties: false,
  required: ['role', 'expectedVersion', 'reason'], properties: {
    role: roleSchema,
    expectedVersion: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: '使用刚查询到的version，必须为JSON数字', example: 0 },
    reason: { type: 'string', minLength: 1, maxLength: 500, description: '去首尾空白，调岗原因必填', example: '调整为商品与仓储岗位' },
  } };
export const employeeRoleSuccessSchema: Schema = { type: 'object', additionalProperties: false,
  required: ['data', 'requestId'], properties: { requestId: { type: 'string', format: 'uuid' }, data: {
    type: 'object', additionalProperties: false, required: ['id', 'role', 'extraPermissions', 'version', 'permissionVersion', 'changed'], properties: {
      id: { type: 'string', format: 'uuid' }, role: roleSchema,
      extraPermissions: { type: 'array', uniqueItems: true, maxItems: permissionDefinitions.length,
        items: { type: 'string', enum: permissionDefinitions.map(item => item.code) }, description: '真实换岗清空；同岗位无变化保留现有额外授权' },
      version: { type: 'integer', minimum: 0 }, permissionVersion: { type: 'integer', minimum: 0 },
      changed: { type: 'boolean', description: '同岗位且版本匹配为false，不清空授权、不重复更新或审计' },
    },
  } } };
