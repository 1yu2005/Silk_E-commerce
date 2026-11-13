// 作用：记录头像及图片组件的定向验证，只使用独立测试库，不执行全量回归。
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
const require = createRequire(resolve('apps/api/package.json')); const vitest = resolve(require.resolve('vitest/package.json'), '../vitest.mjs');
const env = { ...parseEnv(readFileSync('.env', 'utf8')), ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)) };
const root = resolve('.'); const directory = resolve('docs/verification/evidence/M0-03/step04');
const tsc = resolve('node_modules/typescript/bin/tsc');
const commands = {
  packages: ['shared', 'api-client', 'ui'].map(name => [name, root, [tsc, '-p', `packages/${name}/tsconfig.json`]]),
  static: [ ['lint', root, [resolve('node_modules/eslint/bin/eslint.js'), 'apps/api/src/auth', 'apps/api/test/customer-avatar.integration.ts',
    'apps/api/test/swagger.spec.ts', 'packages/shared/src', 'packages/api-client/src', 'packages/api-client/test/files-client.test.mjs',
    'packages/ui/src', 'apps/store-web/src', 'apps/store-web/test/auth-controller.test.mjs', 'apps/store-web/test/verify-avatar-browser.mjs',
    'apps/admin-web/src/services/api.ts', 'apps/admin-web/src/main.tsx']],
    ['api-types', root, [tsc, '-p', 'apps/api/tsconfig.json', '--noEmit']],
    ['api-build', root, [tsc, '-p', 'apps/api/tsconfig.build.json']],
    ...['store-web', 'admin-web'].map(name => [name + '-types', root, [tsc, '-p', `apps/${name}/tsconfig.json`, '--noEmit']]),
  ],
  unit: [['swagger', resolve('apps/api'), [vitest, 'run', '--config', 'vitest.config.mts', 'test/swagger.spec.ts']],
    ['client', resolve('packages/api-client'), ['--test', 'test/auth-client.test.mjs', 'test/files-client.test.mjs']],
    ['store-controller', resolve('apps/store-web'), ['--test', 'test/auth-controller.test.mjs']]],
  targeted: [['avatar-integration', resolve('apps/api'), [vitest, 'run', '--config', 'vitest.integration.config.mts',
    'test/customer-avatar.integration.ts', 'test/customer-auth.integration.ts', 'test/customer-profile-password.integration.ts']]],
  web: ['store-web', 'admin-web'].map(name => [name + '-build', resolve(`apps/${name}`), [resolve(`apps/${name}/node_modules/vite/bin/vite.js`), 'build']]),
};
const group = process.argv[2]; const attempt = process.argv[3] ?? 'final';
if (!Object.hasOwn(commands, group) || !/^[a-z0-9-]+$/.test(attempt)) throw new Error('无效验证分组');
const dev = new URL(env.DATABASE_URL); const test = new URL(env.TEST_DATABASE_URL);
if (test.pathname === dev.pathname || !/^[a-z][a-z0-9_]*_test$/.test(test.pathname.slice(1))) throw new Error('独立测试库校验失败');
const results = [];
for (const [name, cwd, args] of commands[group]) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 90000, maxBuffer: 12 * 1024 * 1024,
    env: group === 'targeted' ? { ...env, NODE_ENV: 'test', DATABASE_URL: test.toString(), DEVELOPMENT_DATABASE_URL: dev.toString() }
      : group === 'web' ? { ...env, NODE_ENV: 'production' } : env });
  let output = String(result.stdout ?? '') + String(result.stderr ?? '');
  for (const [key, value] of Object.entries(env)) if (/SECRET|PASSWORD|DATABASE_URL|TOKEN/i.test(key) && value?.length >= 8) output = output.replaceAll(value, '[REDACTED]');
  writeFileSync(resolve(directory, `${name}-${attempt}.txt`), output);
  const item = { name, exitCode: result.status, spawnError: result.error?.code ?? null, timestamp: new Date().toISOString() }; results.push(item);
  console.log(output.slice(-4500)); console.log(JSON.stringify(item)); if (result.status !== 0 || result.error) { process.exitCode = 1; break; }
}
writeFileSync(resolve(directory, `${group}-${attempt}.json`), JSON.stringify(results, null, 2) + '\n');
