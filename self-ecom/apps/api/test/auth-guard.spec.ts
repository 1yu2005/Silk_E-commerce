// 作用：验证认证策略、Bearer 解析、请求身份和强制改密白名单边界。
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Controller, Get, Param, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { ConfigModule } from '../src/config/config.module.js';
import { configureApp } from '../src/common/configure-app.js';
import { APP_CONFIG, validateEnvironment } from '../src/config/environment.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AuthGuardModule } from '../src/auth/auth-guard.module.js';
import { CurrentIdentityService, type CurrentIdentity } from '../src/auth/current-identity.service.js';
import { JwtTokenService, TokenValidationError } from '../src/auth/jwt-token.service.js';
import { SessionAuthenticationError } from '../src/auth/session-support.js';
import { AccessDeniedError } from '../src/auth/access-denied.error.js';
import { PasswordInputError } from '../src/auth/password.service.js';
import { PermissionInputError } from '../src/permissions/permission.service.js';
import { EmployeeAccess } from '../src/auth/auth.decorators.js';
import type { PermissionCode } from '../src/permissions/permission-catalog.js';
import { authGuardTestControllers, guardCalls } from './fixtures/auth-guard.controllers.js';

const token = 'test.fixture.token';
const tokens = new JwtTokenService({ secret: 'guard-spec-only-key-'.repeat(3), ttlSeconds: 7200 });
const actor: CurrentIdentity = { subjectType: 'EMPLOYEE', subjectId: randomUUID(), sessionId: randomUUID(), tokenVersion: 0,
  username: 'guard_mock', displayName: 'Guard替身', status: 'ACTIVE',
  role: 'CUSTOMER_SERVICE', mustChangePassword: false, permissionVersion: 0, extraPermissions: [], effectivePermissions: ['customer.read'] };
const authenticate = vi.fn<CurrentIdentityService['authenticate']>();
let app: INestApplication; let baseUrl = '';

const errorFactories: Record<string, () => Error | object> = {
  TOKEN_INVALID: () => new TokenValidationError('TOKEN_INVALID'),
  TOKEN_EXPIRED: () => new TokenValidationError('TOKEN_EXPIRED'),
  TOKEN_SUBJECT_MISMATCH: () => new TokenValidationError('TOKEN_SUBJECT_MISMATCH'),
  SESSION_REVOKED: () => new SessionAuthenticationError('SESSION_REVOKED'),
  ACCOUNT_UNAVAILABLE: () => new SessionAuthenticationError('ACCOUNT_UNAVAILABLE'),
  INVALID_CREDENTIALS: () => new SessionAuthenticationError('INVALID_CREDENTIALS'),
  PASSWORD_CHANGE_REQUIRED: () => new AccessDeniedError('PASSWORD_CHANGE_REQUIRED'),
  FORBIDDEN: () => new AccessDeniedError('FORBIDDEN'),
  PERMISSION_NOT_GRANTABLE: () => new PermissionInputError('PERMISSION_NOT_GRANTABLE'),
  EXTRA_PERMISSION_NOT_APPLICABLE: () => new PermissionInputError('EXTRA_PERMISSION_NOT_APPLICABLE'),
  VALIDATION_FAILED: () => new PasswordInputError({ code: 'PASSWORD_TOO_SHORT', message: 'private-input-message' }),
  FAKE_CODE: () => ({ code: 'TOKEN_INVALID', message: 'private-database-url' }),
  UNKNOWN_CODE: () => new TokenValidationError('private-unrecognized-code' as 'TOKEN_INVALID'),
  DATABASE_FAILURE: () => new Error('private SQL postgres://password@host/db'),
};
@Controller('guard-errors')
class ErrorController {
  @Get(':kind')
  fail(@Param('kind') kind: string) {
    const error = errorFactories[kind]!();
    Object.assign(error, { message: 'private-input-message', cause: 'private-cause' }); throw error;
  }
}

beforeAll(async () => {
  const module = await Test.createTestingModule({ imports: [ConfigModule, AuthGuardModule],
    controllers: [...authGuardTestControllers, ErrorController] })
    .overrideProvider(APP_CONFIG).useValue(validateEnvironment({ NODE_ENV: 'test', LOG_LEVEL: 'silent',
      DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/shop_test', CORS_ORIGINS: 'http://localhost:5173,http://localhost:5174' }))
    .overrideProvider(PrismaService).useValue({ ping: vi.fn() })
    .overrideProvider(JwtTokenService).useValue(tokens)
    .overrideProvider(CurrentIdentityService).useValue({ authenticate }).compile();
  app = module.createNestApplication(); configureApp(app); await app.listen(0, '127.0.0.1'); baseUrl = await app.getUrl();
});
beforeEach(() => { authenticate.mockReset().mockResolvedValue({ ...actor }); guardCalls.protected = 0; });
afterAll(async () => { await app?.close(); });

it.each([undefined, 'Basic private-value', 'Bearer', 'Bearer one two', 'Bearer a,b', 'Bearer  two-spaces'])('错误Authorization格式%s在查库前拒绝且不执行处理器', async authorization => {
  const response = await fetch(`${baseUrl}/api/v1/admin/me`, { headers: authorization ? { Authorization: authorization } : {} });
  expect(response.status).toBe(401); expect((await response.json() as { code: string }).code).toBe('TOKEN_INVALID');
  expect(authenticate).not.toHaveBeenCalled(); expect(guardCalls.protected).toBe(0);
});

it('Bearer方案名忽略大小写，身份经参数装饰器传给处理器', async () => {
  const response = await fetch(`${baseUrl}/api/v1/admin/me`, { headers: { Authorization: `bearer ${token}` } });
  expect(response.status).toBe(200);
  expect((await response.json() as { data: unknown }).data).toEqual({ subjectId: actor.subjectId, subjectType: 'EMPLOYEE' });
  expect(authenticate).toHaveBeenCalledWith(expect.anything(), token, 'EMPLOYEE');
});

it('单独使用权限Guard仍拒绝没有认证上下文的请求', async () => {
  const response = await fetch(`${baseUrl}/api/v1/guard-public/permission-only`, { headers: { Authorization: `Bearer ${token}` } });
  expect(response.status).toBe(401); expect(guardCalls.protected).toBe(0);
});

it('声明未知权限时立即报配置错误且不回显输入', () => {
  expect(() => EmployeeAccess('private-unknown-permission' as PermissionCode)).toThrow('路由声明了未知权限');
});

it('认证中的数据库故障保持500且脱敏，不重试另一身份域或执行处理器', async () => {
  authenticate.mockRejectedValue(new Error('private SQL postgres://secret@host/db'));
  const response = await fetch(`${baseUrl}/api/v1/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  expect(response.status).toBe(500);
  const body = await response.json() as { code: string };
  expect(body.code).toBe('INTERNAL_ERROR'); expect(JSON.stringify(body)).not.toContain('private');
  expect(authenticate).toHaveBeenCalledTimes(1); expect(guardCalls.protected).toBe(0);
});

it.each(Object.keys(errorFactories))('内部错误%s经过公共过滤器固定映射，不能通过异常消息泄密', async code => {
  const response = await fetch(`${baseUrl}/api/v1/guard-errors/${code}`, { headers: { 'X-Request-Id': 'client-controlled' } });
  const expectedStatus = ['FAKE_CODE', 'UNKNOWN_CODE', 'DATABASE_FAILURE'].includes(code) ? 500
    : ['VALIDATION_FAILED', 'PERMISSION_NOT_GRANTABLE', 'EXTRA_PERMISSION_NOT_APPLICABLE'].includes(code) ? 400
    : ['PASSWORD_CHANGE_REQUIRED', 'FORBIDDEN'].includes(code) ? 403 : 401;
  expect(response.status).toBe(expectedStatus);
  const body = await response.json() as { code: string; message: string; requestId: string };
  expect(body.code).toBe(expectedStatus === 500 ? 'INTERNAL_ERROR' : code);
  expect(Object.keys(body).sort()).toEqual(['code', 'message', 'requestId']);
  expect(body.requestId).toBe(response.headers.get('x-request-id'));
  expect(body.requestId).not.toBe('client-controlled');
  expect(JSON.stringify(body)).not.toContain('private-');
});
