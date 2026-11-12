// 作用：提供创建员工的 HTTP 接口并声明访问权限与 Swagger 契约。
import { Body, Controller, Header, Inject, Post, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { EmployeeAccess } from '../auth/auth.decorators.js';
import { CurrentActor, readBearerToken, type AuthHttpRequest } from '../auth/auth-request-context.js';
import type { CurrentIdentity } from '../auth/current-identity.service.js';
import { authErrorSchema } from '../auth/employee-auth.openapi.js';
import { requestIdHeader } from '../health/health.openapi.js';
import { EmployeeCreateDto } from './employee-create.dto.js';
import { employeeCreateBodySchema, employeeCreateSuccessSchema } from './employee-create.openapi.js';
import { EmployeeCreateService } from './employee-create.service.js';

@Controller('admin/employees')
@ApiTags('Employees')
export class EmployeeCreateController {
  constructor(@Inject(EmployeeCreateService) private readonly employees: EmployeeCreateService) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  @EmployeeAccess('employee.create')
  @ApiBearerAuth('bearerAuth')
  @ApiOperation({ operationId: 'createEmployee', summary: '创建员工（包括管理员）',
    description: '锁内重新校验操作者当前会话、强制改密与employee.create权限。新员工ACTIVE、version=0、必须首次改密，无额外权限或会话。创建与审计同事务；创建管理员先取得稳定锁，重复账号含并发冲突返回409。响应不回显初始密码，不提供创建请求幂等键，响应丢失请先查询核实。' })
  @ApiBody({ schema: employeeCreateBodySchema })
  @ApiCreatedResponse({ headers: requestIdHeader, schema: employeeCreateSuccessSchema })
  @ApiBadRequestResponse({ headers: requestIdHeader, schema: authErrorSchema(['VALIDATION_FAILED']) })
  @ApiConflictResponse({ headers: requestIdHeader, schema: authErrorSchema(['USERNAME_EXISTS']) })
  @ApiForbiddenResponse({ headers: requestIdHeader, schema: authErrorSchema(['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED']) })
  @ApiUnauthorizedResponse({ headers: requestIdHeader, schema: authErrorSchema([
    'TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_SUBJECT_MISMATCH', 'SESSION_REVOKED', 'ACCOUNT_UNAVAILABLE',
  ]) })
  create(@Body() input: EmployeeCreateDto, @CurrentActor() actor: CurrentIdentity, @Req() request: AuthHttpRequest) {
    return this.employees.create(actor, readBearerToken(request), input, request.requestId);
  }
}
