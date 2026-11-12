// 作用：严格读取 Bearer 凭证，并在请求生命周期内保存已验证的当前身份。
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { RequestWithId } from '../common/http/request-context.js';
import type { CurrentIdentity } from './current-identity.service.js';
import { TokenValidationError } from './jwt-token.service.js';

export interface AuthHttpRequest extends RequestWithId { route?: { path?: unknown } }
// 身份只绑定当前请求，不放在可枚举的请求属性上，不存token原文或跨请求缓存。
const identities = new WeakMap<object, CurrentIdentity>();
export function setRequestIdentity(request: object, identity: CurrentIdentity): void { identities.set(request, identity); }
export function getRequestIdentity(request: object): CurrentIdentity {
  const identity = identities.get(request);
  if (!identity) throw new TokenValidationError('TOKEN_INVALID');
  return identity;
}
export const CurrentActor = createParamDecorator((_data: unknown, context: ExecutionContext): CurrentIdentity =>
  getRequestIdentity(context.switchToHttp().getRequest<AuthHttpRequest>()));

/** 只接受单个Authorization头，避免Node默认丢弃重复头时认证结果取决于转发行为。 */
export function readBearerToken(request: AuthHttpRequest): string {
  let count = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === 'authorization') count++;
  }
  const value = request.headers.authorization;
  const match = typeof value === 'string' && count === 1 ? /^Bearer ([^\s,]+)$/i.exec(value) : null;
  if (!match) throw new TokenValidationError('TOKEN_INVALID');
  return match[1]!;
}
