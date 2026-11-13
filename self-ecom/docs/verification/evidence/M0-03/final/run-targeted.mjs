// 作用：只复验受影响的顾客登录并发测试，显式检查测试库并保留失败/修复后的独立证据。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
const env = { ...parseEnv(readFileSync('.env', 'utf8')), ...process.env };
const test = new URL(env.TEST_DATABASE_URL); const dev = new URL(env.DATABASE_URL);
assert.ok(test.pathname !== dev.pathname && /^[a-z][a-z0-9_]*_test$/.test(test.pathname.slice(1)));
assert.equal(test.host.replace('127.0.0.1', 'localhost'), dev.host.replace('127.0.0.1', 'localhost'));
const require = createRequire(resolve('apps/api/package.json'));
const args = [resolve(require.resolve('vitest/package.json'), '../vitest.mjs'), 'run', '--config', 'vitest.integration.config.mts', 'test/customer-auth.integration.ts'];
const name = process.argv[2]; assert.match(name, /^[a-z0-9-]+$/);
if (process.argv.includes('--single')) args.push('--testNamePattern', '冻结先持顾客锁');
const result = spawnSync(process.execPath, args, { cwd: resolve('apps/api'), env: { ...env, NODE_ENV: 'test',
  DATABASE_URL: test.toString(), DEVELOPMENT_DATABASE_URL: dev.toString() }, encoding: 'utf8', windowsHide: true, timeout: 120000 });
let log = String(result.stdout ?? '') + String(result.stderr ?? '');
for (const [key, value] of Object.entries(env)) if (/SECRET|PASSWORD|DATABASE_URL|TOKEN/i.test(key) && value?.length >= 8) log = log.replaceAll(value, '[REDACTED]');
const item = { timestamp: new Date().toISOString(), file: 'customer-auth.integration.ts', singleCase: process.argv.includes('--single'), exitCode: result.status, spawnError: result.error?.code ?? null };
writeFileSync(`docs/verification/evidence/M0-03/final/customer-auth-${name}.txt`, log);
writeFileSync(`docs/verification/evidence/M0-03/final/customer-auth-${name}.json`, JSON.stringify(item, null, 2) + '\n');
console.log(log.slice(-2400)); console.log(JSON.stringify(item)); if (result.status !== 0 || result.error) process.exitCode = 1;
