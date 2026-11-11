import { Module } from '@nestjs/common';
import { APP_CONFIG, type EnvironmentConfig } from '../config/environment.js';
import { PrismaService } from './prisma.service.js';

@Module({
  providers: [{ provide: PrismaService, inject: [APP_CONFIG],
    useFactory: (config: EnvironmentConfig) => new PrismaService(config) }],
  exports: [PrismaService],
})
export class PrismaModule {}
