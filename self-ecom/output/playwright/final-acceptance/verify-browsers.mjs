// 文件作用：逐个复验已有六组浏览器场景，将本轮证据另存并保留历史截图和记录。
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
const root = process.cwd(); const output = path.join(root, 'output/playwright/final-acceptance');
const secrets = Object.entries(parseEnv(readFileSync('.env', 'utf8')))
  .filter(([key, value]) => /SECRET|PASSWORD|DATABASE_URL/.test(key) && value.length > 4).map(([, value]) => value);
const redact = value => secrets.reduce((text, secret) => text.replaceAll(secret, '[REDACTED]'), value);
const scripts = [
  ['admin-auth', 'apps/admin-web/test/verify-browser.mjs'],
  ['store-auth', 'apps/store-web/test/verify-browser.mjs'],
  ['store-profile', 'apps/store-web/test/verify-profile-browser.mjs'],
  ['employee-queries', 'apps/admin-web/test/verify-employees-browser.mjs'],
  ['employee-create', 'apps/admin-web/test/verify-employee-create-browser.mjs'],
  ['employee-management', 'apps/admin-web/test/verify-employee-management-browser.mjs'],
];
const selected = process.argv.slice(2);
const results = JSON.parse(readFileSync(path.join(output, 'browser-checks.json'), 'utf8'));
try {
  for (const [name, script] of scripts) {
    if (selected.length && !selected.includes(name)) continue;
    const artifacts = path.join(output, name); mkdirSync(artifacts, { recursive: true });
    console.log(JSON.stringify({ suite: name, status: 'running' }));
    const child = spawnSync(process.execPath, ['apps/api/node_modules/tsx/dist/cli.mjs', script], { cwd: root,
      env: { ...process.env, VERIFICATION_OUTPUT_DIR: artifacts }, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    const log = redact((child.stdout ?? '') + (child.stderr ?? ''));
    writeFileSync(path.join(artifacts, 'runner.log'), log);
    const record = { suite: name, status: child.status }; const index = results.findIndex(item => item.suite === name);
    if (index >= 0) results[index] = record; else results.push(record);
    console.log(JSON.stringify(record));
    if (child.error || child.status !== 0) { console.log(log.slice(-9000)); throw new Error(`${name}验收失败`); }
    console.log(log.split('\n').filter(line => /"status":"passed"/.test(line)).slice(-2).join('\n'));
  }
} finally { writeFileSync(path.join(output, 'browser-checks.json'), JSON.stringify(results, null, 2) + '\n'); }
