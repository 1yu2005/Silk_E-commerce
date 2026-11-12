// 作用：定义修改员工显示名的 Swagger 请求规则、成功结构及错误响应。
import type { OpenAPIObject } from '@nestjs/swagger';
import { employeePublicSchema } from './employee-query.openapi.js';

type Schema = NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>[string];
export const employeeProfileBodySchema: Schema = { type: 'object', additionalProperties: false,
  required: ['displayName', 'expectedVersion', 'reason'], properties: {
    displayName: { type: 'string', minLength: 1, maxLength: 40, description: '去首尾空白，不能为空', example: '客服甲（晚班）' },
    expectedVersion: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: '使用刚查询到的version，必须为JSON数字', example: 0 },
    reason: { type: 'string', minLength: 1, maxLength: 500, description: '去首尾空白，修改原因必填', example: '调整显示名' },
  } };
export const employeeProfileSuccessSchema: Schema = { type: 'object', additionalProperties: false,
  required: ['data', 'requestId'], properties: { requestId: { type: 'string', format: 'uuid' }, data: employeePublicSchema } };
