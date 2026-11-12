// 作用：为正常 JSON 响应统一封装 data 和 requestId，保留文件等特殊响应行为。
import {
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { map } from 'rxjs';
import type { RequestWithId } from './request-context.js';

export class ApiResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<RequestWithId>();
    return next.handle().pipe(map((data: unknown) => {
      // 二进制响应保持为流，不转换成 JSON 对象。
      if (data instanceof StreamableFile) return data;
      return { data: data === undefined ? null : data, requestId: request.requestId };
    }));
  }
}
