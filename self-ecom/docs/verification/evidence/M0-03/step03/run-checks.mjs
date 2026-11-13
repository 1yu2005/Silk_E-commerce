// 作用：只运行文件步骤及直接受影响能力的检查，记录退出码与脱敏日志，不运行全量回归。
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
const require = createRequire(resolve('apps/api/package.json'));
const env = { ...parseEnv(readFileSync('.env', 'utf8')), ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)) };
const directory = resolve('docs/verification/evidence/M0-03/step03');
const vitest = resolve(require.resolve('vitest/package.json'), '../vitest.mjs');
const group = process.argv[2]; const attempt = process.argv[3] ?? 'final';
const commands = {
  static: [
    ['lint', resolve('.'), [resolve('node_modules/eslint/bin/eslint.js'), 'apps/api/src/files', 'apps/api/src/records',
      'apps/api/src/common/http/api-exception.filter.ts', 'apps/api/src/app.module.ts', 'apps/api/test/files.spec.ts', 'apps/api/test/files.integration.ts', 'apps/api/test/records.integration.ts', 'apps/api/test/swagger.spec.ts']],
    ['typecheck', resolve('.'), [resolve('node_modules/typescript/bin/tsc'), '-p', 'apps/api/tsconfig.json', '--noEmit']],
    ['build', resolve('.'), [resolve('node_modules/typescript/bin/tsc'), '-p', 'apps/api/tsconfig.build.json']],
  ],
  unit: [['unit', resolve('apps/api'), [vitest, 'run', '--config', 'vitest.config.mts', 'test/files.spec.ts', 'test/audit-records.spec.ts', 'test/swagger.spec.ts']]],
  targeted: [['integration', resolve('apps/api'), [vitest, 'run', '--config', 'vitest.integration.config.mts', 'test/files.integration.ts', 'test/records.integration.ts', 'test/audit.integration.ts']]],
  files: [['files', resolve('apps/api'), [vitest, 'run', '--config', 'vitest.integration.config.mts', 'test/files.integration.ts']]],
};
if (!Object.hasOwn(commands, group) || !/^[a-z0-9-]+$/.test(attempt)) throw new Error('未知验证组或标记');
const test = new URL(env.TEST_DATABASE_URL); const dev = new URL(env.DATABASE_URL);
if (!/^[a-z][a-z0-9_]*_test$/.test(test.pathname.slice(1)) || test.pathname === dev.pathname
  || test.hostname !== dev.hostname || test.port !== dev.port) throw new Error('测试库隔离检查失败');
const results = [];
for (const [name, cwd, args] of commands[group]) {
  const child = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 120000,
    maxBuffer: 8 * 1024 * 1024, env: ['targeted', 'files'].includes(group) ? { ...env, NODE_ENV: 'test', DATABASE_URL: test.toString(),
      DEVELOPMENT_DATABASE_URL: dev.toString() } : env });
  let output = String(child.stdout ?? '') + String(child.stderr ?? '');
  for (const [key, value] of Object.entries(env)) if (/SECRET|PASSWORD|DATABASE_URL|TOKEN/i.test(key) && value?.length >= 8) output = output.replaceAll(value, '[REDACTED]');
  writeFileSync(resolve(directory, `${name}-${attempt}.txt`), output);
  const result = { name, exitCode: child.status, spawnError: child.error?.code ?? null, node: process.version, timestamp: new Date().toISOString() };
  results.push(result); console.log(output.slice(-9000)); console.log(JSON.stringify(result));
  if (child.status !== 0 || child.error) { process.exitCode = 1; break; }
}
writeFileSync(resolve(directory, `${group}-${attempt}.json`), JSON.stringify(results, null, 2) + '\n');
