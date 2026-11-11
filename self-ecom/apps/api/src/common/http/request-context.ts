import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface RequestWithId extends IncomingMessage {
  requestId: string;
}

const requestIds = new WeakMap<IncomingMessage, string>();

export function ensureRequestId(request: IncomingMessage, response: ServerResponse): string {
  let id = requestIds.get(request);
  if (!id) {
    id = randomUUID();
    requestIds.set(request, id);
  }
  (request as RequestWithId).requestId = id;
  if (!response.headersSent) response.setHeader('X-Request-Id', id);
  return id;
}

/** 服务端生成的请求编号也覆盖未进入控制器的请求，例如 404。 */
export function requestContext(
  request: RequestWithId,
  response: ServerResponse,
  next: () => void,
) {
  ensureRequestId(request, response);
  next();
}
