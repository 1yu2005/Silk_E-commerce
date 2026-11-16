// 作用：纯单元验证运维拒绝边界、全列快照及失败后的原状态恢复；不启动Docker或数据库。
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { assertEmptyDatabase, parseArguments, withQuiescedSource } from './module15-ops.mjs';
import { captureDatabase, tableCursorSql } from './module15-ops-snapshot.mjs';
import { assertNewProject, assertSameTree, defaultDockerExecutable, helperProgram, localTree, noLinkPath, readConfig, safeEnvironment, secretRedactor, validRelative } from './module15-ops-runtime.mjs';

const folder = path.resolve('output/testing/M4-15', 'ops-unit-' + randomUUID()); mkdirSync(folder, { recursive: true });
const configFile = path.join(folder, '.env.restore');
writeFileSync(configFile, ['POSTGRES_DB=unit_restore', 'POSTGRES_USER=unit_user', 'POSTGRES_PASSWORD=SyntheticPrivateValue123', 'JWT_SECRET=' + 'x'.repeat(48), 'DB_HOST_PORT=25432', 'API_HOST_PORT=23000', 'ADMIN_HOST_PORT=28080', 'STORE_HOST_PORT=28081'].join('\n'));

test('selected restore configuration overrides polluted shell and never loads a root environment', () => {
  const config = readConfig(configFile, 'unit-restore-check', { restore: true });
  assert.equal(new URL(config.hostUrl).pathname, '/unit_restore'); assert.equal(new URL(config.internalUrl).hostname, 'db');
  assert.equal(config.env.API_HOST_PORT, '23000'); assert.equal(config.values.COMPOSE_CORS_ORIGINS, 'http://localhost:28080,http://localhost:28081');
  const clean = safeEnvironment({}, { PATH: 'system-path', POSTGRES_DB: 'original_database', DATABASE_URL: 'original-connection', COMPOSE_FILE: 'wrong-compose', JWT_SECRET: 'private-original-value' });
  assert.deepEqual(clean, { PATH: 'system-path' });
});
test('restore config rejects source project, unknown database and inherited missing target ports', () => {
  assert.throws(() => readConfig(configFile, 'self-ecom', { restore: true }), /RESTORE_PROJECT_REQUIRED/);
  const file = path.join(folder, '.env.incomplete'); writeFileSync(file, 'POSTGRES_DB=unit_restore\nPOSTGRES_USER=unit\nPOSTGRES_PASSWORD=synthetic\nJWT_SECRET=' + 'x'.repeat(48));
  assert.throws(() => readConfig(file, 'unit-restore-check', { restore: true }), /RESTORE_PORT_REQUIRED/);
});

test('Docker defaults use the system CLI on Linux and the installed desktop path only on Windows', () => {
  assert.equal(defaultDockerExecutable('linux', 'synthetic-appdata'), 'docker');
  assert.equal(defaultDockerExecutable('darwin', 'synthetic-appdata'), 'docker');
  assert.equal(defaultDockerExecutable('win32', 'synthetic-appdata'), path.join('synthetic-appdata', 'Programs/DockerDesktop/resources/bin/docker.exe'));
});
test('CLI refuses duplicate arguments, backup dynamic and unconfirmed restore', () => {
  assert.equal(parseArguments(['backup', '--', '--env-file', 'selected', '--project', 'unit-source', '--output', 'backups']).action, 'backup');
  assert.throws(() => parseArguments(['backup', '--env-file', 'x', '--project', 'x', '--output', 'x', '--dynamic']), /BACKUP_ARGUMENT_INVALID/);
  assert.throws(() => parseArguments(['restore', '--env-file', 'x', '--project', 'x', '--backup', 'x']), /RESTORE_CONFIRMATION_REQUIRED/);
  assert.throws(() => parseArguments(['backup', '--env-file', 'x', '--env-file', 'y']), /DUPLICATE_ARGUMENT/);
  assert.throws(() => parseArguments(['backup', '--force', 'yes']), /ARGUMENT_INVALID/);
});
test('secret redaction removes both selected values and alternate postgres URLs', () => {
  const redact = secretRedactor({ POSTGRES_PASSWORD: 'synthetic-hidden', JWT_SECRET: 'another-hidden' });
  assert.equal(redact('synthetic-hidden another-hidden postgresql://user:other@db/example'), '[REDACTED] [REDACTED] [REDACTED_DATABASE_URL]');
});
test('file keys reject traversal, Windows aliases, controls and links to unknown roots', () => {
  for (const invalid of ['../secret', 'objects/../secret', 'C:/secret', '/secret', 'objects\\secret', 'objects/a\nb', 'objects/CON.png', 'objects/name.', 'objects/name ']) assert.equal(validRelative(invalid), false);
  assert.equal(validRelative('objects/123.png'), true); assert.throws(() => noLinkPath(path.resolve('..', 'other')), /PATH_OUTSIDE_WORKSPACE/);
});
test('full file digest detects changed bytes, missing paths and includes zero byte files', async () => {
  const root = path.join(folder, 'files'); mkdirSync(path.join(root, 'objects'), { recursive: true });
  writeFileSync(path.join(root, 'objects', 'one.png'), 'first'); writeFileSync(path.join(root, 'objects', 'empty.png'), '');
  const before = await localTree(root); assert.equal(before.files.length, 2); assert.equal(before.files[0].size, '0');
  writeFileSync(path.join(root, 'objects', 'one.png'), 'second');
  assert.throws(() => assertSameTree(before, { ...before, files: [] }), /UPLOAD_CONTENT_MISMATCH/);
  assert.throws(() => assertSameTree(before, { ...before, files: before.files.map(row => row.path.endsWith('one.png') ? { ...row, sha256: 'changed' } : row) }), /UPLOAD_CONTENT_MISMATCH/);
  assert.notEqual((await localTree(root)).files[1].sha256, before.files[1].sha256);
});
test('retained helper JavaScript is syntactically valid and never starts the API module', () => {
  assert.doesNotThrow(() => new Function(helperProgram)); assert.ok(!helperProgram.includes('dist/main')); assert.ok(!helperProgram.includes('unlink')); assert.ok(!helperProgram.includes('rmSync'));
});
test('new-project guard refuses a preexisting unlabelled exact volume name', async () => {
  const runtime = { config: { project: 'unit-restore-check' }, run: async args => args.includes('{{.Name}}') && args[0] === 'volume' ? 'unit-restore-check_db_data' : '' };
  await assert.rejects(assertNewProject(runtime), /RESTORE_VOLUME_NAME_ALREADY_EXISTS/);
});
test('nonempty restore database fails before restore commands and unknown clients also fail', async () => {
  await assert.rejects(assertEmptyDatabase({ query: async () => ({ rows: [{ oid: 100 }] }) }), /RESTORE_DATABASE_NOT_EMPTY/);
  await assert.rejects(assertEmptyDatabase({ query: async sql => ({ rows: sql.includes('pg_stat_activity') ? [{ pid: 99 }] : [] }) }), /UNKNOWN_DATABASE_CLIENTS/);
});

function fakeSource({ apiRunning = true, resumeFailure = false } = {}) {
  const containers = Object.fromEntries(['db', 'api', 'admin-web', 'store-web'].map(service => [service, { Id: service, State: { Running: service === 'api' ? apiRunning : true, Health: { Status: 'healthy' } } }]));
  const running = new Map(Object.values(containers).map(row => [row.Id, row.State.Running])), calls = [];
  const runtime = { report: {}, interrupted: false, inspect: async id => ({ State: { Running: running.get(id), Health: { Status: 'healthy' }, OOMKilled: false, ExitCode: 0 } }), run: async args => {
    calls.push(args); if (args[0] === 'stop') running.set(args.at(-1), false);
    if (args[0] === 'start') { if (resumeFailure && args[1] === 'api') throw Error('synthetic start failure'); running.set(args[1], true); }
    return '';
  } };
  return { runtime, containers, calls, running };
}
test('backup failure resumes exactly the originally running source IDs and never touches DB', async () => {
  const fixture = fakeSource();
  await assert.rejects(withQuiescedSource(fixture.runtime, fixture.containers, async () => { throw Error('synthetic backup failure'); }), /synthetic backup failure/);
  assert.deepEqual(fixture.calls.filter(row => row[0] === 'start').map(row => row[1]), ['api', 'admin-web', 'store-web']);
  assert.ok(!fixture.calls.some(row => row.includes('db'))); assert.equal(fixture.runtime.report.originalStatesRestored, true);
});
test('an originally stopped API stays stopped when backup fails', async () => {
  const fixture = fakeSource({ apiRunning: false });
  await assert.rejects(withQuiescedSource(fixture.runtime, fixture.containers, async () => { throw Error('failure'); }));
  assert.equal(fixture.running.get('api'), false); assert.ok(!fixture.calls.some(row => row.includes('api')));
});
test('source resume failure fails overall while preserving the first diagnostic', async () => {
  const fixture = fakeSource({ resumeFailure: true });
  await assert.rejects(withQuiescedSource(fixture.runtime, fixture.containers, async () => { throw Error('failure'); }), /SOURCE_STATE_NOT_RESTORED/);
  assert.equal(fixture.runtime.report.originalStatesRestored, false); assert.equal(fixture.runtime.report.primaryFailure, 'OPERATION_FAILED');
});

function fakeDatabase({ largeObjects = '0' } = {}) {
  const calls = [], values = ['["row",900719925474099312345,null,"2026-11-15T00:00:00+00:00"]', '["row",900719925474099312345,null,"2026-11-15T00:00:00+00:00"]']; let fetched = false;
  const client = { query: async sql => {
    calls.push(sql);
    if (sql.includes('pg_control_system')) return { rows: [{ database: 'unit_restore', version: '160006', cluster: 'different-cluster' }] };
    if (sql.includes('pg_largeobject_metadata')) return { rows: [{ count: largeObjects }] };
    if (sql.includes('pg_export_snapshot')) return { rows: [{ snapshot: '00000001-1-1' }] };
    if (sql.includes('pg_encoding_to_char')) return { rows: [{ encoding: 'UTF8', collate: 'C', ctype: 'C', provider: 'c', icu: null }] };
    if (sql.includes("c.relkind IN ('r','p','v','m','S','f')")) return { rows: [{ schema: 'public', name: 'scheduler_run', kind: 'r', persistence: 'p' }] };
    if (sql.includes('FROM pg_attribute')) return { rows: [{ name: 'id', type: 'uuid' }, { name: 'updated_at', type: 'timestamp with time zone' }] };
    if (sql.startsWith('FETCH')) { if (fetched) return { rows: [] }; fetched = true; return { rows: values.map(canonical_row => ({ canonical_row })) }; }
    return { rows: [] };
  } };
  return { client, calls, values };
}
test('canonical cursor quotes identifiers and includes timestamp columns with byte sorting', () => {
  const sql = tableCursorSql('custom"schema', 'table', [{ name: 'id' }, { name: 'updated_at' }]);
  assert.ok(sql.includes('"custom""schema"."table"')); assert.ok(sql.includes('"updated_at"')); assert.ok(sql.includes('ORDER BY canonical_row COLLATE "C"'));
});
test('full technical-table snapshot hashes duplicate rows and exact large numeric text without rounding', async () => {
  const fixture = fakeDatabase(), result = await captureDatabase(fixture.client);
  const expected = createHash('sha256'); for (const row of fixture.values) { const bytes = Buffer.from(row); expected.update(String(bytes.length) + ':'); expected.update(bytes); expected.update('\n'); }
  assert.equal(result.summary.tables[0].name, 'scheduler_run'); assert.equal(result.summary.tables[0].count, '2'); assert.equal(result.summary.tables[0].sha256, expected.digest('hex'));
  assert.ok(fixture.calls[0].endsWith('READ ONLY')); assert.equal(fixture.calls.at(-1), 'COMMIT'); assert.ok(fixture.calls.includes("SET LOCAL timezone='UTC'"));
  assert.ok(!fixture.calls.some(sql => /^(UPDATE|INSERT|DELETE|ALTER|CREATE TABLE|TRUNCATE)\b/.test(sql)));
});
test('exported snapshot stays open for dump and unsupported large objects roll back', async () => {
  const fixture = fakeDatabase(); const result = await captureDatabase(fixture.client, { exportSnapshot: true, keepTransaction: true });
  assert.equal(result.snapshot, '00000001-1-1'); assert.ok(!fixture.calls.includes('COMMIT'));
  const unsupported = fakeDatabase({ largeObjects: '1' }); await assert.rejects(captureDatabase(unsupported.client), /UNSUPPORTED_LARGE_OBJECTS/); assert.equal(unsupported.calls.at(-1), 'ROLLBACK');
});
