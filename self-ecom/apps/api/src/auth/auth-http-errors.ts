// 作用：将认证、会话、限流及授权异常转换为固定 HTTP 状态和脱敏错误码。
import { PermissionInputError } from '../permissions/permission.service.js';
import { AccessDeniedError } from './access-denied.error.js';
import { TokenValidationError } from './jwt-token.service.js';
import { PasswordInputError } from './password.service.js';
import { SessionAuthenticationError } from './session-support.js';
import { AuthRateLimitedError } from './login-rate-limiter.js';
import { CustomerPhoneExistsError } from './customer-register.error.js';

const tokenMessages = { TOKEN_INVALID: '登录凭证无效', TOKEN_EXPIRED: '登录凭证已过期', TOKEN_SUBJECT_MISMATCH: '登录凭证所属登录域不匹配' };
const sessionMessages = { SESSION_REVOKED: '登录会话已撤销', ACCOUNT_UNAVAILABLE: '账号当前不可用', INVALID_CREDENTIALS: '账号或密码错误' };
const deniedMessages = { PASSWORD_CHANGE_REQUIRED: '请先修改初始密码', FORBIDDEN: '无权执行此操作' };
const permissionMessages = { PERMISSION_NOT_GRANTABLE: '额外权限包含未知或不可下放的权限', EXTRA_PERMISSION_NOT_APPLICABLE: '超级管理员不使用个人额外权限' };

/** 只识别内部错误类并使用固定文案；不信任任意异常的code/message/cause。 */
export function authHttpError(error: unknown): { status: number; code: string; message: string; retryAfterSeconds?: number } | undefined {
  if (error instanceof CustomerPhoneExistsError) return { status: 409, code: 'PHONE_EXISTS', message: '手机号已注册' };
  if (error instanceof AuthRateLimitedError && Number.isSafeInteger(error.retryAfterSeconds) && error.retryAfterSeconds >= 1) {
    return { status: 429, code: 'AUTH_RATE_LIMITED', message: '认证尝试过于频繁，请稍后重试', retryAfterSeconds: error.retryAfterSeconds };
  }
  if (error instanceof TokenValidationError && Object.hasOwn(tokenMessages, error.code)) {
    return { status: 401, code: error.code, message: tokenMessages[error.code] };
  }
  if (error instanceof SessionAuthenticationError && Object.hasOwn(sessionMessages, error.code)) {
    return { status: 401, code: error.code, message: sessionMessages[error.code] };
  }
  if (error instanceof AccessDeniedError && Object.hasOwn(deniedMessages, error.code)) {
    return { status: 403, code: error.code, message: deniedMessages[error.code] };
  }
  if (error instanceof PermissionInputError && Object.hasOwn(permissionMessages, error.code)) {
    return { status: 400, code: error.code, message: permissionMessages[error.code] };
  }
  if (error instanceof PasswordInputError) return { status: 400, code: 'VALIDATION_FAILED', message: '请求参数不合法' };
  return undefined;
}
