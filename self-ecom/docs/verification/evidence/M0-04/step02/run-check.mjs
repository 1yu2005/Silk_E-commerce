// 作用：仅执行板块4数据基础的定向检查，保存脱敏日志和退出码，不自动写开发库。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

const root = process.cwd();
const api = resolve(root, 'apps/api');
const require = createRequire(resolve(api, 'package.json'));
const directory = resolve(root, 'docs/verification/evidence/M0-04/step02');
const env = { ...parseEnv(readFileSync(resolve(root, '.env'), 'utf8')), ...process.env };
const mode = process.argv[2]; const attempt = process.argv[3] ?? 'attempt1';
assert.match(attempt, /^[a-z0-9-]+$/);
const prisma = require.resolve('prisma/build/index.js');
const schemaEnv = { ...env, DATABASE_URL: 'postgresql://schema_only:schema_only@127.0.0.1:1/schema_only' };
const testUrl = new URL(env.TEST_DATABASE_URL); const developmentUrl = new URL(env.DATABASE_URL);
assert.notEqual(testUrl.pathname, developmentUrl.pathname); assert.match(testUrl.pathname, /^\/[a-z][a-z0-9_]*_test$/);
const isIntegration = mode === 'integration' || mode === 'integration-schema';
const integrationFiles = mode === 'integration-schema' ? ['test/tasks-schema.integration.ts'] : ['test/tasks-schema.integration.ts', 'test/tasks-migration.integration.ts',
  'test/files-migration.integration.ts', 'test/database.integration.ts'];
const plans = {
  format: { args: [prisma, 'format'], cwd: api, env: schemaEnv },
  validate: { args: [prisma, 'validate'], cwd: api, env: schemaEnv },
  diff: { args: [prisma, 'migrate', 'diff', '--from-schema', resolve(directory, 'schema-before.prisma'),
    '--to-schema', resolve(api, 'prisma/schema.prisma'), '--script'], cwd: api, env: schemaEnv },
  'diff-test': { args: [prisma, 'migrate', 'diff', '--from-config-datasource', '--to-schema',
    resolve(api, 'prisma/schema.prisma'), '--exit-code'], cwd: api, env: { ...env, DATABASE_URL: testUrl.toString() } },
  generate: { args: [prisma, 'generate'], cwd: api, env: schemaEnv },
  typecheck: { args: [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', 'apps/api/tsconfig.json', '--noEmit'], cwd: root, env },
  lint: { args: [resolve(root, 'node_modules/eslint/bin/eslint.js'), 'apps/api/test/tasks-schema.integration.ts',
    'apps/api/test/tasks-migration.integration.ts', 'apps/api/test/fixtures/task-schema.ts',
    'apps/api/test/database.integration.ts', 'apps/api/test/files-migration.integration.ts',
    'docs/verification/evidence/M0-04/step02/*.mjs'], cwd: root, env },
};
function redact(value) {
  let text = String(value ?? '');
  for (const [key, secret] of Object.entries(env)) {
    if (/SECRET|PASSWORD|DATABASE_URL|TOKEN/i.test(key) && secret?.length >= 8) text = text.replaceAll(secret, '[REDACTED]');
  }
  return text;
}
function run(plan) {
  return spawnSync(process.execPath, plan.args, { cwd: plan.cwd, env: plan.env, encoding: 'utf8', windowsHide: true, timeout: 180_000 });
}
let result; let prefix = '';
if (isIntegration) {
  const prepare = run({ args: [require.resolve('tsx/cli'), '--eval',
    "const {readDatabaseEnvironment,assertSafeTestDatabase}=require('./scripts/database-env.ts'); const {prepareTestDatabase,runPrisma}=require('./scripts/database.ts'); (async()=>{const env=readDatabaseEnvironment();const safe=assertSafeTestDatabase(env.DATABASE_URL,env.TEST_DATABASE_URL);await prepareTestDatabase(env);runPrisma(['migrate','deploy'],{...env,DATABASE_URL:safe.testUrl});})().catch(()=>{console.error('隔离测试库准备失败');process.exitCode=1;});"], cwd: api, env });
  prefix = redact(prepare.stdout) + redact(prepare.stderr);
  if (prepare.status !== 0 || prepare.error) result = prepare;
  else {
    const dev = new URL(env.DATABASE_URL); const testing = new URL(env.TEST_DATABASE_URL);
    assert.notEqual(dev.pathname, testing.pathname); assert.match(testing.pathname, /^\/[a-z][a-z0-9_]*_test$/);
    result = run({ args: [resolve(require.resolve('vitest/package.json'), '../vitest.mjs'), 'run',
      '--config', 'vitest.integration.config.mts', ...integrationFiles, ...process.argv.slice(4)], cwd: api,
    env: { ...env, NODE_ENV: 'test', DATABASE_URL: testing.toString(), DEVELOPMENT_DATABASE_URL: dev.toString(), LOG_LEVEL: 'silent' } });
  }
} else {
  assert.ok(Object.hasOwn(plans, mode), '未知检查组'); result = run(plans[mode]);
}
mkdirSync(directory, { recursive: true });
const log = prefix + redact(result.stdout) + redact(result.stderr);
writeFileSync(resolve(directory, `${mode}-${attempt}.txt`), log);
const report = { checkedAt: new Date().toISOString(), mode, attempt, node: process.version,
  exitCode: result.status, spawnError: result.error?.code ?? null, integrationFiles: isIntegration ? integrationFiles : undefined };
writeFileSync(resolve(directory, `${mode}-${attempt}.json`), JSON.stringify(report, null, 2) + '\n');
console.log(log.slice(-6500)); console.log(JSON.stringify(report));
if (result.status !== 0 || result.error) process.exitCode = 1;
