// 作用：验证 JWT 密钥、签发者、受众和期限等启动配置的严格校验。
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, expect, it } from 'vitest';
import { loadJwtConfiguration, validateJwtConfiguration } from '../src/config/jwt-configuration.js';

const secret = 'test-only-key-'.repeat(4);
const directory = mkdtempSync(join(tmpdir(), 'shop-jwt-config-'));
const envFile = join(directory, '.env');
writeFileSync(envFile, `JWT_SECRET=${secret}\nJWT_TTL_SECONDS=60\n`);
afterAll(() => { unlinkSync(envFile); rmdirSync(directory); });

it('JWT默认两小时，允许1秒测试期限及一天上界', () => {
  expect(validateJwtConfiguration({ JWT_SECRET: secret }).ttlSeconds).toBe(7200);
  expect(validateJwtConfiguration({ JWT_SECRET: secret, JWT_TTL_SECONDS: '1' }).ttlSeconds).toBe(1);
  expect(validateJwtConfiguration({ JWT_SECRET: secret, JWT_TTL_SECONDS: '86400' }).ttlSeconds).toBe(86400);
});

it.each([undefined, '', ' ', 'x'.repeat(31), ' '.repeat(32)])('拒绝缺失、空白或不足32字节密钥', JWT_SECRET => {
  expect(() => validateJwtConfiguration({ JWT_SECRET })).toThrow('JWT_SECRET');
});

it('密钥按UTF-8字节数判断且不自动trim', () => {
  const value = ` ${'密'.repeat(11)} `;
  expect(validateJwtConfiguration({ JWT_SECRET: value }).secret).toBe(value);
});

it.each(['0', '-1', '1.5', '1e3', 'abc', '', ' 7200 ', '01', '86401', '9007199254740992'])('拒绝非法TTL %s', JWT_TTL_SECONDS => {
  expect(() => validateJwtConfiguration({ JWT_SECRET: secret, JWT_TTL_SECONDS })).toThrow('JWT_TTL_SECONDS');
});

it('错误只含变量和规则，不回显任何密钥或TTL输入', () => {
  const value = 'short-private-key'; const ttl = 'not-a-private-ttl';
  let message = '';
  try { validateJwtConfiguration({ JWT_SECRET: value, JWT_TTL_SECONDS: ttl }); }
  catch (error) { message = (error as Error).message; }
  expect(message).toContain('JWT_SECRET');
  expect(message).toContain('JWT_TTL_SECONDS');
  expect(message.includes(value)).toBe(false);
  expect(message.includes(ttl)).toBe(false);
});

it('复用根.env读取规则，进程显式值优先且空值不得回退文件密钥', () => {
  expect(loadJwtConfiguration({}, envFile)).toEqual({ secret, ttlSeconds: 60 });
  expect(loadJwtConfiguration({ JWT_SECRET: 'process-test-key-'.repeat(4), JWT_TTL_SECONDS: '30' }, envFile))
    .toEqual({ secret: 'process-test-key-'.repeat(4), ttlSeconds: 30 });
  expect(() => loadJwtConfiguration({ JWT_SECRET: '' }, envFile)).toThrow('JWT_SECRET');
});

it('文件缺失时可只用完整进程JWT配置，没有密钥则失败', () => {
  const missing = join(directory, 'missing.env');
  expect(loadJwtConfiguration({ JWT_SECRET: secret }, missing).ttlSeconds).toBe(7200);
  expect(() => loadJwtConfiguration({}, missing)).toThrow('JWT_SECRET');
});
