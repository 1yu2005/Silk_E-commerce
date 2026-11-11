import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

export function readDatabaseEnvironment(): NodeJS.ProcessEnv {
  let fileValues: NodeJS.ProcessEnv = {};
  try {
    fileValues = parseEnv(readFileSync(resolve(__dirname, '../../../.env'), 'utf8'));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      // eslint-disable-next-line preserve-caught-error -- 禁止附带原始配置错误。
      throw new Error('无法读取数据库环境配置文件');
    }
  }
  const overrides = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined));
  return { ...fileValues, ...overrides };
}

export function parseDatabaseUrl(value: string | undefined, key: string): URL {
  try {
    const url = new URL(value ?? '');
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname
      || !url.username || !/^\/[a-z][a-z0-9_]*$/.test(url.pathname) || url.hash) {
      throw new Error();
    }
    return url;
  } catch {
    throw new Error(`${key}: 须为有效的PostgreSQL连接串和简单数据库名`);
  }
}

/** 创建测试数据库、执行迁移、准备测试数据或清理前，必须先执行此检查。 */
export function assertSafeTestDatabase(development: string | undefined, testing: string | undefined) {
  const dev = parseDatabaseUrl(development, 'DATABASE_URL');
  const test = parseDatabaseUrl(testing, 'TEST_DATABASE_URL');
  if (!/^[a-z][a-z0-9_]*_test$/.test(test.pathname.slice(1))) {
    throw new Error('TEST_DATABASE_URL: 测试数据库名必须以_test结尾');
  }
  if (dev.pathname === test.pathname) {
    throw new Error('TEST_DATABASE_URL: 测试库不得与开发库同名');
  }
  const host = (url: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    ? 'loopback' : url.hostname;
  if (host(dev) !== host(test) || (dev.port || '5432') !== (test.port || '5432')) {
    throw new Error('TEST_DATABASE_URL: 本阶段测试库必须与开发库位于同一数据库服务');
  }
  return { developmentUrl: dev.toString(), testUrl: test.toString(), testName: test.pathname.slice(1) };
}
