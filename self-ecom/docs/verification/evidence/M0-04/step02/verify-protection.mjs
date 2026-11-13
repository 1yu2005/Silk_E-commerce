// 作用：核对本步授权差异、原文件摘要和已应用0004，保留第一步证据及无关工作区内容。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const directory = 'docs/verification/evidence/M0-04/step02';
const baseline = JSON.parse(readFileSync(`${directory}/baseline.json`, 'utf8'));
const checksum = path => createHash('sha256').update(readFileSync(path)).digest('hex');
function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0); return result.stdout.trim();
}
const files = baseline.files.map(row => ({ path: row.path, unchanged: checksum(row.path) === row.sha256,
  authorizedSchemaChange: row.path === 'apps/api/prisma/schema.prisma' }));
assert.ok(files.every(row => row.unchanged || row.authorizedSchemaChange));
assert.equal(checksum(`${directory}/schema-before.prisma`), baseline.files.find(row => row.path === 'apps/api/prisma/schema.prisma').sha256);
const report = JSON.parse(readFileSync(`${directory}/development-migration.json`, 'utf8'));
const migration = 'apps/api/prisma/migrations/0004_store_settings_tasks_deadlines/migration.sql';
assert.equal(checksum(migration), report.files.find(row => row.name === '0004_store_settings_tasks_deadlines').checksum);
const tracked = git(['diff', '--name-only', '--relative', '--', '.']).split(/\r?\n/).filter(Boolean).sort();
assert.deepEqual(tracked, ['apps/api/prisma/schema.prisma', 'apps/api/test/database.integration.ts', 'apps/api/test/files-migration.integration.ts']);
assert.equal(git(['diff', '--cached', '--name-only']), '');
assert.equal(git(['rev-parse', 'HEAD']), baseline.head); git(['diff', '--check']);
const newPaths = git(['ls-files', '--others', '--exclude-standard', '--', '.']).split(/\r?\n/).filter(Boolean);
const whitespace = newPaths.filter(path => /\.(ts|mjs|prisma|md|sql)$/.test(path)).map(path => ({ path,
  valid: readFileSync(path, 'utf8').split(/\r?\n/).every(line => !/[\t ]+$/.test(line)) }));
assert.ok(whitespace.every(row => row.valid));
const sources = [...tracked, ...newPaths.filter(path => /\.(ts|mjs|prisma|sql)$/.test(path) && !path.includes('/step01/'))];
const result = { checkedAt: new Date().toISOString(), protectedFiles: files, trackedChanges: tracked,
  stagedEmpty: true, headUnchanged: true, appliedMigrationUnchanged: true, gitDiffCheckPassed: true,
  newTextWhitespace: whitespace, sourceSha256: sources.map(path => ({ path, sha256: checksum(path) })),
  status: git(['status', '--short', '--untracked-files=all']) };
writeFileSync(`${directory}/protection.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ protectedFiles: files.length, unchanged: files.filter(row => row.unchanged).length,
  authorizedSchemaChange: true, appliedMigrationUnchanged: true, trackedChanges: tracked, stagedEmpty: true, gitDiffCheckPassed: true }));
