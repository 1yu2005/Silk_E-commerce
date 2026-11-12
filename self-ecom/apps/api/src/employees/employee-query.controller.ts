// 作用：提供查询员工列表、详情及权限的 HTTP 接口并声明访问权限与 Swagger 契约。
import { Controller, Get, Header, Inject, Param, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { EmployeeAccess } from '../auth/auth.decorators.js';
import { authErrorSchema } from '../auth/employee-auth.openapi.js';
import { requestIdHeader } from '../health/health.openapi.js';
import { EmployeeIdParamsDto, EmployeeListQueryDto } from './employee-query.dto.js';
import { employeeDetailSuccessSchema, employeeListSuccessSchema, employeeRoles, employeeStatuses } from './employee-query.openapi.js';
import { EmployeeQueryService } from './employee-query.service.js';

@Controller('admin/employees')
@EmployeeAccess('employee.read')
@ApiTags('Employees')
@ApiBearerAuth('bearerAuth')
@ApiUnauthorizedResponse({ headers: requestIdHeader, schema: authErrorSchema([
  'TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_SUBJECT_MISMATCH', 'SESSION_REVOKED', 'ACCOUNT_UNAVAILABLE',
]) })
@ApiForbiddenResponse({ headers: requestIdHeader, schema: authErrorSchema(['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED']) })
@ApiBadRequestResponse({ headers: requestIdHeader, schema: authErrorSchema(['VALIDATION_FAILED']) })
export class EmployeeQueryController {
  constructor(@Inject(EmployeeQueryService) private readonly employees: EmployeeQueryService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'listEmployees', summary: '查询员工列表',
    description: '仅employee.read可用，先校验权限再校验参数。关键词去首尾空白，账号/显示名忽略大小写按文字包含匹配；%与_不作为通配符。createdAt倒序、id倒序稳定排序；不查询逐人权限。总数和本页数据使用同一读取快照。' })
  @ApiQuery({ name: 'page', required: false, schema: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER, default: 1 } })
  @ApiQuery({ name: 'pageSize', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } })
  @ApiQuery({ name: 'keyword', required: false, schema: { type: 'string', maxLength: 50 } })
  @ApiQuery({ name: 'role', required: false, enum: employeeRoles })
  @ApiQuery({ name: 'status', required: false, enum: employeeStatuses })
  @ApiOkResponse({ headers: requestIdHeader, schema: employeeListSuccessSchema })
  list(@Query() query: EmployeeListQueryDto) { return this.employees.list(query); }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'getEmployeeDetail', summary: '查询员工详情与权限',
    description: '仅employee.read可用。无权请求在目标查询及UUID校验前403；有权请求的不存在目标404。返回公开资料、记录/权限版本和三组权限，可查看停用员工；不返回密码、哈希、token或会话。' })
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({ headers: requestIdHeader, schema: employeeDetailSuccessSchema })
  @ApiNotFoundResponse({ headers: requestIdHeader, schema: authErrorSchema(['EMPLOYEE_NOT_FOUND']) })
  detail(@Param() params: EmployeeIdParamsDto) { return this.employees.detail(params.id); }
}
