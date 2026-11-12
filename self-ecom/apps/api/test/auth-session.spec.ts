// 作用：验证会话服务的输入约束、事务要求与会话辅助规则。
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthSessionModule } from '../src/auth/auth-session.module.js';
import { AuthSessionService } from '../src/auth/auth-session.service.js';
import { CurrentIdentityService } from '../src/auth/current-identity.service.js';
import { JwtTokenService } from '../src/auth/jwt-token.service.js';
import { PermissionService } from '../src/permissions/permission.service.js';

afterEach(() => { vi.unstubAllEnvs(); });

it('会话模块独立导出两个服务，不需连接数据库', async () => {
  vi.stubEnv('JWT_SECRET', 'session-module-test-key-'.repeat(3)); vi.stubEnv('JWT_TTL_SECONDS', '7200');
  const module = await Test.createTestingModule({ imports: [AuthSessionModule] }).compile();
  try {
    expect(module.get(AuthSessionService)).toBeInstanceOf(AuthSessionService);
    expect(module.get(CurrentIdentityService)).toBeInstanceOf(CurrentIdentityService);
  } finally { await module.close(); }
});

it('签名非法时先拒绝凭证，不读取数据库', async () => {
  const tokens = new JwtTokenService({ secret: 'identity-test-only-key-'.repeat(3), ttlSeconds: 7200 });
  const identities = new CurrentIdentityService(tokens, new PermissionService());
  const db = { $queryRaw: vi.fn(() => { throw new Error('非法token不应查数据库'); }) };
  await expect(identities.authenticate(db, 'a.b.c', 'EMPLOYEE')).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  expect(db.$queryRaw).not.toHaveBeenCalled();
});
