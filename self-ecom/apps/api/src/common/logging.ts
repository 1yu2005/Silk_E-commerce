// 作用：配置 HTTP 日志白名单和敏感字段脱敏，避免记录密码、令牌及请求正文。
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Options } from 'pino-http';
import type { EnvironmentConfig } from '../config/environment.js';
import { ensureRequestId } from './http/request-context.js';

/** 仅记录白名单中的 HTTP 字段，不序列化请求头、请求体或查询参数值。 */
export function httpLogOptions(config: Pick<EnvironmentConfig, 'logLevel'>): Options {
  return {
    level: config.logLevel,
    genReqId: ensureRequestId,
    wrapSerializers: false,
    serializers: {
      req: (request: IncomingMessage) => ({
        method: request.method,
        path: (request.url ?? '/').split(/[?#]/, 1)[0],
      }),
      res: (response: ServerResponse) => ({ statusCode: response.statusCode }),
      // 错误信息和堆栈中可能包含 SQL、令牌或连接字符串。
      err: () => ({ type: 'RequestError' }),
    },
    customProps: (request, response) => ({ requestId: ensureRequestId(request, response) }),
    customLogLevel: (_request, response, error) =>
      error || response.statusCode >= 500 ? 'error' : response.statusCode >= 400 ? 'warn' : 'info',
    customSuccessMessage: () => 'request completed',
    customErrorMessage: () => 'request failed',
    redact: {
      paths: ['password', 'passwordHash', 'token', 'authorization', 'cookie',
        'databaseUrl', 'DATABASE_URL', 'address', 'req.headers', 'req.body',
        'res.headers', '*.password', '*.token', '*.authorization', '*.cookie'],
      censor: '[REDACTED]',
    },
  };
}
