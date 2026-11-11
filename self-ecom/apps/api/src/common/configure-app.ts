import type { INestApplication } from '@nestjs/common';
import { ApiExceptionFilter } from './http/api-exception.filter.js';
import { ApiResponseInterceptor } from './http/api-response.interceptor.js';
import { requestContext } from './http/request-context.js';
import { APP_CONFIG, type EnvironmentConfig } from '../config/environment.js';
import { createValidationPipe } from './http/dto-validation.js';
import { configureSwagger } from './swagger.js';

/** 生产启动和 HTTP 测试共用此配置，避免配置不一致。 */
export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('api/v1');
  app.use(requestContext);
  const config = app.get<EnvironmentConfig>(APP_CONFIG);
  app.enableCors({
    origin: config.corsOrigins,
    exposedHeaders: ['X-Request-Id'],
  });
  app.useGlobalInterceptors(new ApiResponseInterceptor());
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new ApiExceptionFilter());
  configureSwagger(app);
}
