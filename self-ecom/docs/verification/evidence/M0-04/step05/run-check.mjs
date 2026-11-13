// 作用：执行步骤5任务内核的定向检查，分别保留结果；测试仅使用独立且经过校验的测试数据库。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
const root = process.cwd(); const api = resolve(root, 'apps/api'); const require = createRequire(resolve(api, 'package.json'));
const directory = resolve(root, 'docs/verification/evidence/M0-04/step05'); const env = { ...parseEnv(readFileSync('.env', 'utf8')), ...process.env };
const mode = process.argv[2]; const label = process.argv[3] ?? 'attempt1'; assert.match(label, /^[a-z0-9-]+$/);
assert.ok(!existsSync(resolve(directory, `${mode}-${label}.json`)), '不能覆盖既有结果');
const vitest = resolve(require.resolve('vitest/package.json'), '../vitest.mjs');
const plans = {
  typecheck: { args: [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', 'apps/api/tsconfig.json', '--noEmit'] },
  build: { args: [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', 'apps/api/tsconfig.build.json'] },
  lint: { args: [resolve(root, 'node_modules/eslint/bin/eslint.js'), 'apps/api/src/tasks', 'apps/api/src/app.module.ts',
    'apps/api/src/audit/audit.service.ts', 'apps/api/src/common/http/api-exception.filter.ts', 'apps/api/test/task-stage.spec.ts',
    'apps/api/test/task-entry.integration.ts', 'apps/api/test/fixtures/task-entry-business.ts', 'docs/verification/evidence/M0-04/step05/*.mjs'] },
  unit: { args: [vitest, 'run', '--config', 'vitest.config.mts', 'test/task-stage.spec.ts', 'test/time.spec.ts', 'test/settings-audit.spec.ts',
    'test/audit-records.spec.ts', 'test/swagger.spec.ts', 'test/bootstrap.spec.ts', 'test/validation.spec.ts', ...process.argv.slice(4)], cwd: api },
};
let plan;
if (mode === 'integration') {
  const dev = new URL(env.DATABASE_URL); const test = new URL(env.TEST_DATABASE_URL);
  assert.notEqual(dev.pathname, test.pathname); assert.match(test.pathname, /^\/[a-z][a-z0-9_]*_test$/);
  // 用现有安全测试连接只确定服务器，本轮测试文件自行创建和删除随机专属库，不重置shop_test。
  plan = { args: [vitest, 'run', '--config', 'vitest.integration.config.mts', 'test/task-entry.integration.ts', ...process.argv.slice(4)], cwd: api,
    env: { ...env, DATABASE_URL: test.toString(), DEVELOPMENT_DATABASE_URL: dev.toString() } };
} else { assert.ok(Object.hasOwn(plans, mode), '未知检查组'); plan = plans[mode]; }
const result = spawnSync(process.execPath, plan.args, { cwd: plan.cwd ?? root, env: { ...(plan.env ?? env), NODE_ENV: 'test', LOG_LEVEL: 'silent' },
  encoding: 'utf8', windowsHide: true, timeout: 180_000 });
let output = String(result.stdout ?? '') + String(result.stderr ?? '');
for (const [key, secret] of Object.entries(env)) if (/SECRET|PASSWORD|DATABASE_URL|TOKEN/i.test(key) && secret?.length >= 8) output = output.replaceAll(secret, '[REDACTED]');
writeFileSync(resolve(directory, `${mode}-${label}.txt`), output);
const report = { checkedAt: new Date().toISOString(), mode, label, exitCode: result.status, spawnError: result.error?.code ?? null };
writeFileSync(resolve(directory, `${mode}-${label}.json`), JSON.stringify(report, null, 2) + '\n'); console.log(output.slice(-7500)); console.log(JSON.stringify(report));
if (result.status !== 0 || result.error) process.exitCode = 1;
