// 作用：提供重置其他员工密码的 HTTP 接口并声明访问权限与 Swagger 契约。
import { Body, Controller, Header, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiConflictResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { EmployeeAccess } from '../auth/auth.decorators.js';
import { CurrentActor, readBearerToken, type AuthHttpRequest } from '../auth/auth-request-context.js';
import type { CurrentIdentity } from '../auth/current-identity.service.js';
import { authErrorSchema } from '../auth/employee-auth.openapi.js';
import { requestIdHeader } from '../health/health.openapi.js';
import { EmployeePasswordResetDto } from './employee-password-reset.dto.js';
import { employeePasswordResetBodySchema, employeePasswordResetSuccessSchema } from './employee-password-reset.openapi.js';
import { EmployeePasswordResetService } from './employee-password-reset.service.js';
import { EmployeeIdParamsDto } from './employee-query.dto.js';

@Controller('admin/employees')
@ApiTags('Employees')
export class EmployeePasswordResetController {
  constructor(@Inject(EmployeePasswordResetService) private readonly employees: EmployeePasswordResetService) {}

  @Post(':id/reset-password')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @EmployeeAccess('employee.password.reset')
  @ApiBearerAuth('bearerAuth')
  @ApiOperation({ operationId: 'resetEmployeePassword', summary: '管理员重置其他员工密码',
    description: '操作者和目标按ID升序锁定，锁内重验身份/权限及目标版本；不能重置本人。新哈希、强制改密、version/tokenVersion递增、撤销全部会话与审计同事务，不回显密码。目标启停、岗位和授权保留，临时密码登录后须改密再重新登录。旧版本409，响应丢失先刷新核实，不自动重提。' })
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiBody({ schema: employeePasswordResetBodySchema })
  @ApiOkResponse({ headers: requestIdHeader, schema: employeePasswordResetSuccessSchema })
  @ApiBadRequestResponse({ headers: requestIdHeader, schema: authErrorSchema(['VALIDATION_FAILED', 'SELF_PASSWORD_RESET_NOT_ALLOWED']) })
  @ApiConflictResponse({ headers: requestIdHeader, schema: authErrorSchema(['VERSION_CONFLICT']) })
  @ApiNotFoundResponse({ headers: requestIdHeader, schema: authErrorSchema(['EMPLOYEE_NOT_FOUND']) })
  @ApiForbiddenResponse({ headers: requestIdHeader, schema: authErrorSchema(['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED']) })
  @ApiUnauthorizedResponse({ headers: requestIdHeader, schema: authErrorSchema([
    'TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_SUBJECT_MISMATCH', 'SESSION_REVOKED', 'ACCOUNT_UNAVAILABLE',
  ]) })
  reset(@Param() params: EmployeeIdParamsDto, @Body() input: EmployeePasswordResetDto,
    @CurrentActor() actor: CurrentIdentity, @Req() request: AuthHttpRequest) {
    return this.employees.reset(actor, readBearerToken(request), params.id, input, request.requestId);
  }
}
