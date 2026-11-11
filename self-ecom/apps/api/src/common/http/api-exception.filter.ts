import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import type { RequestWithId } from './request-context.js';
import { DatabaseNotReadyException } from './database-not-ready.exception.js';
import { DtoValidationException } from './dto-validation.js';

const errors: Record<number, { code: string; message: string }> = {
  400: { code: 'VALIDATION_FAILED', message: '请求参数不合法' },
  401: { code: 'UNAUTHORIZED', message: '请登录后再操作' },
  403: { code: 'FORBIDDEN', message: '无权执行此操作' },
  404: { code: 'NOT_FOUND', message: '请求的资源不存在' },
  409: { code: 'STATE_CONFLICT', message: '当前状态不允许此操作' },
  413: { code: 'PAYLOAD_TOO_LARGE', message: '请求内容过大' },
  429: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后重试' },
  503: { code: 'SERVICE_NOT_READY', message: '服务暂未就绪' },
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<ServerResponse>();
    if (response.headersSent) {
      response.end();
      return;
    }

    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const error = errors[status] ?? { code: 'INTERNAL_ERROR', message: '系统暂时异常，请稍后重试' };
    response.statusCode = status;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({ ...error,
      ...(exception instanceof DatabaseNotReadyException ? { details: { database: 'unavailable' } } : {}),
      ...(exception instanceof DtoValidationException ? { details: exception.details } : {}),
      requestId: request.requestId }));
  }
}
