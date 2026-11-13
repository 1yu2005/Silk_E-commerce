// 作用：固定本轮验收前的文件和Git状态，不保存真实配置内容。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const directory = 'docs/verification/evidence/M0-04/step11';
assert.ok(!existsSync(directory + '/baseline.json'));
function git(args) { const result = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { encoding: 'utf8', windowsHide: true }); assert.equal(result.status, 0); return result.stdout.trim(); }
const paths = git(['ls-files', '--cached', '--others', '--exclude-standard', '--', '.']).split(/\r?\n/).filter(path => path && !path.startsWith(directory + '/'));
paths.push('.env', '../.github/workflows/self-ecom-contracts.yml');
const files = [...new Set(paths)].filter(path => existsSync(path)).map(path => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }));
writeFileSync(directory + '/baseline.json', JSON.stringify({ capturedAt: new Date().toISOString(), head: git(['rev-parse', 'HEAD']), branch: git(['branch', '--show-current']),
  staged: git(['diff', '--cached', '--name-only']), files }, null, 2) + '\n');
console.log(JSON.stringify({ files: files.length, stagedEmpty: git(['diff', '--cached', '--name-only']) === '' }));
