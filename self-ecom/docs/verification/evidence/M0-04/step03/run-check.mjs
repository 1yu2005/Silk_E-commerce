// 作用：执行步骤3相关检查并逐次保存脱敏日志，不写开发库或覆盖失败记录。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
const root = process.cwd(); const api = resolve(root, 'apps/api'); const require = createRequire(resolve(api, 'package.json'));
const directory = resolve(root, 'docs/verification/evidence/M0-04/step03');
const env = { ...parseEnv(readFileSync('.env', 'utf8')), ...process.env };
const mode = process.argv[2]; const label = process.argv[3] ?? 'attempt1'; assert.match(label, /^[a-z0-9-]+$/);
assert.ok(!existsSync(resolve(directory, `${mode}-${label}.json`)), '检查标签已用，不能覆盖');
const tsc = resolve(root, 'node_modules/typescript/bin/tsc'); const vitest = resolve(require.resolve('vitest/package.json'), '../vitest.mjs');
const plans = {
  typecheck: { args: [tsc, '-p', 'apps/api/tsconfig.json', '--noEmit'], cwd: root, env },
  'client-typecheck': { args: [tsc, '-p', 'packages/api-client/tsconfig.contracts.json'], cwd: root, env },
  lint: { args: [resolve(root, 'node_modules/eslint/bin/eslint.js'), 'apps/api/src/settings', 'apps/api/src/app.module.ts',
    'apps/api/src/audit/audit.service.ts', 'apps/api/src/common/http/api-exception.filter.ts', 'apps/api/test/settings.integration.ts',
    'apps/api/test/settings-audit.spec.ts', 'apps/api/test/swagger.spec.ts', 'packages/api-client/src/auth-client.ts', 'packages/api-client/src/generated',
    'packages/api-client/test/settings-client.test.mjs', 'packages/api-client/test/generated-types.ts',
    'scripts/generate-api-client.mjs',
    'docs/verification/evidence/M0-04/step03/*.mjs'], cwd: root, env },
  unit: { args: [vitest, 'run', '--config', 'vitest.config.mts', 'test/settings-audit.spec.ts', 'test/audit-records.spec.ts',
    'test/swagger.spec.ts', 'test/bootstrap.spec.ts', 'test/validation.spec.ts', ...process.argv.slice(4)], cwd: api, env: { ...env, NODE_ENV: 'test', LOG_LEVEL: 'silent' } },
  export: { args: ['scripts/export-openapi.mjs'], cwd: root, env },
  generate: { args: ['scripts/generate-api-client.mjs'], cwd: root, env },
  contracts: { args: ['scripts/check-contracts.mjs'], cwd: root, env },
  drift: { args: ['scripts/test-contract-drift.mjs'], cwd: root, env },
  'client-build': { args: [tsc, '-p', 'packages/api-client/tsconfig.json'], cwd: root, env },
  client: { args: ['--test', 'packages/api-client/test/settings-client.test.mjs', 'packages/api-client/test/generated-client.test.mjs',
    'packages/api-client/test/auth-client.test.mjs', 'packages/api-client/test/contracts.test.mjs'], cwd: root, env },
};
function run(plan) { return spawnSync(process.execPath, plan.args, { cwd: plan.cwd, env: plan.env,
  encoding: 'utf8', windowsHide: true, timeout: 180_000 }); }
function redact(value) {
  let text = String(value ?? '');
  for (const [key, secret] of Object.entries(env)) if (/SECRET|PASSWORD|DATABASE_URL|TOKEN/i.test(key) && secret?.length >= 8) text = text.replaceAll(secret, '[REDACTED]');
  return text;
}
let result; let prefix = '';
if (mode === 'integration' || mode === 'settings-only') {
  const prepare = run({ args: [require.resolve('tsx/cli'), '--eval',
    "const {readDatabaseEnvironment,assertSafeTestDatabase}=require('./scripts/database-env.ts');const {prepareTestDatabase,runPrisma}=require('./scripts/database.ts');(async()=>{const env=readDatabaseEnvironment();const safe=assertSafeTestDatabase(env.DATABASE_URL,env.TEST_DATABASE_URL);await prepareTestDatabase(env);runPrisma(['migrate','deploy'],{...env,DATABASE_URL:safe.testUrl});})().catch(()=>{console.error('测试库准备失败');process.exitCode=1;});"], cwd: api, env });
  prefix = redact(prepare.stdout) + redact(prepare.stderr);
  if (prepare.status !== 0 || prepare.error) result = prepare;
  else {
    const dev = new URL(env.DATABASE_URL); const test = new URL(env.TEST_DATABASE_URL);
    assert.notEqual(dev.pathname, test.pathname); assert.match(test.pathname, /^\/[a-z][a-z0-9_]*_test$/);
    const files = mode === 'settings-only' ? ['test/settings.integration.ts'] : ['test/settings.integration.ts', 'test/audit.integration.ts', 'test/employee-profile.integration.ts'];
    result = run({ args: [vitest, 'run', '--config', 'vitest.integration.config.mts', ...files, ...process.argv.slice(4)], cwd: api,
      env: { ...env, NODE_ENV: 'test', DATABASE_URL: test.toString(), DEVELOPMENT_DATABASE_URL: dev.toString(), LOG_LEVEL: 'silent' } });
  }
} else { assert.ok(Object.hasOwn(plans, mode), '未知检查组'); result = run(plans[mode]); }
const output = prefix + redact(result.stdout) + redact(result.stderr);
writeFileSync(resolve(directory, `${mode}-${label}.txt`), output);
const report = { checkedAt: new Date().toISOString(), mode, label, exitCode: result.status, spawnError: result.error?.code ?? null };
writeFileSync(resolve(directory, `${mode}-${label}.json`), JSON.stringify(report, null, 2) + '\n');
console.log(output.slice(-7000)); console.log(JSON.stringify(report));
if (result.status !== 0 || result.error) process.exitCode = 1;
