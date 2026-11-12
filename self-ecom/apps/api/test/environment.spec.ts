// 作用：验证工程环境读取、配置优先级及无效启动参数的严格拒绝。
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { loadConfiguration, validateEnvironment } from '../src/config/environment.js';

const valid = {
  DATABASE_URL: 'postgresql://shop:private-password@localhost:5432/shop_test',
  CORS_ORIGINS: 'http://localhost:5173,http://localhost:5174',
};
const directory = mkdtempSync(join(tmpdir(), 'shop-config-'));
afterAll(() => { rmSync(directory, { recursive: true, force: true }); });

it('uses explicit, typed defaults', () => {
  const config = validateEnvironment(valid);
  expect(config.port).toBe(3000);
  expect(config.nodeEnv).toBe('development');
  expect(config.swaggerEnabled).toBe(false);
  expect(config.logLevel).toBe('info');
  expect(isAbsolute(config.uploadDir)).toBe(true);
});

it.each(['1', '65535', '3100'])('accepts valid PORT %s', PORT => {
  expect(validateEnvironment({ ...valid, PORT }).port).toBe(Number(PORT));
});

it.each(['0', '65536', '-1', '3.5', 'abc', '', ' 3000 ', '3e3'])(
  'rejects invalid PORT %s', PORT => {
    expect(() => validateEnvironment({ ...valid, PORT })).toThrow('PORT');
  },
);

it.each(['false', 'true'])('strictly parses SWAGGER_ENABLED=%s', SWAGGER_ENABLED => {
  expect(validateEnvironment({ ...valid, SWAGGER_ENABLED }).swaggerEnabled).toBe(SWAGGER_ENABLED === 'true');
});

it.each(['FALSE', '1', 'yes', 'abc', ''])(
  'rejects ambiguous booleans %s', SWAGGER_ENABLED => {
    expect(() => validateEnvironment({ ...valid, SWAGGER_ENABLED })).toThrow('SWAGGER_ENABLED');
  },
);

it.each(['', 'https://shop:private-password@localhost/db', 'postgresql://localhost/db',
  'postgresql://shop:private-password@localhost/'])(
  'rejects missing or invalid database configuration without exposing it', DATABASE_URL => {
    let message = '';
    try { validateEnvironment({ ...valid, DATABASE_URL }); } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain('private-password');
    expect(message).not.toContain('postgresql://');
  },
);

it.each(['*', 'http://localhost:5173', 'http://localhost:5173,http://localhost:5173',
  'http://localhost:5173/path,http://localhost:5174',
  'http://user:password@localhost:5173,http://localhost:5174',
  'javascript:alert(1),http://localhost:5174'])(
  'rejects unsafe or incomplete CORS origins', CORS_ORIGINS => {
    expect(() => validateEnvironment({ ...valid, CORS_ORIGINS })).toThrow('CORS_ORIGINS');
  },
);

it('reports all invalid variable names together without their values', () => {
  expect(() => validateEnvironment({ ...valid, NODE_ENV: 'unknown', PORT: 'abc',
    LOG_LEVEL: 'invalid', SWAGGER_ENABLED: 'yes', UPLOAD_DIR: './relative',
  })).toThrow(/NODE_ENV[\s\S]*PORT[\s\S]*UPLOAD_DIR[\s\S]*SWAGGER_ENABLED[\s\S]*LOG_LEVEL/);
});

it('loads a specific env file and gives process variables precedence', () => {
  const path = join(directory, '.env');
  writeFileSync(path, `DATABASE_URL=${valid.DATABASE_URL}\nCORS_ORIGINS=${valid.CORS_ORIGINS}\nPORT=3101\nSWAGGER_ENABLED=false\n`);
  const config = loadConfiguration({ PORT: '3102' }, path);
  expect(config.port).toBe(3102);
  expect(config.swaggerEnabled).toBe(false);
  expect(config.databaseUrl).toBe(valid.DATABASE_URL);
});

it('accepts a missing env file when process configuration is complete', () => {
  expect(loadConfiguration(valid, join(directory, 'missing.env')).port).toBe(3000);
});

it('fails on a missing required variable even when the env file is absent', () => {
  expect(() => loadConfiguration({}, join(directory, 'missing.env'))).toThrow('DATABASE_URL');
});
