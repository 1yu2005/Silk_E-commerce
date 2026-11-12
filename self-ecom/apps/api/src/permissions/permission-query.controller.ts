// 作用：向有员工查询权限的管理员提供只读固定权限目录和岗位模板。
import { Controller, Get, Header, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { EmployeeAccess } from '../auth/auth.decorators.js';
import { authErrorSchema } from '../auth/employee-auth.openapi.js';
import { requestIdHeader } from '../health/health.openapi.js';
import { permissionCatalogSuccessSchema } from './permission-query.openapi.js';
import { PermissionService } from './permission.service.js';

@Controller('admin/permissions')
@EmployeeAccess('employee.read')
@ApiTags('Permissions')
@ApiBearerAuth('bearerAuth')
export class PermissionQueryController {
  constructor(@Inject(PermissionService) private readonly permissions: PermissionService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'getPermissionCatalog', summary: '查询固定权限目录与岗位模板',
    description: '仅employee.read可用，强制改密员工禁止访问。无业务输入，不支持过滤或修改；查询参数不会改变目录。返回代码配置中的权限、管理员专属标识、直接依赖及三岗位模板，各码数组稳定排序。目录读取不额外查库，不自动seed或授权；认证仍校验当前数据库身份。' })
  @ApiOkResponse({ headers: requestIdHeader, schema: permissionCatalogSuccessSchema })
  @ApiUnauthorizedResponse({ headers: requestIdHeader, schema: authErrorSchema([
    'TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_SUBJECT_MISMATCH', 'SESSION_REVOKED', 'ACCOUNT_UNAVAILABLE',
  ]) })
  @ApiForbiddenResponse({ headers: requestIdHeader, schema: authErrorSchema(['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED']) })
  catalog() { return this.permissions.catalog(); }
}
