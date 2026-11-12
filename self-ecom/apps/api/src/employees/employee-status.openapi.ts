// 作用：定义启用或停用员工的 Swagger 请求规则、成功结构及错误响应。
import type { OpenAPIObject } from '@nestjs/swagger';

type Schema = NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>[string];
export const employeeStatusBodySchema: Schema = { type: 'object', additionalProperties: false,
  required: ['expectedVersion', 'reason'], properties: {
    expectedVersion: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: '使用刚查询到的version，必须为JSON数字', example: 0 },
    reason: { type: 'string', minLength: 1, maxLength: 500, description: '去首尾空白，启停原因必填', example: '员工暂时离岗' },
  } };
export const employeeStatusSuccessSchema: Schema = { type: 'object', additionalProperties: false,
  required: ['data', 'requestId'], properties: { requestId: { type: 'string', format: 'uuid' },
    data: { type: 'object', additionalProperties: false, required: ['id', 'status', 'version', 'changed'], properties: {
      id: { type: 'string', format: 'uuid' }, status: { type: 'string', enum: ['ACTIVE', 'DISABLED'] },
      version: { type: 'integer', minimum: 0 }, changed: { type: 'boolean', description: '同状态且版本匹配为false，不重复写入或审计' },
    } },
  } };
