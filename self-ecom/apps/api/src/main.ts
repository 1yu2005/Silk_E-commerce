// 作用：启动 Nest 应用，加载统一配置、日志与 HTTP 约定并监听 API 端口。
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApp } from './common/configure-app.js';
import { APP_CONFIG, type EnvironmentConfig } from './config/environment.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  const config = app.get<EnvironmentConfig>(APP_CONFIG);
  app.enableShutdownHooks();
  // Nest 完成 Prisma 生命周期初始化后，才开始监听端口。
  await app.listen(config.port, '0.0.0.0');
}

void bootstrap();
