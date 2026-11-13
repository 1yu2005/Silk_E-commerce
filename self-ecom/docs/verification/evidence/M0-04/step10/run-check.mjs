// 作用：仅运行步骤10相关检查，保存独立退出码和脱敏日志，不覆盖历史记录。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
const directory = 'docs/verification/evidence/M0-04/step10'; const mode = process.argv[2]; const label = process.argv[3] ?? 'attempt1';
assert.match(label, /^[a-z0-9-]+$/); assert.ok(!existsSync(directory + '/' + mode + '-' + label + '.json'), '不能覆盖既有检查');
const env = { ...parseEnv(readFileSync('.env', 'utf8')), ...process.env }; const require = createRequire(resolve('apps/api/package.json'));
const tsc = resolve('node_modules/typescript/bin/tsc');
const plans = {
  'admin-types': [tsc, '-p', 'apps/admin-web/tsconfig.json', '--noEmit'],
  'api-types': [tsc, '-p', 'apps/api/tsconfig.json', '--noEmit'],
  'acceptance-build': [tsc, '-p', 'apps/api/tsconfig.acceptance.json'],
  'admin-build': [resolve('apps/admin-web/node_modules/vite/bin/vite.js'), 'build', 'apps/admin-web'],
  unit: ['--test', ...process.argv.slice(4), 'apps/admin-web/test/tasks.test.mjs', 'apps/admin-web/test/employee-query.test.mjs', 'apps/admin-web/test/employee-management.test.mjs', 'apps/admin-web/test/settings.test.mjs'],
  contracts: [resolve('scripts/check-contracts.mjs')],
  lint: [resolve('node_modules/eslint/bin/eslint.js'), 'apps/admin-web/src/tasks', 'apps/admin-web/src/pages/TaskListPage.tsx', 'apps/admin-web/src/pages/TaskDetailPage.tsx',
    'apps/admin-web/src/services/api.ts', 'apps/admin-web/src/app/AppLayout.tsx', 'apps/admin-web/src/app/router.tsx', 'apps/admin-web/test/tasks.test.mjs',
    'apps/api/test/acceptance', 'apps/api/scripts/task-acceptance.mjs', 'apps/admin-web/scripts/tasks-acceptance.mjs', directory + '/*.mjs', ...(existsSync('apps/admin-web/test/verify-tasks-browser.mjs') ? ['apps/admin-web/test/verify-tasks-browser.mjs'] : [])],
  browser: ['apps/admin-web/test/verify-tasks-browser.mjs'],
  'acceptance-cli': ['apps/api/scripts/task-acceptance.mjs', '--fixtures', '--check'],
  'acceptance-page-cli': ['apps/admin-web/scripts/tasks-acceptance.mjs', '--check'],
  'access-regression': [resolve(require.resolve('vitest/package.json'), '../vitest.mjs'), 'run', '--config', resolve('apps/api/vitest.integration.config.mts'), resolve('apps/api/test/task-access.integration.ts')],
};
assert.ok(Object.hasOwn(plans, mode));
const result = spawnSync(process.execPath, plans[mode], { env: { ...env, NODE_ENV: 'test', LOG_LEVEL: 'silent', VERIFICATION_OUTPUT_DIR: 'output/playwright/M0-04-step10/' + label },
  encoding: 'utf8', windowsHide: true, timeout: mode === 'browser' ? 240000 : 180000 });
let output = String(result.stdout ?? '') + String(result.stderr ?? '');
for (const [key, secret] of Object.entries(env)) if (/SECRET|PASSWORD|DATABASE_URL|TOKEN/i.test(key) && secret?.length >= 8) output = output.replaceAll(secret, '[REDACTED]');
writeFileSync(directory + '/' + mode + '-' + label + '.txt', output);
const report = { checkedAt: new Date().toISOString(), mode, label, exitCode: result.status, spawnError: result.error?.code ?? null };
writeFileSync(directory + '/' + mode + '-' + label + '.json', JSON.stringify(report, null, 2) + '\n');
console.log(output.slice(-8000)); console.log(JSON.stringify(report)); if (result.status !== 0 || result.error) process.exitCode = 1;
