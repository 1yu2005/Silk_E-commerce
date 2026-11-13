// 作用：只运行公共契约及直接调用方检查，单独记录退出码；数据库组严格限定测试库。
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
const root = resolve('.'); const directory = resolve('docs/verification/evidence/M0-03/step05');
const require = createRequire(resolve('apps/api/package.json')); const vitest = resolve(require.resolve('vitest/package.json'), '../vitest.mjs');
const env = { ...parseEnv(readFileSync('.env', 'utf8')), ...process.env }; const tsc = resolve('node_modules/typescript/bin/tsc');
const test = new URL(env.TEST_DATABASE_URL); const dev = new URL(env.DATABASE_URL);
if (test.pathname === dev.pathname || !/^[a-z][a-z0-9_]*_test$/.test(test.pathname.slice(1))) throw new Error('测试库隔离校验失败');
const commands = {
  static: [['lint', root, [resolve('node_modules/eslint/bin/eslint.js'), 'scripts', 'packages/shared/src', 'packages/shared/test',
    'packages/api-client/src', 'packages/api-client/test', 'apps/api/src/common', 'apps/api/src/records/record-support.ts',
    'apps/api/src/employees/employee-query.service.ts', 'apps/api/src/auth/customer-avatar.controller.ts', 'apps/api/scripts/openapi.ts',
    'apps/api/test/command-fingerprint.spec.ts', 'apps/api/test/validation.spec.ts', 'apps/api/test/swagger.spec.ts']],
    ...['shared', 'api-client', 'ui'].map(name => [name + '-build', root, [tsc, '-p', `packages/${name}/tsconfig.json`]]),
    ['generated-types', root, [tsc, '-p', 'packages/api-client/tsconfig.contracts.json']],
    ...['api', 'store-web', 'admin-web'].map(name => [name + '-types', root, [tsc, '-p', `apps/${name}/tsconfig.json`, '--noEmit']])],
  unit: [['shared', resolve('packages/shared'), ['--test', 'test/command-contract.test.mjs']],
    ['client', resolve('packages/api-client'), ['--test', 'test/auth-client.test.mjs', 'test/session.test.mjs', 'test/employee-management.test.mjs',
      'test/files-client.test.mjs', 'test/contracts.test.mjs', 'test/generated-client.test.mjs']],
    ['api', resolve('apps/api'), [vitest, 'run', '--config', 'vitest.config.mts', 'test/command-fingerprint.spec.ts', 'test/validation.spec.ts', 'test/swagger.spec.ts']],
    ...['store-web', 'admin-web'].map(name => [name + '-controller', resolve(`apps/${name}`), ['--test', 'test/auth-controller.test.mjs']])],
  targeted: [['pagination-callers', resolve('apps/api'), [vitest, 'run', '--config', 'vitest.integration.config.mts', 'test/employee-query.integration.ts', 'test/records.integration.ts']]],
  web: ['store-web', 'admin-web'].map(name => [name, resolve(`apps/${name}`), [resolve(`apps/${name}/node_modules/vite/bin/vite.js`), 'build']]),
  contracts: [['check', root, [resolve('scripts/check-contracts.mjs')]]],
};
const group = process.argv[2]; const attempt = process.argv[3] ?? 'final';
if (!commands[group] || !/^[a-z0-9-]+$/.test(attempt)) throw new Error('无效检查分组');
const results = [];
for (const [name, cwd, args] of commands[group]) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024,
    env: group === 'targeted' ? { ...env, NODE_ENV: 'test', DATABASE_URL: test.toString(), DEVELOPMENT_DATABASE_URL: dev.toString() }
      : group === 'web' ? { ...env, NODE_ENV: 'production' } : env });
  let output = String(result.stdout ?? '') + String(result.stderr ?? '');
  for (const [key, value] of Object.entries(env)) if (/SECRET|PASSWORD|DATABASE_URL|TOKEN/i.test(key) && value?.length >= 8) output = output.replaceAll(value, '[REDACTED]');
  writeFileSync(resolve(directory, `${group}-${name}-${attempt}.txt`), output);
  const item = { name, exitCode: result.status, spawnError: result.error?.code ?? null, timestamp: new Date().toISOString() }; results.push(item);
  console.log(output.slice(-2500)); console.log(JSON.stringify(item)); if (result.status !== 0 || result.error) { process.exitCode = 1; break; }
}
writeFileSync(resolve(directory, `${group}-${attempt}.json`), JSON.stringify(results, null, 2) + '\n');
