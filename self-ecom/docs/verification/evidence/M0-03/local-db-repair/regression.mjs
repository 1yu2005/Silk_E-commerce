// 作用：仅在已校验的隔离测试库回归六组认证测试，保存脱敏输出和退出码，不连接开发库执行业务命令。
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';

const require = createRequire(resolve('apps/api/package.json'));
const env = { ...parseEnv(readFileSync('.env', 'utf8')), ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)) };
const dev = new URL(env.DATABASE_URL); const test = new URL(env.TEST_DATABASE_URL);
const host = url => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ? 'loopback' : url.hostname;
if (!/^[a-z][a-z0-9_]*_test$/.test(test.pathname.slice(1)) || dev.pathname === test.pathname
  || host(dev) !== host(test) || (dev.port || '5432') !== (test.port || '5432')) throw new Error('回归库隔离检查失败');
const files = ['test/auth-session.integration.ts', 'test/customer-auth.integration.ts', 'test/employee-auth.integration.ts',
  'test/customer-register.integration.ts', 'test/customer-profile-password.integration.ts', 'test/audit.integration.ts'];
const args = [resolve(require.resolve('vitest/package.json'), '../vitest.mjs'), 'run', '--config', 'vitest.integration.config.mts', ...files];
const result = spawnSync(process.execPath, args, { cwd: resolve('apps/api'),
  env: { ...env, NODE_ENV: 'test', DATABASE_URL: test.toString(), DEVELOPMENT_DATABASE_URL: dev.toString() },
  encoding: 'utf8', windowsHide: true, timeout: 240000, maxBuffer: 8 * 1024 * 1024 });
let output = String(result.stdout ?? '') + String(result.stderr ?? '');
for (const [key, value] of Object.entries(env)) {
  if (/SECRET|PASSWORD|DATABASE_URL|TOKEN/i.test(key) && typeof value === 'string' && value.length >= 8) output = output.replaceAll(value, '[REDACTED]');
}
const directory = resolve('docs/verification/evidence/M0-03/local-db-repair');
writeFileSync(resolve(directory, 'auth-regression.txt'), output);
writeFileSync(resolve(directory, 'auth-regression-result.json'), JSON.stringify({ node: process.version,
  exitCode: result.status, spawnErrorCode: result.error?.code ?? null, files, database: '独立测试库' }, null, 2) + '\n');
console.log(output.slice(-5000));
console.log(JSON.stringify({ exitCode: result.status, spawnErrorCode: result.error?.code ?? null }));
if (result.error || result.status !== 0) process.exitCode = 1;
