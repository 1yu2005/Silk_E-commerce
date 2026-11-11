import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module.js';
import { ConfigModule } from './config/config.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { LoggerModule } from 'nestjs-pino';
import { APP_CONFIG, type EnvironmentConfig } from './config/environment.js';
import { httpLogOptions } from './common/logging.js';

@Module({ imports: [ConfigModule, LoggerModule.forRootAsync({
  imports: [ConfigModule],
  inject: [APP_CONFIG],
  useFactory: (config: EnvironmentConfig) => ({ pinoHttp: httpLogOptions(config) }),
}), PrismaModule, HealthModule] })
export class AppModule {}
