// 作用：收尾时执行真实工程入口，保存本轮脱敏日志和退出码；数据库测试单独串行运行。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

const root = resolve('.'); const output = resolve('docs/verification/evidence/M0-03/final');
mkdirSync(output, { recursive: true });
const configured = parseEnv(readFileSync('.env', 'utf8'));
const secrets = Object.entries(configured).filter(([key, value]) => /SECRET|PASSWORD|DATABASE_URL|TOKEN/i.test(key) && value.length >= 8);
const redact = text => secrets.reduce((text, [, secret]) => text.replaceAll(secret, '[REDACTED]'), text);
const group = process.argv[2]; const pnpm = process.env.PNPM_CLI_PATH;
const suffix = process.argv[3] ? `-${process.argv[3]}` : '';
assert.match(suffix, /^(?:-[a-z0-9-]+)?$/);
assert.ok(pnpm, '通过PNPM_CLI_PATH指定本机pnpm JS入口，不修改已有node_modules');
const groups = {
  engineering: ['lint', 'typecheck', 'test', 'build'],
  integration: ['test:integration'],
  contracts: ['contracts:check'],
  generation: ['openapi:export', 'api-client:generate'],
};
assert.ok(groups[group], '检查组不存在');
if (group === 'engineering' && !existsSync(`${output}/protected-before.json`)) {
  const protectedPaths = ['.env', 'apps/api/prisma/schema.prisma',
    ...readdirSync('apps/api/prisma/migrations', { withFileTypes: true }).filter(entry => entry.isDirectory())
      .map(entry => `apps/api/prisma/migrations/${entry.name}/migration.sql`)];
  writeFileSync(`${output}/protected-before.json`, JSON.stringify(protectedPaths.map(path => ({ path,
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex') })), null, 2) + '\n');
}
const results = [];
for (const command of groups[group]) {
  console.log(JSON.stringify({ command: `pnpm ${command}`, status: 'running' }));
  const started = Date.now();
  const result = spawnSync(process.execPath, [pnpm, 'run', command], { cwd: root, env: process.env,
    encoding: 'utf8', windowsHide: true, timeout: 900000, maxBuffer: 32 * 1024 * 1024 });
  const log = redact(String(result.stdout ?? '') + String(result.stderr ?? ''));
  writeFileSync(`${output}/${command.replaceAll(':', '-')}${suffix}.txt`, log);
  const item = { command: `pnpm ${command}`, exitCode: result.status, spawnError: result.error?.code ?? null,
    durationSeconds: (Date.now() - started) / 1000, timestamp: new Date().toISOString() };
  results.push(item); writeFileSync(`${output}/${group}${suffix}.json`, JSON.stringify(results, null, 2) + '\n');
  console.log(log.slice(-3500)); console.log(JSON.stringify(item));
  if (result.status !== 0 || result.error) process.exitCode = 1;
}
