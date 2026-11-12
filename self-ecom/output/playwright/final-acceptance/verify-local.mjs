// 文件作用：用固定 Node 和临时 pnpm 包装运行本轮检查，保存脱敏日志并精确清理包装文件。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';

const root = process.cwd();
const output = path.join(root, 'output/playwright/final-acceptance');
const pnpm = 'C:/Users/20334/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pnpm/bin/pnpm.mjs';
const wrapperDir = path.join(tmpdir(), `self-ecom-final-pnpm-${randomUUID()}`);
const wrapper = path.join(wrapperDir, 'pnpm.cmd');
const contents = `@echo off\r\n"${process.execPath}" "${pnpm}" %*\r\nexit /b %ERRORLEVEL%\r\n`;
const secrets = Object.entries(parseEnv(readFileSync(path.join(root, '.env'), 'utf8')))
  .filter(([key, value]) => /SECRET|PASSWORD|DATABASE_URL/.test(key) && value.length > 4).map(([, value]) => value);
const redact = value => secrets.reduce((text, secret) => text.replaceAll(secret, '[REDACTED]'), value);
const checksPath = path.join(output, 'local-checks.json');
const results = existsSync(checksPath) ? JSON.parse(readFileSync(checksPath, 'utf8')).results : [];
mkdirSync(wrapperDir); writeFileSync(wrapper, contents);
const env = { ...process.env, PATH: `${wrapperDir};${path.dirname(process.execPath)};${process.env.PATH}`, TURBO_FORCE: 'true' };
try {
  for (const command of process.argv.slice(2)) {
    const started = Date.now();
    const before = command === 'openapi:export' && existsSync('docs/openapi.json') ? createHash('sha256').update(readFileSync('docs/openapi.json')).digest('hex') : undefined;
    console.log(JSON.stringify({ command, status: 'running', node: process.version }));
    const child = spawnSync(process.execPath, [pnpm, command], { cwd: root, env, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
    const log = redact((child.stdout ?? '') + (child.stderr ?? ''));
    writeFileSync(path.join(output, `${command.replaceAll(':', '-')}.log`), log);
    const record = { command, status: child.status, durationMs: Date.now() - started, ...(before ? { before } : {}) };
    const index = results.findIndex(item => item.command === command);
    if (index >= 0) results[index] = record; else results.push(record);
    console.log(JSON.stringify(record));
    if (child.error || child.status !== 0) { console.log(log.slice(-11000)); throw new Error(`${command}失败`); }
    console.log(log.replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter(line => /Test Files|Tests |Tasks:|Time:|passed|openapi/i.test(line)).slice(-16).join('\n'));
  }
} finally {
  writeFileSync(path.join(output, 'local-checks.json'), JSON.stringify({ node: process.version, results }, null, 2) + '\n');
  assert.equal(path.dirname(wrapperDir), tmpdir()); assert.ok(path.basename(wrapperDir).startsWith('self-ecom-final-pnpm-'));
  assert.equal(lstatSync(wrapperDir).isSymbolicLink(), false); assert.deepEqual(readdirSync(wrapperDir), ['pnpm.cmd']);
  assert.equal(readFileSync(wrapper, 'utf8'), contents); unlinkSync(wrapper); rmdirSync(wrapperDir);
  writeFileSync(checksPath, JSON.stringify({ node: process.version, results, temporaryPnpmWrapperRemoved: true }, null, 2) + '\n');
  console.log(JSON.stringify({ temporaryPnpmWrapperRemoved: true }));
}
