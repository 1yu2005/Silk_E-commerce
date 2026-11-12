// 作用：定义替换员工个人额外权限的 Swagger 请求规则、成功结构及错误响应。
import type { OpenAPIObject } from '@nestjs/swagger';
import { permissionDefinitions } from '../permissions/permission-catalog.js';

type Schema = NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>[string];
const codes: Schema = { type: 'array', uniqueItems: true, maxItems: permissionDefinitions.length,
  items: { type: 'string', enum: permissionDefinitions.map(item => item.code) } };
export const employeeExtraPermissionBodySchema: Schema = { type: 'object', additionalProperties: false,
  required: ['permissions', 'expectedVersion', 'reason'], properties: {
    permissions: { type: 'array', maxItems: 200, items: { type: 'string', maxLength: 100 },
      description: '完整期望额外集合，空数组清空；重复码去重，不trim或更改大小写。未知/管理员专属码整次400；移除旧额外依赖优先级联撤销，新增才补齐依赖。' },
    expectedVersion: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: '使用刚查询到的version，必须为JSON数字', example: 0 },
    reason: { type: 'string', minLength: 1, maxLength: 500, description: '去首尾空白，授权/撤权原因必填', example: '客服兼顾发货登记' },
  } };
export const employeeExtraPermissionSuccessSchema: Schema = { type: 'object', additionalProperties: false,
  required: ['data', 'requestId'], properties: { requestId: { type: 'string', format: 'uuid' }, data: {
    type: 'object', additionalProperties: false,
    required: ['id', 'defaultPermissions', 'resolvedExtraPermissions', 'effectivePermissions', 'addedByDependency', 'removedByDependency', 'normalizedDefaultPermissions', 'version', 'permissionVersion', 'changed'],
    properties: {
      id: { type: 'string', format: 'uuid' }, defaultPermissions: codes, resolvedExtraPermissions: codes, effectivePermissions: codes,
      addedByDependency: { ...codes, description: '本次新增选择自动补齐的依赖' },
      removedByDependency: { ...codes, description: '因旧依赖被撤销而级联移除的请求操作' },
      normalizedDefaultPermissions: { ...codes, description: '已属于岗位默认、不重复存入额外表的请求项' },
      version: { type: 'integer', minimum: 0 }, permissionVersion: { type: 'integer', minimum: 0 },
      changed: { type: 'boolean', description: '解析后集合与现有相同为false，不重写授权关系、版本或审计' },
    },
  } } };
