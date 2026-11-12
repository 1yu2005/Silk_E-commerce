// 作用：组装工程基础模块及板块2的认证、员工管理、权限目录和审计依赖。
import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module.js';
import { ConfigModule } from './config/config.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { LoggerModule } from 'nestjs-pino';
import { APP_CONFIG, type EnvironmentConfig } from './config/environment.js';
import { httpLogOptions } from './common/logging.js';
import { PermissionModule } from './permissions/permission.module.js';
import { EmployeeAuthModule } from './auth/employee-auth.module.js';
import { LogoutModule } from './auth/logout.module.js';
import { EmployeeQueryModule } from './employees/employee-query.module.js';
import { PermissionQueryModule } from './permissions/permission-query.module.js';
import { EmployeeCreateModule } from './employees/employee-create.module.js';
import { EmployeeProfileModule } from './employees/employee-profile.module.js';
import { EmployeeStatusModule } from './employees/employee-status.module.js';
import { EmployeePasswordResetModule } from './employees/employee-password-reset.module.js';
import { EmployeeRoleModule } from './employees/employee-role.module.js';
import { EmployeeExtraPermissionModule } from './employees/employee-extra-permission.module.js';
import { CustomerRegisterModule } from './auth/customer-register.module.js';
import { CustomerAuthModule } from './auth/customer-auth.module.js';

@Module({ imports: [ConfigModule, LoggerModule.forRootAsync({
  imports: [ConfigModule],
  inject: [APP_CONFIG],
  useFactory: (config: EnvironmentConfig) => ({ pinoHttp: httpLogOptions(config) }),
}), PrismaModule, PermissionModule, HealthModule, EmployeeAuthModule, LogoutModule, EmployeeQueryModule, PermissionQueryModule, EmployeeCreateModule, EmployeeProfileModule, EmployeeStatusModule, EmployeePasswordResetModule, EmployeeRoleModule, EmployeeExtraPermissionModule, CustomerRegisterModule, CustomerAuthModule] })
export class AppModule {}
