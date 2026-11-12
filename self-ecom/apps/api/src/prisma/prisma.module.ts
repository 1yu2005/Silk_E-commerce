// 作用：统一导出 Prisma 数据访问服务，供认证、员工管理及健康检查复用。
import { Module } from '@nestjs/common';
import { APP_CONFIG, type EnvironmentConfig } from '../config/environment.js';
import { PrismaService } from './prisma.service.js';

@Module({
  providers: [{ provide: PrismaService, inject: [APP_CONFIG],
    useFactory: (config: EnvironmentConfig) => new PrismaService(config) }],
  exports: [PrismaService],
})
export class PrismaModule {}
