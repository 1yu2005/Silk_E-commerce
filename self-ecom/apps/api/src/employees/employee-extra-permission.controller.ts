// 作用：提供替换员工个人额外权限的 HTTP 接口并声明访问权限与 Swagger 契约。
import { Body, Controller, Header, HttpCode, Inject, Param, Put, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiConflictResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { EmployeeAccess } from '../auth/auth.decorators.js';
import { CurrentActor, readBearerToken, type AuthHttpRequest } from '../auth/auth-request-context.js';
import type { CurrentIdentity } from '../auth/current-identity.service.js';
import { authErrorSchema } from '../auth/employee-auth.openapi.js';
import { requestIdHeader } from '../health/health.openapi.js';
import { EmployeeExtraPermissionDto } from './employee-extra-permission.dto.js';
import { employeeExtraPermissionBodySchema, employeeExtraPermissionSuccessSchema } from './employee-extra-permission.openapi.js';
import { EmployeeExtraPermissionService } from './employee-extra-permission.service.js';
import { EmployeeIdParamsDto } from './employee-query.dto.js';

@Controller('admin/employees')
@ApiTags('Employees')
export class EmployeeExtraPermissionController {
  constructor(@Inject(EmployeeExtraPermissionService) private readonly employees: EmployeeExtraPermissionService) {}

  @Put(':id/extra-permissions')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @EmployeeAccess('employee.permission.manage')
  @ApiBearerAuth('bearerAuth')
  @ApiOperation({ operationId: 'replaceEmployeeExtraPermissions', summary: '替换员工个人额外权限',
    description: '按员工ID升序锁定并重验当前身份/权限及目标版本，超级管理员目标不适用（包括空集合）。服务端解析依赖，实际变化递增version/permissionVersion，授权差集、审计、资格入口同事务；保留会话，旧token下一请求读取新权限。同集合匹配版本changed=false，旧版本409。响应丢失先刷新详情核实，前端须保留完整解析集合再编辑。' })
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiBody({ schema: employeeExtraPermissionBodySchema })
  @ApiOkResponse({ headers: requestIdHeader, schema: employeeExtraPermissionSuccessSchema })
  @ApiBadRequestResponse({ headers: requestIdHeader, schema: authErrorSchema(['VALIDATION_FAILED', 'PERMISSION_NOT_GRANTABLE', 'EXTRA_PERMISSION_NOT_APPLICABLE']) })
  @ApiConflictResponse({ headers: requestIdHeader, schema: authErrorSchema(['VERSION_CONFLICT']) })
  @ApiNotFoundResponse({ headers: requestIdHeader, schema: authErrorSchema(['EMPLOYEE_NOT_FOUND']) })
  @ApiForbiddenResponse({ headers: requestIdHeader, schema: authErrorSchema(['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED']) })
  @ApiUnauthorizedResponse({ headers: requestIdHeader, schema: authErrorSchema([
    'TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_SUBJECT_MISMATCH', 'SESSION_REVOKED', 'ACCOUNT_UNAVAILABLE',
  ]) })
  replace(@Param() params: EmployeeIdParamsDto, @Body() input: EmployeeExtraPermissionDto,
    @CurrentActor() actor: CurrentIdentity, @Req() request: AuthHttpRequest) {
    return this.employees.replace(actor, readBearerToken(request), params.id, input, request.requestId);
  }
}
