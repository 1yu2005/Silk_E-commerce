// 作用：提供调整员工岗位并清空额外权限的 HTTP 接口并声明访问权限与 Swagger 契约。
import { Body, Controller, Header, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiConflictResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { EmployeeAccess } from '../auth/auth.decorators.js';
import { CurrentActor, readBearerToken, type AuthHttpRequest } from '../auth/auth-request-context.js';
import type { CurrentIdentity } from '../auth/current-identity.service.js';
import { authErrorSchema } from '../auth/employee-auth.openapi.js';
import { requestIdHeader } from '../health/health.openapi.js';
import { EmployeeIdParamsDto } from './employee-query.dto.js';
import { EmployeeRoleDto } from './employee-role.dto.js';
import { employeeRoleBodySchema, employeeRoleSuccessSchema } from './employee-role.openapi.js';
import { EmployeeRoleService } from './employee-role.service.js';

@Controller('admin/employees')
@ApiTags('Employees')
export class EmployeeRoleController {
  constructor(@Inject(EmployeeRoleService) private readonly employees: EmployeeRoleService) {}

  @Post(':id/change-role')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @EmployeeAccess('employee.role.change')
  @ApiBearerAuth('bearerAuth')
  @ApiOperation({ operationId: 'changeEmployeeRole', summary: '员工调岗',
    description: '稳定锁→员工ID升序锁，锁内重验身份/权限及目标版本；禁止降级最后一名ACTIVE超级管理员。真实换岗清空额外授权、递增version/permissionVersion，与审计及资格变更同事务；保留会话，旧token下一请求按新岗位执行。同岗位且版本匹配changed=false并保留授权，旧版本仍409。响应丢失先刷新核实。 员工写入前合并全部失资格任务的完整业务锁；任务回池、领域经办同步、历史及审计与员工变更同事务，失败整体回滚。锁集合变化整笔最多重试3次。' })
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiBody({ schema: employeeRoleBodySchema })
  @ApiOkResponse({ headers: requestIdHeader, schema: employeeRoleSuccessSchema })
  @ApiBadRequestResponse({ headers: requestIdHeader, schema: authErrorSchema(['VALIDATION_FAILED']) })
  @ApiConflictResponse({ headers: requestIdHeader, schema: authErrorSchema(['VERSION_CONFLICT', 'LAST_ADMIN_REQUIRED', 'TASK_LOCK_PLAN_CHANGED', 'BUSINESS_MODULE_NOT_READY', 'TASK_VERSION_EXHAUSTED']) })
  @ApiNotFoundResponse({ headers: requestIdHeader, schema: authErrorSchema(['EMPLOYEE_NOT_FOUND']) })
  @ApiForbiddenResponse({ headers: requestIdHeader, schema: authErrorSchema(['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED']) })
  @ApiUnauthorizedResponse({ headers: requestIdHeader, schema: authErrorSchema([
    'TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_SUBJECT_MISMATCH', 'SESSION_REVOKED', 'ACCOUNT_UNAVAILABLE',
  ]) })
  change(@Param() params: EmployeeIdParamsDto, @Body() input: EmployeeRoleDto,
    @CurrentActor() actor: CurrentIdentity, @Req() request: AuthHttpRequest) {
    return this.employees.change(actor, readBearerToken(request), params.id, input, request.requestId);
  }
}
