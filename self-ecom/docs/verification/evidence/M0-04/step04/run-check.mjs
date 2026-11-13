// 作用：执行步骤4前端定向检查，每次保留独立结果，不覆盖失败或旧步骤证据。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
const root = process.cwd(); const directory = resolve(root, 'docs/verification/evidence/M0-04/step04');
const env = { ...parseEnv(readFileSync('.env', 'utf8')), ...process.env };
const mode = process.argv[2]; const label = process.argv[3] ?? 'attempt1'; assert.match(label, /^[a-z0-9-]+$/);
assert.ok(!existsSync(resolve(directory, `${mode}-${label}.json`)), '不能覆盖已有检查标签');
const tsc = resolve(root, 'node_modules/typescript/bin/tsc');
const plans = {
  'admin-type': { args: [tsc, '-p', 'apps/admin-web/tsconfig.json', '--noEmit'] },
  'store-type': { args: [tsc, '-p', 'apps/store-web/tsconfig.json', '--noEmit'] },
  'admin-test': { args: ['--test', 'apps/admin-web/test/settings.test.mjs', 'apps/admin-web/test/employee-query.test.mjs', 'apps/admin-web/test/auth-controller.test.mjs'] },
  'store-test': { args: ['--test', 'apps/store-web/test/auth-controller.test.mjs'] },
  lint: { args: [resolve(root, 'node_modules/eslint/bin/eslint.js'), 'apps/admin-web/src/settings', 'apps/admin-web/src/pages/StoreSettingsPage.tsx',
    'apps/admin-web/src/pages/SettingsHistoryPage.tsx', 'apps/admin-web/src/pages/SettingsVersionPage.tsx', 'apps/admin-web/src/app',
    'apps/admin-web/src/services/api.ts', 'apps/admin-web/src/employees/query-controller.ts', 'apps/admin-web/test/settings.test.mjs',
    'apps/store-web/src/contact', 'apps/store-web/src/app/AppLayout.tsx', 'apps/store-web/src/services/api.ts',
    'docs/verification/evidence/M0-04/step04/*.mjs', ...(existsSync('apps/admin-web/test/verify-settings-browser.mjs') ? ['apps/admin-web/test/verify-settings-browser.mjs'] : [])] },
  'api-build': { args: [tsc, '-p', 'apps/api/tsconfig.build.json'] },
  'admin-build': { args: [resolve(root, 'apps/admin-web/node_modules/vite/bin/vite.js'), 'build'], cwd: resolve(root, 'apps/admin-web') },
  'store-build': { args: [resolve(root, 'apps/store-web/node_modules/vite/bin/vite.js'), 'build'], cwd: resolve(root, 'apps/store-web') },
  browser: { args: ['apps/admin-web/test/verify-settings-browser.mjs'] },
};
assert.ok(Object.hasOwn(plans, mode)); const plan = plans[mode];
const result = spawnSync(process.execPath, plan.args, { cwd: plan.cwd ?? root,
  env: mode === 'browser' ? { ...env, VERIFICATION_OUTPUT_DIR: `output/playwright/M0-04-step04/${label}` } : env,
  encoding: 'utf8', windowsHide: true, timeout: mode === 'browser' ? 240_000 : 120_000 });
let output = String(result.stdout ?? '') + String(result.stderr ?? '');
for (const [key, secret] of Object.entries(env)) if (/SECRET|PASSWORD|DATABASE_URL|TOKEN/i.test(key) && secret?.length >= 8) output = output.replaceAll(secret, '[REDACTED]');
writeFileSync(resolve(directory, `${mode}-${label}.txt`), output);
const report = { checkedAt: new Date().toISOString(), mode, label, exitCode: result.status, spawnError: result.error?.code ?? null };
writeFileSync(resolve(directory, `${mode}-${label}.json`), JSON.stringify(report, null, 2) + '\n');
console.log(output.slice(-5000)); console.log(JSON.stringify(report));
if (result.status !== 0 || result.error) process.exitCode = 1;
