// 作用：短暂停写一致备份、独立空库空卷恢复及静态/动态验证；所有资源和失败现场保留。
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { module15FreeSubnet } from './module15-docker-network.mjs';
import { captureDatabase, databaseIdentity, OpsError, requireCondition, SNAPSHOT_CANONICAL_VERSION } from './module15-ops-snapshot.mjs';
import { SERVICES, DockerRuntime, assertNewProject, assertSameTree, command, connectedClient, equalJson, existingRealPath, hashFile, helper, jsonFile, localTree, noOtherClients, privatePath, readConfig, safeContainer, safeEnvironment, unique, verifyMigrationFiles, waitReady, writeNewJson } from './module15-ops-runtime.mjs';

export function parseArguments(argv) {
  const [action, ...rawArgs] = argv, args = rawArgs.filter(value => value !== '--');
  requireCondition(['backup', 'restore', 'verify-restore'].includes(action), 'ACTION_REQUIRED');
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === '--dynamic') { requireCondition(!options.dynamic, 'DUPLICATE_ARGUMENT'); options.dynamic = true; continue; }
    requireCondition(['--env-file', '--project', '--output', '--backup', '--confirm-target'].includes(key) && args[index + 1] && !args[index + 1].startsWith('--'), 'ARGUMENT_INVALID');
    requireCondition(!Object.hasOwn(options, key.slice(2)), 'DUPLICATE_ARGUMENT'); options[key.slice(2)] = args[++index];
  }
  requireCondition(options['env-file'] && options.project, 'EXPLICIT_ENV_AND_PROJECT_REQUIRED');
  if (action === 'backup') requireCondition(options.output && !options.backup && !options.dynamic, 'BACKUP_ARGUMENT_INVALID');
  if (action === 'restore') requireCondition(options.backup && options['confirm-target'] && !options.dynamic, 'RESTORE_CONFIRMATION_REQUIRED');
  if (action === 'verify-restore') requireCondition(options.backup, 'BACKUP_REQUIRED');
  return { action, options };
}
const safeError = error => error instanceof OpsError ? error.code : /^[A-Z0-9]{5}$/.test(error?.code ?? '') ? 'DATABASE_' + error.code : 'OPERATION_FAILED';
async function selectedConfig(options, restore) { await privatePath(options['env-file']); return readConfig(options['env-file'], options.project, { restore }); }
async function newReport(action, config, folder) {
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const report = { schemaVersion: 1, action, startedAt: new Date().toISOString(), project: config.project, commands: [], status: 'IN_PROGRESS', cleaned: false };
  const runtime = new DockerRuntime(config, report, path.join(folder, 'backup.log'));
  const interrupted = () => { runtime.interrupted = true; };
  process.on('SIGINT', interrupted); process.on('SIGTERM', interrupted);
  return { report, runtime, dispose: () => { process.off('SIGINT', interrupted); process.off('SIGTERM', interrupted); } };
}
function assertConfiguredContainer(container, service, config) {
  const map = Object.fromEntries(container.Config.Env.map(value => { const i = value.indexOf('='); return [value.slice(0, i), value.slice(i + 1)]; }));
  if (service === 'db') for (const key of ['POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD']) requireCondition(map[key] === config.values[key], 'SOURCE_DB_CONFIG_MISMATCH');
  if (service === 'api') requireCondition(new URL(map.DATABASE_URL).href === config.internalUrl, 'SOURCE_API_CONFIG_MISMATCH');
  const [key, target] = { db: ['DB_HOST_PORT', '5432/tcp'], api: ['API_HOST_PORT', '3000/tcp'], 'admin-web': ['ADMIN_HOST_PORT', '80/tcp'], 'store-web': ['STORE_HOST_PORT', '80/tcp'] }[service];
  const bindings = container.HostConfig.PortBindings[target];
  requireCondition(bindings?.length === 1 && bindings[0].HostIp === '127.0.0.1' && bindings[0].HostPort === config.values[key], 'SOURCE_PORT_MISMATCH');
}
async function allServices(runtime) {
  const containers = {};
  for (const service of SERVICES) {
    const container = await runtime.service(service);
    requireCondition(!container.State.Paused && !container.State.Restarting && ['created', 'running', 'exited'].includes(container.State.Status), 'SERVICE_LIFECYCLE_UNSAFE');
    assertConfiguredContainer(container, service, runtime.config); containers[service] = container;
  }
  return containers;
}
export async function withQuiescedSource(runtime, containers, operation) {
  const stopped = []; let result, operationError, restoreFailed;
  try {
    for (const service of ['admin-web', 'store-web', 'api']) if (containers[service].State.Running) {
      stopped.push(service);
      await runtime.run(['stop', '--time=120', containers[service].Id], 'stop_source_' + service);
      const state = (await runtime.inspect(containers[service].Id)).State;
      requireCondition(!state.Running && !state.OOMKilled && state.ExitCode !== 137, 'SOURCE_DID_NOT_STOP_GRACEFULLY');
    }
    runtime.report.pauseStartedAt = new Date().toISOString();
    result = await operation();
  } catch (error) { runtime.report.primaryFailure = safeError(error); operationError = error; }
  finally {
    const interrupted = runtime.interrupted; runtime.interrupted = false;
    let failure = false;
    for (const service of ['api', 'admin-web', 'store-web']) if (stopped.includes(service)) {
      try {
        const container = await runtime.inspect(containers[service].Id);
        if (!container.State.Running) await runtime.run(['start', containers[service].Id], 'resume_source_' + service, { recovery: true });
        await waitReady(runtime, containers[service].Id);
      } catch { failure = true; }
    }
    runtime.interrupted = interrupted;
    runtime.report.resumedAt = new Date().toISOString(); runtime.report.originalStatesRestored = !failure;
    restoreFailed = failure;
  }
  if (restoreFailed) throw new OpsError('SOURCE_STATE_NOT_RESTORED');
  if (operationError) throw operationError;
  return result;
}
async function sameDbContainer(runtime, original) {
  const current = await runtime.inspect(original.Id);
  requireCondition(current.Id === original.Id && current.State.Running && current.State.StartedAt === original.State.StartedAt, 'ORIGINAL_DB_RESTARTED');
  equalJson(safeContainer(current).mounts, safeContainer(original).mounts, 'ORIGINAL_DB_MOUNTS_CHANGED');
}
async function rejectOtherVolumeConsumers(runtime, volume, allowed) {
  const ids = (await runtime.run(['ps', '--filter', 'volume=' + volume, '-q'], 'check_volume_consumers')).split(/\s+/).filter(Boolean);
  for (const id of ids) requireCondition(allowed.some(value => value.startsWith(id)), 'UNKNOWN_RUNNING_VOLUME_WRITER');
}
async function payloadChecksums(folder, tree) {
  return [{ path: 'database.dump', size: String(lstatSync(path.join(folder, 'database.dump')).size), sha256: await hashFile(path.join(folder, 'database.dump')) }, ...tree.files.map(({ path: relative, size, sha256 }) => ({ path: 'uploads/' + relative, size, sha256 }))];
}
async function verifyPackage(folder) {
  const manifest = jsonFile(path.join(folder, 'manifest.json'));
  requireCondition(manifest.schemaVersion === 1 && manifest.status === 'COMPLETE' && manifest.originalStatesRestored === true && manifest.images && SERVICES.every(service => /^sha256:[a-f0-9]{64}$/.test(manifest.images[service])), 'BACKUP_NOT_COMPLETE');
  requireCondition(manifest.database?.canonicalVersion === SNAPSHOT_CANONICAL_VERSION, 'BACKUP_SNAPSHOT_VERSION_UNSUPPORTED');
  const actual = await localTree(path.join(folder, 'uploads')); assertSameTree(actual, manifest.uploads);
  equalJson(await payloadChecksums(folder, actual), manifest.payloads, 'BACKUP_PAYLOAD_CHECKSUM_MISMATCH');
  const expectedText = manifest.payloads.map(row => row.sha256 + '  ' + row.path).join('\n') + '\n';
  requireCondition(readFileSync(path.join(folder, 'checksums.sha256'), 'utf8') === expectedText, 'CHECKSUM_MANIFEST_MISMATCH');
  return manifest;
}
async function reconcile(client, uploadsRoot, scope) {
  const { runReconcile } = await import('./reconcile.mjs');
  const result = await runReconcile({ client, uploadsRoot, scope });
  requireCondition(result.checks?.length > 0 && result.checks.every(check => check.passed), 'READ_ONLY_RECONCILE_FAILED');
  return result;
}

export async function backup(options) {
  const config = await selectedConfig(options, false), root = await privatePath(options.output, { directory: true });
  const backupId = 'm415-' + new Date().toISOString().replace(/[-:.]/g, '').replace('Z', '') + '-' + randomUUID().slice(0, 8);
  const folder = await privatePath(path.join(root, backupId), { directory: true, fresh: true });
  const context = await newReport('backup', config, folder), { report, runtime } = context; let client;
  try {
    const containers = await allServices(runtime);
    requireCondition(containers.db.State.Running && containers.db.State.Health?.Status === 'healthy', 'SOURCE_DB_NOT_READY');
    report.backupId = backupId; report.original = Object.fromEntries(SERVICES.map(service => [service, safeContainer(containers[service])]));
    report.images = Object.fromEntries(SERVICES.map(service => [service, containers[service].Image]));
    report.volumes = { db: await runtime.volume(containers.db, '/var/lib/postgresql/data', 'db_data'), uploads: await runtime.volume(containers.api, '/app/storage/uploads', 'uploads') };
    report.engineId = await runtime.run(['info', '--format', '{{.ID}}'], 'docker_engine_identity');
    report.gitSha = (await command('git', ['rev-parse', 'HEAD'], { env: safeEnvironment() })).stdout.trim();
    report.dumpVersion = await runtime.run(['exec', containers.db.Id, 'pg_dump', '--version'], 'pg_dump_version'); requireCondition(/\b16\./.test(report.dumpVersion), 'PG_DUMP_16_REQUIRED');
    writeNewJson(path.join(folder, 'manifest.in-progress.json'), report);
    await rejectOtherVolumeConsumers(runtime, report.volumes.uploads.name, [containers.api.Id]);
    await rejectOtherVolumeConsumers(runtime, report.volumes.db.name, [containers.db.Id]);
    report.imageMigrations = await helper(runtime, report.images.api, { input: { mode: 'migrations' } });
    await withQuiescedSource(runtime, containers, async () => {
      try {
      client = await connectedClient(config); await noOtherClients(client);
      const snapshot = await captureDatabase(client, { exportSnapshot: true, keepTransaction: true });
      report.databaseIdentity = snapshot.identity; report.database = snapshot.summary; verifyMigrationFiles(report.database.migrations, report.imageMigrations);
      report.uploads = await helper(runtime, report.images.api, { volume: report.volumes.uploads.name });
      requireCondition(/^[0-9A-Fa-f-]+$/.test(snapshot.snapshot), 'EXPORTED_SNAPSHOT_INVALID');
      const temporary = '/tmp/m415-backup-' + backupId + '.dump'; report.retainedDump = temporary;
      await runtime.run(['exec', containers.db.Id, 'pg_dump', '--format=custom', '--no-owner', '--no-acl', '--snapshot=' + snapshot.snapshot, '--username=' + config.values.POSTGRES_USER, '--dbname=' + config.values.POSTGRES_DB, '--file=' + temporary, '--no-password'], 'pg_dump_consistent_snapshot');
      await runtime.run(['cp', containers.db.Id + ':' + temporary, path.join(folder, 'database.dump')], 'copy_binary_dump');
      await client.query('COMMIT');
      const uploadsRoot = path.join(folder, 'uploads'); mkdirSync(uploadsRoot, { mode: 0o700 });
      await runtime.run(['cp', containers.api.Id + ':/app/storage/uploads/.', uploadsRoot], 'copy_stopped_api_uploads');
      assertSameTree(await localTree(uploadsRoot), report.uploads);
      const fresh = await captureDatabase(client); equalJson(fresh.summary, report.database, 'SOURCE_CHANGED_DURING_BACKUP');
      assertSameTree(await helper(runtime, report.images.api, { volume: report.volumes.uploads.name }), report.uploads);
      await noOtherClients(client); await sameDbContainer(runtime, containers.db);
      report.payloads = await payloadChecksums(folder, report.uploads);
      writeFileSync(path.join(folder, 'checksums.sha256'), report.payloads.map(row => row.sha256 + '  ' + row.path).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
      await client.end(); client = undefined; report.snapshotVerifiedAt = new Date().toISOString();
      } finally { await client?.query('ROLLBACK').catch(() => undefined); await client?.end().catch(() => undefined); client = undefined; }
    });
    await sameDbContainer(runtime, containers.db); report.status = 'COMPLETE';
  } catch (error) { report.status = 'FAILED'; report.failure = safeError(error); }
  finally {
    await client?.query('ROLLBACK').catch(() => undefined); await client?.end().catch(() => undefined);
    report.finishedAt = new Date().toISOString(); writeNewJson(path.join(folder, 'manifest.json'), report); context.dispose();
  }
  requireCondition(report.status === 'COMPLETE', report.failure ?? 'BACKUP_FAILED');
  return { status: report.status, backup: folder, backupId, originalStatesRestored: report.originalStatesRestored };
}

async function targetFolder(options, { fresh = false } = {}) {
  return privatePath(options.output ?? path.join('private-delivery/M4-15', options.project), { directory: true, fresh });
}
async function sourceUnchanged(runtime, source) {
  const inspect = await runtime.run(['inspect', '--format', '{{json .}}', source.original.db.id], 'protect_source_database');
  const container = JSON.parse(inspect);
  requireCondition(container.Id === source.original.db.id && container.State.StartedAt === source.original.db.startedAt, 'SOURCE_DATABASE_CHANGED');
  equalJson(safeContainer(container).mounts, source.original.db.mounts, 'SOURCE_DATABASE_VOLUME_CHANGED');
}
async function targetVolumes(runtime, containers, source) {
  const volumes = { db: await runtime.volume(containers.db, '/var/lib/postgresql/data', 'db_data'), uploads: await runtime.volume(containers.api, '/app/storage/uploads', 'uploads') };
  const sourceNames = [source.volumes.db.name, source.volumes.uploads.name];
  requireCondition(!sourceNames.includes(volumes.db.name) && !sourceNames.includes(volumes.uploads.name) && volumes.db.name !== volumes.uploads.name, 'RESTORE_VOLUME_IS_SOURCE');
  return volumes;
}
export async function assertEmptyDatabase(client) {
  const rows = (await client.query("SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast' AND n.nspname !~ '^pg_temp' UNION ALL SELECT t.oid FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_' UNION ALL SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_'")).rows;
  requireCondition(rows.length === 0, 'RESTORE_DATABASE_NOT_EMPTY'); await noOtherClients(client);
}
async function copyTargetFiles(runtime, api, folder, label) {
  const target = path.join(folder, unique('uploads-' + label)); mkdirSync(target, { mode: 0o700 });
  await runtime.run(['cp', api.Id + ':/app/storage/uploads/.', target], 'copy_target_uploads_for_reconcile');
  return target;
}
async function staticVerification(runtime, containers, source, folder) {
  requireCondition(!containers.api.State.Running && !containers['admin-web'].State.Running && !containers['store-web'].State.Running, 'STATIC_CHECK_REQUIRES_STOPPED_APPS');
  const volumes = await targetVolumes(runtime, containers, source), client = await connectedClient(runtime.config);
  try {
    const identity = await databaseIdentity(client);
    requireCondition(identity.database === runtime.config.values.POSTGRES_DB && identity.cluster !== source.databaseIdentity.cluster, 'RESTORE_DATABASE_IDENTITY_UNSAFE');
    const captured = await captureDatabase(client); equalJson(captured.summary, source.database, 'FULL_DATABASE_SNAPSHOT_MISMATCH');
    const actual = await helper(runtime, source.images.api, { volume: volumes.uploads.name }); assertSameTree(actual, source.uploads);
    const uploadsRoot = await copyTargetFiles(runtime, containers.api, folder, 'static'); assertSameTree(await localTree(uploadsRoot), actual);
    const reconciled = await reconcile(client, uploadsRoot, { target: 'restore', project: runtime.config.project, backupId: source.backupId });
    await sourceUnchanged(runtime, source);
    return { checkedAt: new Date().toISOString(), databaseSha256: createHash('sha256').update(JSON.stringify(captured.summary)).digest('hex'), schemaSha256: captured.summary.schemaSha256, allTables: captured.summary.tables.length, allColumnsAndTechnicalRowsCompared: true, fileCount: actual.files.length, reconcile: reconciled, identity };
  } finally { await client.end(); }
}

export async function restore(options) {
  const config = await selectedConfig(options, true); requireCondition(config.values.POSTGRES_DB === options['confirm-target'], 'RESTORE_CONFIRM_TARGET_MISMATCH');
  const backupFolder = await privatePath(existingRealPath(options.backup)), source = await verifyPackage(backupFolder);
  requireCondition(config.project !== source.project && config.values.POSTGRES_DB !== source.databaseIdentity.database, 'RESTORE_MATCHES_SOURCE');
  const sourcePorts = Object.values(source.original).flatMap(row => row.ports ?? []);
  requireCondition(!['DB_HOST_PORT', 'API_HOST_PORT', 'ADMIN_HOST_PORT', 'STORE_HOST_PORT'].some(key => sourcePorts.includes(config.values[key])), 'RESTORE_PORT_MATCHES_SOURCE');
  const folder = await targetFolder(options, { fresh: true }), context = await newReport('restore', config, folder), { report, runtime } = context; let client;
  try {
    await assertNewProject(runtime); await sourceUnchanged(runtime, source);
    report.backup = backupFolder; report.backupId = source.backupId; report.envSha256 = await hashFile(config.envFile);
    const images = {};
    for (const service of SERVICES) {
      const image = source.images[service];
      requireCondition(await runtime.run(['image', 'inspect', '--format', '{{.Id}}', image], 'require_backup_image') === image, 'BACKUP_IMAGE_UNAVAILABLE');
      const tag = config.project + '-' + service + ':retained'; await runtime.run(['tag', image, tag], 'retain_restore_image'); images[service] = tag;
    }
    const override = path.join(folder, 'compose.override.private.json');
    report.networkSubnet = await module15FreeSubnet(args => runtime.run(args, 'inspect_restore_network_allocation'));
    writeNewJson(override, { services: Object.fromEntries(SERVICES.map(service => [service, { image: images[service], ...(service === 'api' ? { environment: { DATABASE_URL: config.internalUrl } } : {}) }])), networks: { default: { ipam: { config: [{ subnet: report.networkSubnet }] } } } });
    report.override = override; await runtime.validateCompose(override);
    await runtime.compose(['up', '-d', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '90', 'db'], override, 'start_new_restore_db');
    const db = await runtime.service('db'); requireCondition(db.Image === source.images.db, 'RESTORE_IMAGE_MISMATCH');
    const dbVolume = await runtime.volume(db, '/var/lib/postgresql/data', 'db_data'); requireCondition(dbVolume.name !== source.volumes.db.name && dbVolume.name !== source.volumes.uploads.name, 'RESTORE_DB_VOLUME_IS_SOURCE');
    client = await connectedClient(config); const identity = await databaseIdentity(client);
    requireCondition(identity.cluster !== source.databaseIdentity.cluster && identity.database === options['confirm-target'], 'RESTORE_DATABASE_IDENTITY_UNSAFE');
    await assertEmptyDatabase(client);
    const temporary = '/tmp/m415-restore-' + randomUUID() + '.dump'; report.retainedDump = temporary;
    await runtime.run(['cp', path.join(backupFolder, 'database.dump'), db.Id + ':' + temporary], 'copy_dump_to_empty_restore');
    requireCondition(/\b16\./.test(await runtime.run(['exec', db.Id, 'pg_restore', '--version'], 'pg_restore_version')), 'PG_RESTORE_16_REQUIRED');
    await runtime.run(['exec', db.Id, 'pg_restore', '--single-transaction', '--exit-on-error', '--no-owner', '--no-acl', '--username=' + config.values.POSTGRES_USER, '--dbname=' + config.values.POSTGRES_DB, '--no-password', temporary], 'restore_empty_database_once');
    await client.end(); client = undefined;
    await runtime.compose(['create', '--no-build', '--no-recreate', '--pull', 'never', 'api', 'admin-web', 'store-web'], override, 'create_stopped_restore_apps');
    const containers = await allServices(runtime), volumes = await targetVolumes(runtime, containers, source);
    for (const service of SERVICES) requireCondition(containers[service].Image === source.images[service], 'RESTORE_IMAGE_MISMATCH');
    const empty = await helper(runtime, source.images.api, { volume: volumes.uploads.name });
    requireCondition(empty.files.length === 0 && empty.directories.length === 1 && empty.directories[0].path === '', 'RESTORE_UPLOAD_VOLUME_NOT_EMPTY');
    await runtime.run(['cp', path.join(backupFolder, 'uploads') + path.sep + '.', containers.api.Id + ':/app/storage/uploads'], 'restore_new_upload_volume');
    const user = await helper(runtime, source.images.api, { input: { mode: 'identity' } });
    requireCondition(Number.isSafeInteger(user.uid) && user.uid > 0 && Number.isSafeInteger(user.gid), 'NON_ROOT_API_USER_REQUIRED');
    await helper(runtime, source.images.api, { volume: volumes.uploads.name, writable: true, root: true, input: { mode: 'fix', ...user, tree: source.uploads } });
    report.static = await staticVerification(runtime, containers, source, folder);
    report.containers = Object.fromEntries(SERVICES.map(service => [service, safeContainer(containers[service])])); report.volumes = volumes;
    report.status = 'RESTORED_STATIC';
  } catch (error) { report.status = 'FAILED'; report.failure = safeError(error); }
  finally { await client?.end().catch(() => undefined); report.finishedAt = new Date().toISOString(); writeNewJson(path.join(folder, 'restore.json'), report); context.dispose(); }
  requireCondition(report.status === 'RESTORED_STATIC', report.failure ?? 'RESTORE_FAILED');
  return { status: report.status, project: config.project, report: path.join(folder, 'restore.json'), apiStarted: false, static: { tables: report.static.allTables, fileCount: report.static.fileCount } };
}

async function pendingRecovery(client) {
  const asOf = new Date().toISOString();
  const queries = {
    payments: 'SELECT o.id,o.payment_deadline::text AS deadline,EXISTS(SELECT 1 FROM stock_incident_item s JOIN stock_incident i ON i.id=s.incident_id JOIN order_item oi ON oi.id=s.order_item_id WHERE oi.order_id=o.id AND i.status=\'OPEN\' AND s.damaged_quantity IS NULL) AS unknown_damage FROM "order" o WHERE o.status=\'WAIT_PAYMENT\' AND o.payment_deadline<=$1 ORDER BY o.id',
    receipts: 'SELECT o.id FROM "order" o WHERE o.status=\'SHIPPED\' AND o.auto_receipt_due_at<=$1 AND NOT EXISTS(SELECT 1 FROM order_block b WHERE b.order_id=o.id AND b.active AND b.blocks_receipt) ORDER BY o.id',
    handovers: "SELECT h.id,h.order_id FROM handover_attempt h WHERE h.status='IN_PROGRESS' AND (h.uncertain_after<=$1 OR NOT EXISTS(SELECT 1 FROM task t WHERE t.business_type='ORDER' AND t.business_id=h.order_id AND t.stage='SHIPMENT_PROCESS' AND t.status='CLAIMED')) ORDER BY h.id",
    tasks: "SELECT t.id,t.due_at::text AS deadline FROM task t WHERE t.status IN ('OPEN','CLAIMED','SUSPENDED') AND t.due_at<=$1 AND NOT EXISTS(SELECT 1 FROM deadline_event e WHERE e.task_id=t.id AND e.event_type='OVERDUE' AND e.deadline_at=t.due_at) ORDER BY t.id",
    proxy: "SELECT id FROM proxy_context WHERE status='VERIFIED' AND expires_at<=$1 ORDER BY id",
  };
  const result = { asOf };
  for (const [name, sql] of Object.entries(queries)) result[name] = (await client.query(sql, [asOf])).rows;
  return result;
}
async function checkRecovery(client, pending) {
  const checks = [];
  const add = (name, id, passed) => checks.push({ name, id, passed });
  for (const row of pending.payments) {
    const order = (await client.query('SELECT status,close_reason_code,(SELECT count(*)::text FROM inventory_action a WHERE a.action_key=\'CLOSE:\'||o.id::text) AS close_actions FROM "order" o WHERE id=$1', [row.id])).rows[0];
    add('payment-timeout', row.id, row.unknown_damage ? order.status === 'WAIT_PAYMENT' && order.close_actions === '0' : order.status === 'CLOSED' && order.close_reason_code === 'PAYMENT_TIMEOUT' && order.close_actions === '1');
  }
  for (const row of pending.receipts) add('auto-receipt', row.id, (await client.query('SELECT status FROM "order" WHERE id=$1', [row.id])).rows[0]?.status === 'COMPLETED');
  for (const row of pending.handovers) add('handover-recovery', row.id, (await client.query('SELECT status FROM handover_attempt WHERE id=$1', [row.id])).rows[0]?.status === 'UNCERTAIN');
  for (const row of pending.tasks) {
    const result = (await client.query("SELECT t.status,(SELECT count(*)::text FROM deadline_event e WHERE e.task_id=t.id AND e.event_type='OVERDUE' AND e.deadline_at=$2::timestamptz) AS events FROM task t WHERE id=$1", [row.id, row.deadline])).rows[0];
    add('task-overdue', row.id, result.events === '1' || (result.events === '0' && !['OPEN', 'CLAIMED', 'SUSPENDED'].includes(result.status)));
  }
  for (const row of pending.proxy) { const context = (await client.query('SELECT status FROM proxy_context WHERE id=$1', [row.id])).rows[0]; add('proxy-expiry', row.id, !!context && context.status !== 'VERIFIED'); }
  return checks;
}

export async function verifyRestore(options) {
  const config = await selectedConfig(options, true), backupFolder = await privatePath(existingRealPath(options.backup)), source = await verifyPackage(backupFolder), folder = await targetFolder(options);
  const previous = jsonFile(path.join(folder, 'restore.json'));
  requireCondition(previous.status === 'RESTORED_STATIC' && previous.project === config.project && previous.backupId === source.backupId && previous.envSha256 === await hashFile(config.envFile), 'RESTORE_CHECKPOINT_MISMATCH');
  const context = await newReport('verify-restore', config, folder), { report, runtime } = context; let client;
  const target = path.join(folder, unique(options.dynamic ? 'dynamic-verification' : 'static-verification') + '.json');
  try {
    const containers = await allServices(runtime);
    for (const service of SERVICES) requireCondition(containers[service].Id === previous.containers[service].id && containers[service].Image === source.images[service], 'RESTORE_CONTAINER_CHANGED');
    report.static = await staticVerification(runtime, containers, source, folder);
    if (options.dynamic) {
      client = await connectedClient(config); report.pendingRecovery = await pendingRecovery(client);
      await runtime.run(['start', containers.api.Id], 'start_verified_restore_api'); await waitReady(runtime, containers.api.Id);
      for (const service of ['admin-web', 'store-web']) { await runtime.run(['start', containers[service].Id], 'start_restore_' + service); await waitReady(runtime, containers[service].Id); }
      for (let attempt = 0; attempt < 120; attempt++) {
        report.recoveryChecks = await checkRecovery(client, report.pendingRecovery);
        const runs = (await client.query("SELECT r.job_name,r.status,r.failed_count,(SELECT count(*)::text FROM scheduler_failure f WHERE f.run_id=r.id AND f.error_code<>'ORDER_STOCK_CHECK_REQUIRED') AS unexpected_failures FROM scheduler_run r WHERE r.started_at>=$1::timestamptz AND r.job_name IN ('order-payment-timeout','order-handover-recovery','order-auto-receipt','task-overdue-scan') ORDER BY r.started_at", [report.pendingRecovery.asOf])).rows;
        const ready = ['order-payment-timeout', 'order-handover-recovery', 'order-auto-receipt', 'task-overdue-scan'].every(job => runs.some(row => row.job_name === job && (row.status === 'SUCCEEDED' || job === 'order-payment-timeout' && ['FAILED', 'PARTIAL_FAILED'].includes(row.status) && row.unexpected_failures === '0' && row.failed_count <= report.pendingRecovery.payments.filter(payment => payment.unknown_damage).length)));
        if (ready && report.recoveryChecks.every(check => check.passed)) { report.schedulerRuns = runs; break; }
        if (attempt === 119) throw new OpsError('RESTORE_DYNAMIC_RECOVERY_FAILED');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      const files = await helper(runtime, source.images.api, { volume: previous.volumes.uploads.name });
      const local = await copyTargetFiles(runtime, containers.api, folder, 'dynamic'); assertSameTree(await localTree(local), files);
      report.dynamicReconcile = await reconcile(client, local, { target: 'restore', project: config.project, backupId: source.backupId, phase: 'dynamic' });
      report.origins = [config.values.API_HOST_PORT, config.values.ADMIN_HOST_PORT, config.values.STORE_HOST_PORT].map(port => 'http://localhost:' + port);
      for (const origin of report.origins) { const response = await fetch(origin + '/api/v1/health/ready', { signal: AbortSignal.timeout(10_000) }); requireCondition(response.status === 200, 'RESTORE_ORIGIN_NOT_READY'); }
      report.dynamicAt = new Date().toISOString(); report.restoreToReadableMs = Date.parse(report.dynamicAt) - Date.parse(previous.startedAt); report.backupAgeAtRestoreMs = Date.parse(previous.startedAt) - Date.parse(source.snapshotVerifiedAt); report.dynamicNote = '正式启动补扫与文件清理可能产生合法变化；完整静态相等在首次启动前验证。私有页面/重新登录的业务演示由独立端到端验收提供。backupAge不是未发生故障的虚构RPO承诺。';
    }
    await sourceUnchanged(runtime, source); report.status = options.dynamic ? 'VERIFIED_DYNAMIC' : 'VERIFIED_STATIC';
  } catch (error) { report.status = 'FAILED'; report.failure = safeError(error); }
  finally { await client?.end().catch(() => undefined); report.finishedAt = new Date().toISOString(); writeNewJson(target, report); context.dispose(); }
  requireCondition(report.status !== 'FAILED', report.failure ?? 'VERIFY_RESTORE_FAILED');
  return { status: report.status, report: target, project: config.project, sourceWritten: false };
}

export async function main(argv = process.argv.slice(2)) {
  const { action, options } = parseArguments(argv);
  const result = action === 'backup' ? await backup(options) : action === 'restore' ? await restore(options) : await verifyRestore(options);
  console.log(JSON.stringify(result)); return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(JSON.stringify({ status: 'FAILED', code: safeError(error), cleaned: false })); process.exitCode = 1; });
