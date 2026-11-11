import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { APP_CONFIG, type EnvironmentConfig } from '../config/environment.js';
import type { ServerResponse } from 'node:http';
import type { RequestWithId } from './http/request-context.js';

export function createOpenApiDocument(app: INestApplication) {
  return SwaggerModule.createDocument(app, new DocumentBuilder()
    .setTitle('自营电商 API')
    .setDescription('M0 工程基础接口。成功响应为 {data, requestId}，错误响应为 {code, message, details?, requestId}。')
    .setVersion('1.0.0')
    .addServer('/')
    .build(), { operationIdFactory: (_controller, method) => method });
}

export function configureSwagger(app: INestApplication) {
  if (!app.get<EnvironmentConfig>(APP_CONFIG).swaggerEnabled) {
    // 这些路径不受全局 API 前缀约束，关闭时也保持统一响应，
    // 避免落入 Express 默认的 HTML 404 页面。
    app.use(['/api/docs', '/api/docs-json'], (request: RequestWithId, response: ServerResponse) => {
      response.statusCode = 404;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ code: 'NOT_FOUND', message: '请求的资源不存在', requestId: request.requestId }));
    });
    return;
  }
  SwaggerModule.setup('api/docs', app, createOpenApiDocument(app), {
    useGlobalPrefix: false,
    jsonDocumentUrl: 'api/docs-json',
    raw: ['json'],
    swaggerOptions: { persistAuthorization: false },
  });
}
