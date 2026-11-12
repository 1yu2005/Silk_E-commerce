// 作用：验证最小 JWT 声明、签名算法、期限及严格登录域校验。
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { decodeJwt, SignJWT } from 'jose';
import { afterEach, expect, it, vi } from 'vitest';
import { JwtTokenService, TokenValidationError } from '../src/auth/jwt-token.service.js';
import { JwtTokenModule } from '../src/auth/jwt-token.module.js';

const secret = 'test-only-jwt-key-'.repeat(4);
const key = new TextEncoder().encode(secret);
const now = new Date('2026-11-11T10:00:00.999Z');
const seconds = Math.floor(now.getTime() / 1000);
const config = { secret, ttlSeconds: 7200 };
const identity = { subjectId: randomUUID(), sessionId: randomUUID(), subjectType: 'EMPLOYEE' as const, tokenVersion: 2 };
const service = () => new JwtTokenService(config, () => now);
const claims = () => ({ sub: identity.subjectId, sid: identity.sessionId, subjectType: 'EMPLOYEE', tokenVersion: 2,
  iat: seconds, exp: seconds + 7200, iss: 'shop-api', aud: 'shop-admin' });
const sign = (payload: Record<string, unknown>, header = { alg: 'HS256', typ: 'JWT' }) =>
  new SignJWT(payload).setProtectedHeader(header).sign(key);
afterEach(() => { vi.unstubAllEnvs(); });

it('签发只含规定8个字段，JWT与返回的会话时间精确到同一整秒', async () => {
  const issued = await service().issue({ ...identity, phone: '13800138001', permissions: ['employee.create'], password: 'private' } as typeof identity);
  const payload = decodeJwt(issued.accessToken);
  expect(Object.keys(payload).sort()).toEqual(['sub', 'sid', 'subjectType', 'tokenVersion', 'iat', 'exp', 'iss', 'aud'].sort());
  expect(payload).toEqual(claims());
  expect(issued.issuedAt.getTime()).toBe(seconds * 1000);
  expect(issued.expiresAt.getTime()).toBe(payload.exp! * 1000);
  expect(issued.expiresAt.getTime() - issued.issuedAt.getTime()).toBe(7200_000);
  expect(await service().verify(issued.accessToken, 'EMPLOYEE')).toEqual(claims());
});

it('两个登录域分别签发并互相拒绝，合法跨域返回专用错误', async () => {
  const employee = await service().issue(identity);
  const customer = await service().issue({ ...identity, subjectType: 'CUSTOMER' });
  expect((await service().verify(customer.accessToken, 'CUSTOMER')).aud).toBe('shop-store');
  await expect(service().verify(employee.accessToken, 'CUSTOMER')).rejects.toMatchObject({ code: 'TOKEN_SUBJECT_MISMATCH' });
  await expect(service().verify(customer.accessToken, 'EMPLOYEE')).rejects.toMatchObject({ code: 'TOKEN_SUBJECT_MISMATCH' });
});

it('期限前1毫秒有效，到期等号与之后均过期，不修改真实系统时间', async () => {
  let clock = now;
  const tokens = new JwtTokenService({ secret, ttlSeconds: 1 }, () => clock);
  const issued = await tokens.issue(identity);
  clock = new Date(issued.expiresAt.getTime() - 1);
  await expect(tokens.verify(issued.accessToken, 'EMPLOYEE')).resolves.toBeDefined();
  clock = issued.expiresAt;
  await expect(tokens.verify(issued.accessToken, 'EMPLOYEE')).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
  clock = new Date(clock.getTime() + 1000);
  await expect(tokens.verify(issued.accessToken, 'EMPLOYEE')).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
});

it('修改签名或用另一密钥签发均不能通过', async () => {
  const issued = await service().issue(identity);
  const parts = issued.accessToken.split('.');
  parts[1] = Buffer.from(JSON.stringify({ ...claims(), tokenVersion: 999 })).toString('base64url');
  await expect(service().verify(parts.join('.'), 'EMPLOYEE')).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  const forged = await new SignJWT(claims()).setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .sign(new TextEncoder().encode('another-test-jwt-key-'.repeat(4)));
  await expect(service().verify(forged, 'EMPLOYEE')).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
});

it.each(['HS384', 'HS512'])('拒绝白名单之外的%s算法，即使签名与密钥正确', async alg => {
  const token = await sign(claims(), { alg, typ: 'JWT' });
  await expect(service().verify(token, 'EMPLOYEE')).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
});

it('拒绝无签名none算法和Bearer前缀，校验服务只接受token本体', async () => {
  const raw = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(claims())).toString('base64url')}.`;
  await expect(service().verify(raw, 'EMPLOYEE')).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  const token = await sign(claims());
  await expect(service().verify(`Bearer ${token}`, 'EMPLOYEE')).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
});

it.each(['sub', 'sid', 'subjectType', 'tokenVersion', 'iat', 'exp', 'iss', 'aud'])('缺少必要字段%s时拒绝', async field => {
  const payload: Record<string, unknown> = claims(); delete payload[field];
  await expect(service().verify(await sign(payload), 'EMPLOYEE')).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
});

it.each([
  ['未知签发者', { iss: 'other-api' }], ['未知接收者', { aud: 'other-app' }],
  ['接收者数组', { aud: ['shop-admin', 'shop-store'] }],
  ['员工伪装成顾客域', { aud: 'shop-store' }], ['未知主体类型', { subjectType: 'ADMIN' }],
  ['顾客类型与员工域混用', { subjectType: 'CUSTOMER' }],
  ['非法主体ID', { sub: 'not-a-uuid' }], ['非法会话ID', { sid: 'not-a-uuid' }],
  ['ID错误类型', { sub: 123 }], ['版本为字符串', { tokenVersion: '2' }],
  ['版本为负', { tokenVersion: -1 }], ['版本为小数', { tokenVersion: 0.5 }],
  ['版本超安全整数', { tokenVersion: Number.MAX_SAFE_INTEGER + 1 }],
  ['未来签发时间', { iat: seconds + 1 }], ['签发时间为负', { iat: -1 }],
  ['签发时间为小数', { iat: seconds + 0.1 }], ['到期时间为小数', { exp: seconds + 7200.5 }],
  ['到期不晚于签发', { iat: seconds, exp: seconds }],
  ['手机号字段', { phone: '13800138001' }], ['权限字段', { permissions: ['employee.create'] }],
  ['密码字段', { password: 'private-test-value' }], ['未知附加字段', { custom: true }],
])('%s不被接受', async (_name, patch) => {
  const token = await sign({ ...claims(), ...patch });
  const expected = 'exp' in patch && patch.exp === seconds ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';
  await expect(service().verify(token, 'EMPLOYEE')).rejects.toMatchObject({ code: expected });
});

it.each([{ alg: 'HS256', typ: 'other' }, { alg: 'HS256' }, { alg: 'HS256', typ: 'JWT', kid: 'unexpected' },
  { alg: 'HS256', typ: 'JWT', jku: 'https://example.invalid/key' }])('拒绝错误类型或未声明header', async header => {
  const token = await new SignJWT(claims()).setProtectedHeader(header).sign(key);
  await expect(service().verify(token, 'EMPLOYEE')).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
});

it.each(['', 'garbage', 'a.b.c', 'x'.repeat(4097)])('拒绝空、损坏或过长token', async token => {
  await expect(service().verify(token, 'EMPLOYEE')).rejects.toBeInstanceOf(TokenValidationError);
});

it.each([{ ...identity, subjectId: 'bad' }, { ...identity, sessionId: 'bad' },
  { ...identity, tokenVersion: -1 }, { ...identity, tokenVersion: 1.5 }])('签发前校验身份数据', async invalid => {
  await expect(service().issue(invalid)).rejects.toThrow('JWT签发身份不合法');
});

it('过期异常只保留固定错误，不携带jose payload、cause或token', async () => {
  const token = await sign({ ...claims(), exp: seconds - 1 });
  let caught: unknown;
  try { await service().verify(token, 'EMPLOYEE'); } catch (error) { caught = error; }
  expect(caught).toMatchObject({ code: 'TOKEN_EXPIRED', message: '登录凭证已过期' });
  expect(caught).not.toHaveProperty('payload');
  expect(caught).not.toHaveProperty('cause');
  expect(JSON.stringify(caught).includes(token)).toBe(false);
  expect(JSON.stringify(service()).includes(secret)).toBe(false);
});

it('独立JWT模块正确注入服务，密钥缺失时模块构建失败', async () => {
  vi.stubEnv('JWT_SECRET', secret); vi.stubEnv('JWT_TTL_SECONDS', '7200');
  const module = await Test.createTestingModule({ imports: [JwtTokenModule] }).compile();
  expect(module.get(JwtTokenService)).toBeInstanceOf(JwtTokenService);
  await module.close();
  vi.stubEnv('JWT_SECRET', '');
  await expect(Test.createTestingModule({ imports: [JwtTokenModule] }).compile()).rejects.toThrow('JWT_SECRET');
});
