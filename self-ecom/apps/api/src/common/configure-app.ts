// 作用：统一配置 API 前缀、请求编号、严格 DTO 校验、响应封装与异常过滤。
import type { INestApplication } from '@nestjs/common';
import { ApiExceptionFilter } from './http/api-exception.filter.js';
import { ApiResponseInterceptor } from './http/api-response.interceptor.js';
import { requestContext } from './http/request-context.js';
import { APP_CONFIG, type EnvironmentConfig } from '../config/environment.js';
import { createValidationPipe } from './http/dto-validation.js';
import { configureSwagger } from './swagger.js';

/** 生产启动和 HTTP 测试共用此配置，避免配置不一致。 */
export function configureApp(app: INestApplication) {
  // 本机/首期单实例只信任实际连接来源，不接受客户端伪造的代理IP链。
  const server = app.getHttpAdapter().getInstance() as { set: (name: string, value: boolean) => void };
  server.set('trust proxy', false);
  app.setGlobalPrefix('api/v1');
  app.use(requestContext);
  const config = app.get<EnvironmentConfig>(APP_CONFIG);
  app.enableCors({
    origin: config.corsOrigins,
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
  });
  app.useGlobalInterceptors(new ApiResponseInterceptor());
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new ApiExceptionFilter());
  configureSwagger(app);
}
