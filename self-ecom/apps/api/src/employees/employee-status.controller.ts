// 作用：提供启用或停用员工的 HTTP 接口并声明访问权限与 Swagger 契约。
import { Body, Controller, Header, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiConflictResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { EmployeeAccess } from '../auth/auth.decorators.js';
import { CurrentActor, readBearerToken, type AuthHttpRequest } from '../auth/auth-request-context.js';
import type { CurrentIdentity } from '../auth/current-identity.service.js';
import { authErrorSchema } from '../auth/employee-auth.openapi.js';
import { requestIdHeader } from '../health/health.openapi.js';
import { EmployeeIdParamsDto } from './employee-query.dto.js';
import { EmployeeStatusDto } from './employee-status.dto.js';
import { employeeStatusBodySchema, employeeStatusSuccessSchema } from './employee-status.openapi.js';
import { EmployeeStatusService } from './employee-status.service.js';

@Controller('admin/employees')
@EmployeeAccess('employee.status.manage')
@ApiTags('Employees')
@ApiBearerAuth('bearerAuth')
@ApiBadRequestResponse({ headers: requestIdHeader, schema: authErrorSchema(['VALIDATION_FAILED']) })
@ApiConflictResponse({ headers: requestIdHeader, schema: authErrorSchema(['VERSION_CONFLICT', 'LAST_ADMIN_REQUIRED', 'TASK_LOCK_PLAN_CHANGED', 'BUSINESS_MODULE_NOT_READY', 'TASK_VERSION_EXHAUSTED']) })
@ApiNotFoundResponse({ headers: requestIdHeader, schema: authErrorSchema(['EMPLOYEE_NOT_FOUND']) })
@ApiForbiddenResponse({ headers: requestIdHeader, schema: authErrorSchema(['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED']) })
@ApiUnauthorizedResponse({ headers: requestIdHeader, schema: authErrorSchema([
  'TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_SUBJECT_MISMATCH', 'SESSION_REVOKED', 'ACCOUNT_UNAVAILABLE',
]) })
export class EmployeeStatusController {
  constructor(@Inject(EmployeeStatusService) private readonly employees: EmployeeStatusService) {}

  @Post(':id/disable')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'disableEmployee', summary: '停用员工',
    description: '稳定锁→员工ID升序锁，锁内重验操作者及版本；禁止停用最后一名ACTIVE超级管理员。状态变为DISABLED，version/tokenVersion递增、全部会话撤销、审计和资格变更入口同事务；同状态匹配版本changed=false，旧版本仍409。 员工写入前合并全部失资格任务的完整业务锁；任务回池、领域经办同步、历史及审计与员工变更同事务，失败整体回滚。锁集合变化整笔最多重试3次。' })
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiBody({ schema: employeeStatusBodySchema })
  @ApiOkResponse({ headers: requestIdHeader, schema: employeeStatusSuccessSchema })
  disable(@Param() params: EmployeeIdParamsDto, @Body() input: EmployeeStatusDto,
    @CurrentActor() actor: CurrentIdentity, @Req() request: AuthHttpRequest) {
    return this.employees.change(actor, readBearerToken(request), params.id, 'DISABLED', input, request.requestId);
  }

  @Post(':id/enable')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'enableEmployee', summary: '启用员工',
    description: '沿用稳定锁、员工ID升序锁、最新身份和版本校验。启用仅改状态/version并同事务审计及资格变更，不恢复旧会话或清除强制改密；需重新登录。同状态匹配版本changed=false，旧版本仍409。' })
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiBody({ schema: employeeStatusBodySchema })
  @ApiOkResponse({ headers: requestIdHeader, schema: employeeStatusSuccessSchema })
  enable(@Param() params: EmployeeIdParamsDto, @Body() input: EmployeeStatusDto,
    @CurrentActor() actor: CurrentIdentity, @Req() request: AuthHttpRequest) {
    return this.employees.change(actor, readBearerToken(request), params.id, 'ACTIVE', input, request.requestId);
  }
}
