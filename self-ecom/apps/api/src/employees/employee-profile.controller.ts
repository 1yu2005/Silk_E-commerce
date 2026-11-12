// 作用：提供修改员工显示名的 HTTP 接口并声明访问权限与 Swagger 契约。
import { Body, Controller, Header, Inject, Param, Patch, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiConflictResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { EmployeeAccess } from '../auth/auth.decorators.js';
import { CurrentActor, readBearerToken, type AuthHttpRequest } from '../auth/auth-request-context.js';
import type { CurrentIdentity } from '../auth/current-identity.service.js';
import { authErrorSchema } from '../auth/employee-auth.openapi.js';
import { requestIdHeader } from '../health/health.openapi.js';
import { EmployeeIdParamsDto } from './employee-query.dto.js';
import { EmployeeProfileDto } from './employee-profile.dto.js';
import { employeeProfileBodySchema, employeeProfileSuccessSchema } from './employee-profile.openapi.js';
import { EmployeeProfileService } from './employee-profile.service.js';

@Controller('admin/employees')
@ApiTags('Employees')
export class EmployeeProfileController {
  constructor(@Inject(EmployeeProfileService) private readonly employees: EmployeeProfileService) {}

  @Patch(':id/profile')
  @Header('Cache-Control', 'no-store')
  @EmployeeAccess('employee.profile.update')
  @ApiBearerAuth('bearerAuth')
  @ApiOperation({ operationId: 'updateEmployeeProfile', summary: '修改员工显示名',
    description: '仅接受显示名、当前version及原因；管理员可修改本人或他人，支持停用目标。按ID升序锁操作者与目标，锁内复核当前身份及权限后检查版本。仅修改显示名及version并同事务审计；同名且版本匹配200返回当前资料，不递增/重复审计，旧版本始终409。不会改岗位、状态、密码、权限或撤销会话。' })
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiBody({ schema: employeeProfileBodySchema })
  @ApiOkResponse({ headers: requestIdHeader, schema: employeeProfileSuccessSchema })
  @ApiBadRequestResponse({ headers: requestIdHeader, schema: authErrorSchema(['VALIDATION_FAILED']) })
  @ApiConflictResponse({ headers: requestIdHeader, schema: authErrorSchema(['VERSION_CONFLICT']) })
  @ApiNotFoundResponse({ headers: requestIdHeader, schema: authErrorSchema(['EMPLOYEE_NOT_FOUND']) })
  @ApiForbiddenResponse({ headers: requestIdHeader, schema: authErrorSchema(['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED']) })
  @ApiUnauthorizedResponse({ headers: requestIdHeader, schema: authErrorSchema([
    'TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_SUBJECT_MISMATCH', 'SESSION_REVOKED', 'ACCOUNT_UNAVAILABLE',
  ]) })
  update(@Param() params: EmployeeIdParamsDto, @Body() input: EmployeeProfileDto,
    @CurrentActor() actor: CurrentIdentity, @Req() request: AuthHttpRequest) {
    return this.employees.update(actor, readBearerToken(request), params.id, input, request.requestId);
  }
}
