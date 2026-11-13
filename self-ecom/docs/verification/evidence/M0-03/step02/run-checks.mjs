// 作用：固定本步骤验证入口，保留真实输出和退出码；数据库测试只允许独立测试库。
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
  || host(dev) !== host(test) || (dev.port || '5432') !== (test.port || '5432')) throw new Error('测试库隔离校验失败');
const directory = resolve('docs/verification/evidence/M0-03/step02');
const vitest = resolve(require.resolve('vitest/package.json'), '../vitest.mjs');
const commands = {
  static: [
    ['lint', resolve('.'), [resolve('node_modules/eslint/bin/eslint.js'), 'apps/api/src', 'apps/api/test', 'apps/api/scripts', 'apps/api/prisma.config.ts']],
    ['typecheck', resolve('.'), [resolve('node_modules/typescript/bin/tsc'), '-p', 'apps/api/tsconfig.json', '--noEmit']],
    ['build', resolve('.'), [resolve('node_modules/typescript/bin/tsc'), '-p', 'apps/api/tsconfig.build.json']],
  ],
  unit: [['unit', resolve('apps/api'), [vitest, 'run', '--config', 'vitest.config.mts']]],
  targeted: [['records-targeted', resolve('apps/api'), [vitest, 'run', '--config', 'vitest.integration.config.mts', 'test/records.integration.ts', 'test/audit.integration.ts']]],
  full: [['integration-final', resolve('apps/api'), [vitest, 'run', '--config', 'vitest.integration.config.mts']]],
};
const group = process.argv[2];
if (!Object.hasOwn(commands, group)) throw new Error('未知验证分组');
const results = [];
for (const [name, cwd, args] of commands[group]) {
  const testing = ['targeted', 'full'].includes(group);
  const child = spawnSync(process.execPath, args, { cwd,
    env: testing ? { ...env, NODE_ENV: 'test', DATABASE_URL: test.toString(), DEVELOPMENT_DATABASE_URL: dev.toString() } : env,
    encoding: 'utf8', timeout: 420000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  let output = String(child.stdout ?? '') + String(child.stderr ?? '');
  for (const [key, value] of Object.entries(env)) {
    if (/SECRET|PASSWORD|DATABASE_URL|TOKEN/i.test(key) && typeof value === 'string' && value.length >= 8) output = output.replaceAll(value, '[REDACTED]');
  }
  writeFileSync(resolve(directory, name + '.txt'), output);
  const result = { name, exitCode: child.status, spawnErrorCode: child.error?.code ?? null, database: testing ? '独立测试库' : '无数据库业务写入', node: process.version };
  results.push(result);
  console.log(output.slice(-6500)); console.log(JSON.stringify(result));
  if (child.error || child.status !== 0) { process.exitCode = 1; break; }
}
writeFileSync(resolve(directory, group + '-result.json'), JSON.stringify(results, null, 2) + '\n');
