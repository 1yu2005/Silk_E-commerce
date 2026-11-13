// 作用：分别保存步骤9定向检查证据，失败记录不覆盖；集成测试只创建各自随机专属库。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
const root = process.cwd(); const api = resolve('apps/api'); const require = createRequire(resolve(api, 'package.json'));
const directory = 'docs/verification/evidence/M0-04/step09'; const env = { ...parseEnv(readFileSync('.env', 'utf8')), ...process.env };
const mode = process.argv[2]; const label = process.argv[3] ?? 'attempt1'; assert.match(label, /^[a-z0-9-]+$/);
assert.ok(!existsSync(`${directory}/${mode}-${label}.json`), '不能覆盖既有检查记录');
const tsc = resolve('node_modules/typescript/bin/tsc'); const vitest = resolve(require.resolve('vitest/package.json'), '../vitest.mjs');
const plans = {
  typecheck: { args: [tsc, '-p', 'apps/api/tsconfig.json', '--noEmit'] },
  lint: { args: [resolve('node_modules/eslint/bin/eslint.js'), 'apps/api/src/tasks', 'apps/api/src/audit/audit.service.ts', 'apps/api/src/auth/auth-transaction.ts',
    'apps/api/test/task-kernel.integration.ts', 'apps/api/test/task-kernel.spec.ts', 'apps/api/test/order-timer.spec.ts', 'apps/api/test/fixtures/task-kernel-business.ts', 'apps/api/test/task-deadline.integration.ts', 'apps/api/test/task-deadline.spec.ts', 'apps/api/test/fixtures/task-deadline-business.ts', 'apps/api/test/task-access.spec.ts', 'apps/api/test/task-access.integration.ts', 'apps/api/test/fixtures/task-access-business.ts', 'apps/api/test/swagger.spec.ts',
    'packages/api-client/test/tasks-client.test.mjs', 'packages/api-client/test/tasks-types.ts', `${directory}/*.mjs`] },
  unit: { args: [vitest, 'run', '--config', 'vitest.config.mts', 'test/task-kernel.spec.ts', 'test/order-timer.spec.ts', 'test/task-deadline.spec.ts', 'test/task-access.spec.ts', 'test/task-stage.spec.ts', 'test/auth-transaction.spec.ts',
    'test/settings-audit.spec.ts', 'test/audit-records.spec.ts', 'test/swagger.spec.ts', 'test/bootstrap.spec.ts', 'test/validation.spec.ts', ...process.argv.slice(4)], cwd: api },
  export: { args: [resolve('scripts/export-openapi.mjs')] }, generate: { args: [resolve('scripts/generate-api-client.mjs')] },
  contracts: { args: [resolve('scripts/check-contracts.mjs')] },
  'client-typecheck': { args: [tsc, '-p', 'packages/api-client/tsconfig.json', '--noEmit'] },
  'client-types': { args: [tsc, '--noEmit', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'es2022', '--strict', '--skipLibCheck',
    'packages/api-client/test/tasks-types.ts', 'packages/api-client/test/generated-types.ts'] },
  'client-build': { args: [tsc, '-p', 'packages/api-client/tsconfig.json'] },
  'client-test': { args: ['--test', 'packages/api-client/test/tasks-client.test.mjs', 'packages/api-client/test/generated-client.test.mjs',
    'packages/api-client/test/auth-client.test.mjs', 'packages/api-client/test/settings-client.test.mjs', 'packages/api-client/test/contracts.test.mjs'] },
};
let plan;
if (['integration', 'access-integration', 'entry-integration', 'reassign-integration', 'deadline-integration'].includes(mode)) {
  const dev = new URL(env.DATABASE_URL); const test = new URL(env.TEST_DATABASE_URL);
  assert.notEqual(dev.pathname, test.pathname); assert.match(test.pathname, /^\/[a-z][a-z0-9_]*_test$/); assert.equal(dev.hostname, test.hostname); assert.equal(dev.port, test.port);
  plan = { args: [vitest, 'run', '--config', 'vitest.integration.config.mts', ...(mode === 'integration' ? ['test/task-kernel.integration.ts'] : mode === 'deadline-integration' ? ['test/task-deadline.integration.ts'] : mode === 'access-integration' ? ['test/task-access.integration.ts'] : mode === 'entry-integration' ? ['test/task-entry.integration.ts'] : ['test/task-reassign.integration.ts']),
    ...process.argv.slice(4)], cwd: api, env: { ...env, DATABASE_URL: test.toString(), DEVELOPMENT_DATABASE_URL: dev.toString() } };
} else { assert.ok(Object.hasOwn(plans, mode), '未知检查组'); plan = plans[mode]; }
const result = spawnSync(process.execPath, plan.args, { cwd: plan.cwd ?? root, env: { ...(plan.env ?? env), NODE_ENV: 'test', LOG_LEVEL: 'silent' },
  encoding: 'utf8', windowsHide: true, timeout: 180_000 });
let output = String(result.stdout ?? '') + String(result.stderr ?? '');
for (const [key, secret] of Object.entries(env)) if (/SECRET|PASSWORD|DATABASE_URL|TOKEN/i.test(key) && secret?.length >= 8) output = output.replaceAll(secret, '[REDACTED]');
writeFileSync(`${directory}/${mode}-${label}.txt`, output);
const report = { checkedAt: new Date().toISOString(), mode, label, exitCode: result.status, spawnError: result.error?.code ?? null };
writeFileSync(`${directory}/${mode}-${label}.json`, JSON.stringify(report, null, 2) + '\n'); console.log(output.slice(-7000)); console.log(JSON.stringify(report));
if (result.status !== 0 || result.error) process.exitCode = 1;
