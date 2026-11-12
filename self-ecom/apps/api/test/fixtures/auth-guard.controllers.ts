// 作用：为守卫测试提供隔离的受保护接口夹具，不注册为生产业务路由。
import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AnyAccountAccess, CustomerAccess, EmployeeAccess } from '../../src/auth/auth.decorators.js';
import { CurrentActor } from '../../src/auth/auth-request-context.js';
import type { CurrentIdentity } from '../../src/auth/current-identity.service.js';
import { PermissionGuard } from '../../src/auth/permission.guard.js';

// 仅作为HTTP验收夹具，绝不注册到生产AppModule；改密/注销只返回通行标志，不执行业务变更。
export const guardCalls = { protected: 0 };
function reached(identity: CurrentIdentity) { guardCalls.protected++; return { subjectId: identity.subjectId, subjectType: identity.subjectType }; }

@Controller('admin')
@EmployeeAccess()
class AdminGuardController {
  @Get(['me', 'alias-me'])
  me(@CurrentActor() identity: CurrentIdentity) { return reached(identity); }

  @Post('me')
  @HttpCode(200)
  wrongMeMethod(@CurrentActor() identity: CurrentIdentity) { return reached(identity); }

  @Post('auth/change-password')
  @HttpCode(200)
  changePassword(@CurrentActor() identity: CurrentIdentity) { return reached(identity); }

  @Get('auth/change-password')
  wrongPasswordMethod(@CurrentActor() identity: CurrentIdentity) { return reached(identity); }

  @Get('permissions')
  permissions(@CurrentActor() identity: CurrentIdentity) { return reached(identity); }

  @Get('employees')
  @EmployeeAccess('employee.read')
  employees(@CurrentActor() identity: CurrentIdentity) { return reached(identity); }

  @Get('fulfillment')
  @EmployeeAccess('order.fulfillment.read')
  fulfillment(@CurrentActor() identity: CurrentIdentity) { return reached(identity); }

  @Get('service')
  @EmployeeAccess('customer.read')
  service(@CurrentActor() identity: CurrentIdentity) { return reached(identity); }

  @Get('two-permissions')
  @EmployeeAccess('customer.read', 'order.fulfillment.read')
  twoPermissions(@CurrentActor() identity: CurrentIdentity) { return reached(identity); }

  @Get('conflicting-domain')
  @CustomerAccess()
  conflictingDomain(@CurrentActor() identity: CurrentIdentity) { return reached(identity); }
}

@Controller('store')
@CustomerAccess()
class StoreGuardController {
  @Get('me')
  me(@CurrentActor() identity: CurrentIdentity) { return reached(identity); }
}

@Controller('auth')
@AnyAccountAccess()
class SharedGuardController {
  @Post('logout')
  @HttpCode(200)
  logout(@CurrentActor() identity: CurrentIdentity) { return reached(identity); }

  @Get('logout')
  wrongLogoutMethod(@CurrentActor() identity: CurrentIdentity) { return reached(identity); }
}

@Controller('guard-inherited')
@EmployeeAccess('customer.read')
class InheritedGuardController {
  @Get('merged')
  @EmployeeAccess('order.fulfillment.read')
  merged(@CurrentActor() identity: CurrentIdentity) { return reached(identity); }

  @Get('empty-method')
  @EmployeeAccess()
  emptyMethod(@CurrentActor() identity: CurrentIdentity) { return reached(identity); }
}

@Controller('guard-public')
class PublicGuardController {
  @Get()
  publicRoute() { return { public: true }; }

  @Get('permission-only')
  @UseGuards(PermissionGuard)
  permissionOnly() { guardCalls.protected++; return { unreachable: true }; }
}

export const authGuardTestControllers = [AdminGuardController, StoreGuardController, SharedGuardController,
  InheritedGuardController, PublicGuardController];
