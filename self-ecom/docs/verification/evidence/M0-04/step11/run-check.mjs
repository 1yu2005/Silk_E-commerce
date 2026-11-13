// 作用：直接使用现有依赖执行全工程检查；每个检查保存独立脱敏输出，不命中缓存、不安装依赖。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv, stripVTControlCharacters } from 'node:util';
const directory = 'docs/verification/evidence/M0-04/step11'; const mode = process.argv[2]; const label = process.argv[3] ?? 'attempt1';
assert.match(label, /^[a-z0-9-]+$/); const target = `${directory}/${mode}-${label}.json`; assert.ok(!existsSync(target), '不能覆盖本轮检查证据');
const root = process.cwd(); const require = createRequire(resolve('apps/api/package.json'));
const env = { ...parseEnv(readFileSync('.env', 'utf8')), ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' };
const retained = pathToFileURL(resolve(directory, 'retain-artifacts.mjs')).href;
env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ''} --import=${retained}`.trim();
const redact = output => Object.entries(env).filter(([key, value]) => /SECRET|PASSWORD|DATABASE_URL|TOKEN/.test(key) && value?.length > 5)
  .reduce((text, [, value]) => text.replaceAll(value, '[REDACTED]'), output);
const tsc = resolve('node_modules/typescript/bin/tsc'); const vitest = resolve(require.resolve('vitest/package.json'), '../vitest.mjs');
const packages = ['packages/shared', 'packages/api-client', 'packages/ui', 'apps/api', 'apps/admin-web', 'apps/store-web'];
const nodeTests = folder => readdirSync(folder + '/test').filter(name => name.endsWith('.test.mjs')).map(name => resolve(folder, 'test', name));
const report = { checkedAt: new Date().toISOString(), mode, label, checks: [] };
const run = async (name, args, cwd = root, variables = env) => {
  const log = `${directory}/${mode}-${label}-${name}.txt`;
  console.log(JSON.stringify({ check: name, status: 'running' }));
  const result = await new Promise(resolveResult => {
    const child = spawn(process.execPath, args, { cwd, env: variables, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
    child.once('error', error => resolveResult({ exitCode: null, error: error.code, output }));
    child.once('close', (exitCode, signal) => resolveResult({ exitCode, signal, output }));
  });
  const output = redact(result.output); writeFileSync(log, output);
  const row = { name, exitCode: result.exitCode, signal: result.signal ?? null, error: result.error ?? null, log };
  report.checks.push(row); console.log(stripVTControlCharacters(output).slice(-1500)); console.log(JSON.stringify(row));
  return result.exitCode === 0;
};
if (mode === 'lint') await run('all', [resolve('node_modules/eslint/bin/eslint.js'), 'apps', 'packages', 'scripts', 'infra', directory]);
else if (mode === 'types') {
  for (const folder of packages) await run(folder.replaceAll('/', '-'), [tsc, '-p', folder + '/tsconfig.json', '--noEmit']);
} else if (mode === 'dead-locals') {
  for (const folder of ['apps/api', 'apps/admin-web', 'apps/store-web']) await run(folder.replaceAll('/', '-'),
    [tsc, '-p', folder + (folder === 'apps/api' ? '/tsconfig.build.json' : '/tsconfig.json'), '--noEmit', '--noUnusedLocals', '--noUnusedParameters']);
} else if (mode === 'build' || mode === 'web-build') {
  if (mode === 'build') {
    for (const folder of packages.slice(0, 4)) await run(folder.replaceAll('/', '-'), [tsc, '-p', folder + (folder === 'apps/api' ? '/tsconfig.build.json' : '/tsconfig.json')]);
    await run('acceptance', [tsc, '-p', 'apps/api/tsconfig.acceptance.json']);
  }
  for (const app of ['admin-web', 'store-web']) {
    const output = resolve('output/build/M0-04-step11', label, app); assert.ok(!existsSync(output)); mkdirSync(output, { recursive: true });
    await run(app, [resolve(`apps/${app}/node_modules/vite/bin/vite.js`), 'build', '--outDir', output, '--emptyOutDir', 'false'], resolve('apps/' + app), { ...env, NODE_ENV: 'production' });
  }
} else if (mode === 'unit') {
  for (const folder of ['packages/shared', 'packages/api-client']) await run(folder.replaceAll('/', '-') + '-build', [tsc, '-p', folder + '/tsconfig.json']);
  await run('api', [vitest, 'run', '--config', resolve('apps/api/test/verification/retained.config.mts'), ...process.argv.slice(4)], resolve('apps/api'));
  if (process.argv.length === 4) for (const folder of ['packages/shared', 'packages/api-client', 'apps/admin-web', 'apps/store-web'])
    await run(folder.replaceAll('/', '-'), ['--test', ...nodeTests(folder)]);
} else if (mode === 'contracts') {
  await run('consistency', [resolve('scripts/check-contracts.mjs')]); await run('drift', [resolve('scripts/test-contract-drift.mjs')]);
} else if (mode === 'browser-tasks' || mode === 'browser-settings') {
  const file = mode === 'browser-tasks' ? 'verify-tasks-browser.mjs' : 'verify-settings-browser.mjs';
  await run('all', [resolve('apps/admin-web/test/' + file)], root,
    { ...env, VERIFICATION_OUTPUT_DIR: `output/playwright/M0-04-step11/${mode}-${label}` });
} else if (mode === 'integration') {
  const { randomUUID } = await import('node:crypto'); const { Client } = require('pg');
  const { assertSafeTestDatabase } = require(resolve('apps/api/dist/acceptance/scripts/database-env.js'));
  const safe = assertSafeTestDatabase(env.DATABASE_URL, env.TEST_DATABASE_URL);
  const name = `full_regression_${randomUUID().replaceAll('-', '')}_test`; const url = new URL(safe.testUrl); url.pathname = '/' + name;
  assertSafeTestDatabase(safe.developmentUrl, url.toString()); const adminUrl = new URL(safe.testUrl); adminUrl.pathname = '/postgres';
  const admin = new Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 3000 }); let created = false;
  const variables = { ...env, DATABASE_URL: url.toString(), DEVELOPMENT_DATABASE_URL: safe.developmentUrl, FULL_VERIFICATION_KIND: 'integration' };
  report.database = { name, created: false, removed: false };
  try {
    await admin.connect(); await admin.query(`CREATE DATABASE "${name}" ENCODING 'UTF8' TEMPLATE template0`); created = true; report.database.created = true;
    if (await run('migrate', [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], resolve('apps/api'), variables))
      await run('all', [vitest, 'run', '--config', resolve('apps/api/test/verification/retained.config.mts'), ...process.argv.slice(4)], resolve('apps/api'), variables);
  } finally {
    if (created) { await admin.query(`DROP DATABASE "${name}"`); report.database.removed = true; }
    await admin.end();
  }
} else throw new Error('未知检查组');
report.passed = report.checks.length > 0 && report.checks.every(check => check.exitCode === 0 && !check.error);
writeFileSync(target, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ mode, label, passed: report.passed, checks: report.checks.length }));
if (!report.passed) process.exitCode = 1;
