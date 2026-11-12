// 作用：定义创建员工的 Swagger 请求规则、成功结构及错误响应。
import type { OpenAPIObject } from '@nestjs/swagger';
import { employeePublicSchema, employeeRoles } from './employee-query.openapi.js';

type Schema = NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>[string];
export const employeeCreateBodySchema: Schema = { type: 'object', additionalProperties: false,
  required: ['username', 'displayName', 'role', 'initialPassword', 'reason'], properties: {
    username: { type: 'string', minLength: 4, maxLength: 32,
      description: '去首尾空白并转小写后为小写字母开头，后接小写字母、数字或下划线', example: 'service_a' },
    displayName: { type: 'string', minLength: 1, maxLength: 40, description: '去首尾空白，不能为空', example: '客服甲' },
    role: { type: 'string', enum: employeeRoles },
    initialPassword: { type: 'string', format: 'password', writeOnly: true, minLength: 8, maxLength: 64,
      description: '8～64个Unicode码点且UTF-8最多72字节；保留空格，不截断或归一化', example: 'TempDemo#2026' },
    reason: { type: 'string', minLength: 1, maxLength: 500, description: '去首尾空白，创建原因必填', example: '新增客服测试账号' },
  } };
export const employeeCreateSuccessSchema: Schema = { type: 'object', additionalProperties: false,
  required: ['data', 'requestId'], properties: { requestId: { type: 'string', format: 'uuid' }, data: employeePublicSchema } };
