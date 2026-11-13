// 作用：保存步骤4开始前的文件摘要和Git状态，不读取输出真实配置值。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const directory = 'docs/verification/evidence/M0-04/step04';
assert.ok(!existsSync(`${directory}/baseline.json`), '不得覆盖已有基线');
function git(args) {
  const result = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0); return result.stdout.trim();
}
const paths = git(['ls-files', '--cached', '--others', '--exclude-standard', '--', '.']).split(/\r?\n/)
  .filter(path => path && !path.startsWith(directory + '/'));
paths.push('.env', '../.github/workflows/self-ecom-contracts.yml');
const files = [...new Set(paths)].filter(path => existsSync(path)).map(path => ({ path,
  sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }));
writeFileSync(`${directory}/baseline.json`, JSON.stringify({ capturedAt: new Date().toISOString(),
  head: git(['rev-parse', 'HEAD']), status: git(['status', '--short', '--untracked-files=all']),
  staged: git(['diff', '--cached', '--name-only']), files }, null, 2) + '\n');
console.log(JSON.stringify({ capturedFiles: files.length, stagedEmpty: git(['diff', '--cached', '--name-only']) === '' }));
