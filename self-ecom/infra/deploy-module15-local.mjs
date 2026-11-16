// 作用：仅在本轮五套功能E2E及完整恢复通过后部署同组镜像，保护原DB、全量数据与上传卷。
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backup } from '../scripts/module15-ops.mjs';
import { captureDatabase, OpsError, requireCondition } from '../scripts/module15-ops-snapshot.mjs';
import { SERVICES, DockerRuntime, assertSameTree, connectedClient, equalJson, helper, jsonFile, noOtherClients, noLinkPath, privatePath, readConfig, safeContainer, safeEnvironment, waitReady, writeNewJson } from '../scripts/module15-ops-runtime.mjs';
import { assertCoveringIndexTransition, assertMigrationChain, assertMigrationFiles, readMigrationChain, readMigrationRows } from '../scripts/module15-migration-chain.mjs';
import { sourceManifestDigest } from '../scripts/module15-source-state.mjs';

const applications = ['api', 'admin-web', 'store-web'];
const suffix = { api: 'api', 'admin-web': 'admin', 'store-web': 'store' };
const technicalTables = new Set(['scheduler_run', 'scheduler_failure']);
const sha = value => createHash('sha256').update(value).digest('hex');

export function validateDeploymentEvidence({ e2e, restored }) {
  requireCondition(e2e.status === 'passed' && e2e.originalResourcesPreserved === true, 'E2E_NOT_ACCEPTED');
  requireCondition(/^[a-f0-9]{40}$/.test(e2e.head ?? ''), 'E2E_REVISION_REQUIRED');
  requireCondition(/^[a-f0-9]{64}$/.test(e2e.sourceDigest ?? ''), 'E2E_SOURCE_DIGEST_REQUIRED');
  requireCondition(e2e.suites?.length === 5 && new Set(e2e.suites.map(suite => suite.name)).size === 5 &&
    ['orders', 'after-sales', 'settlement', 'coordination', 'reporting'].every(name => e2e.suites.some(suite => suite.name === name && suite.status === 'passed')), 'FIVE_E2E_SUITES_REQUIRED');
  requireCondition(/^self-ecom-m415-e2e-[a-f0-9]{8}$/.test(e2e.imagePrefix) && e2e.acceptedImages?.length === 3, 'FINAL_IMAGE_SET_REQUIRED');
  const images = Object.fromEntries(applications.map(service => {
    const image = e2e.acceptedImages.find(row => row.name === e2e.imagePrefix + '-' + suffix[service] + ':local');
    requireCondition(/^sha256:[a-f0-9]{64}$/.test(image?.id ?? ''), 'FINAL_IMAGE_DIGEST_REQUIRED'); return [service, image.id];
  }));
  requireCondition(restored.status === 'PASSED' && restored.staticStatus === 'RESTORED_STATIC' && restored.staticVerifyStatus === 'VERIFIED_STATIC' && restored.dynamicStatus === 'VERIFIED_DYNAMIC', 'FULL_RESTORE_NOT_ACCEPTED');
  requireCondition(restored.businessReadabilityStatus === 'PASSED' && restored.recoveryCandidateNetReleaseAndReplayVerified === true, 'RESTORED_BUSINESS_AND_REAL_RECOVERY_NOT_ACCEPTED');
  const writeAccess = restored.targetUploadsWriteAccess;
  requireCondition(Number.isInteger(writeAccess?.uid) && writeAccess.uid > 0 && writeAccess.writable === true &&
    Array.isArray(writeAccess.directories) && writeAccess.directories.length === 3 &&
    ['/app/storage/uploads', '/app/storage/uploads/tmp', '/app/storage/uploads/objects'].every(directory => writeAccess.directories.includes(directory)), 'RESTORED_UPLOADS_NONROOT_WRITE_ACCESS_NOT_ACCEPTED');
  requireCondition(restored.sourceBusinessAndFilesUnchanged === true && restored.sourceOriginalRunningStatesRestored === true && restored.allTablesCompared > 0 && restored.filesCompared > 0, 'RESTORE_PROTECTION_NOT_ACCEPTED');
  for (const service of applications) requireCondition(restored.sourceFrozenImages?.[service] === images[service], 'RESTORE_FINAL_IMAGE_MISMATCH');
  return images;
}

export function parseDeploymentArguments(argv) {
  const args = argv.filter(value => value !== '--'), result = {}, keys = new Set(['--e2e-result', '--restore-result', '--output', '--confirm-project']);
  for (let index = 0; index < args.length; index += 2) {
    requireCondition(keys.has(args[index]) && args[index + 1] && !args[index + 1].startsWith('--') && !Object.hasOwn(result, args[index]), 'DEPLOY_ARGUMENT_INVALID');
    result[args[index]] = args[index + 1];
  }
  requireCondition([...keys].every(key => result[key]) && result['--confirm-project'] === 'self-ecom', 'EXPLICIT_SELF_ECOM_TARGET_REQUIRED');
  return result;
}

function protectedSummary(summary) { return { ...summary, tables: summary.tables.filter(table => !(table.schema === 'public' && technicalTables.has(table.name))) }; }
function assertSelectedSource(container, service, config) {
  const values = Object.fromEntries(container.Config.Env.map(value => { const index = value.indexOf('='); return [value.slice(0, index), value.slice(index + 1)]; }));
  if (service === 'db') for (const key of ['POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD']) requireCondition(values[key] === config.values[key], 'LOCAL_DATABASE_CONFIG_MISMATCH');
  if (service === 'api') requireCondition(new URL(values.DATABASE_URL).href === config.internalUrl, 'LOCAL_API_DATABASE_MISMATCH');
  requireCondition(container.State.Running && container.State.Health?.Status === 'healthy', 'LOCAL_SOURCE_MUST_BE_HEALTHY');
}

export async function deployModule15(options) {
  requireCondition(options['--confirm-project'] === 'self-ecom', 'EXPLICIT_SELF_ECOM_TARGET_REQUIRED');
  const inputs = Object.fromEntries(['--e2e-result', '--restore-result'].map(key => [key, noLinkPath(options[key])]));
  const e2e = jsonFile(inputs['--e2e-result']), restored = jsonFile(inputs['--restore-result']);
  const images = validateDeploymentEvidence({ e2e, restored });
  requireCondition(await sourceManifestDigest() === e2e.sourceDigest, 'SOURCE_CHANGED_AFTER_E2E');
  // Read the established local runtime only after every isolated acceptance gate succeeds. Never print its environment.
  const local = await import('../scripts/module13-runtime.mjs');
  const config = readConfig('.env', 'self-ecom'); config.docker = local.docker; config.env = safeEnvironment(config.values, local.env);
  const publicFolder = noLinkPath(options['--output']); requireCondition(!existsSync(publicFolder), 'DEPLOY_OUTPUT_ALREADY_EXISTS');
  mkdirSync(publicFolder, { recursive: true });
  const privateFolder = await privatePath(path.join('private-delivery/M4-15', 'deployment-' + randomUUID().slice(0, 8)), { directory: true, fresh: true });
  const report = { schemaVersion: 1, startedAt: new Date().toISOString(), status: 'IN_PROGRESS', project: 'self-ecom', commands: [], images,
    inputs: Object.fromEntries(Object.entries(inputs).map(([key, file]) => [key, { path: file, sha256: sha(readFileSync(file)) }])),
    permissionSeedExecuted: false, historicalBackfillExecuted: false, sourceDigest: e2e.sourceDigest, cleaned: false };
  const runtime = new DockerRuntime(config, report, path.join(privateFolder, 'commands.private.log')), originals = {};
  let replaced = false, baseline, beforeMigrationRows, migrationChain;
  async function protectDatabase() {
    const current = await runtime.inspect(originals.db.Id);
    requireCondition(current.State.Running && current.State.StartedAt === originals.db.State.StartedAt && current.Image === originals.db.Image, 'ORIGINAL_DB_CHANGED');
    equalJson(safeContainer(current).mounts, safeContainer(originals.db).mounts, 'ORIGINAL_DB_MOUNTS_CHANGED');
  }
  try {
    for (const service of SERVICES) { originals[service] = await runtime.service(service); assertSelectedSource(originals[service], service, config); }
    report.original = Object.fromEntries(SERVICES.map(service => [service, safeContainer(originals[service])]));
    const uploads = await runtime.volume(originals.api, '/app/storage/uploads', 'uploads'); report.originalUploads = uploads;
    for (const service of applications) requireCondition(await runtime.run(['image', 'inspect', '--format', '{{.Id}}', images[service]], 'require_final_' + service + '_image') === images[service], 'FINAL_IMAGE_UNAVAILABLE');
    const imageMigrations = await helper(runtime, images.api, { input: { mode: 'migrations' } });
    migrationChain = await readMigrationChain(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
    assertMigrationFiles(imageMigrations, migrationChain); report.migrationFiles = migrationChain;
    for (const service of ['admin-web', 'store-web', 'api']) {
      await runtime.run(['stop', '--time=120', originals[service].Id], 'quiesce_original_' + service);
      const state = (await runtime.inspect(originals[service].Id)).State;
      requireCondition(!state.Running && !state.OOMKilled && state.ExitCode !== 137, 'LOCAL_SERVICE_DID_NOT_STOP_GRACEFULLY');
    }
    report.pauseStartedAt = new Date().toISOString();
    report.backup = await backup({ 'env-file': '.env', project: 'self-ecom', output: path.join(privateFolder, 'backups') });
    baseline = jsonFile(path.join(report.backup.backup, 'manifest.json'));
    report.migrationBaseline = assertMigrationChain(baseline.database.migrations, migrationChain, { allowCoveringIndexPending: true });
    const baselineClient = await connectedClient(config);
    try { await noOtherClients(baselineClient); beforeMigrationRows = await readMigrationRows(baselineClient, baseline.database); }
    finally { await baselineClient.end(); }
    const override = path.join(privateFolder, 'compose.accepted-images.private.json');
    writeNewJson(override, { services: Object.fromEntries(applications.map(service => [service, { image: images[service], ...(service === 'api' ? { environment: { DATABASE_URL: config.internalUrl } } : {}) }])) });
    await runtime.validateCompose(override);
    await runtime.compose(['run', '--no-deps', '--pull', 'never', 'api', 'pnpm', 'db:migrate:deploy'], override, 'apply_only_verified_migration_chain');
    const client = await connectedClient(config);
    try {
      await noOtherClients(client); const migrated = await captureDatabase(client);
      report.migrationVerification = assertCoveringIndexTransition(baseline.database, migrated.summary, { chain: migrationChain, beforeMigrationRows, afterMigrationRows: await readMigrationRows(client, migrated.summary) });
      assertSameTree(await helper(runtime, images.api, { volume: uploads.name }), baseline.uploads);
      report.beforeApiStart = { allOriginalTablesAllColumnsAndSchemaOtherwiseEqual: true, approvedMigration: report.migrationVerification, allFilesEqual: true, tableCount: migrated.summary.tables.length, fileCount: baseline.uploads.files.length };
    } finally { await client.end(); }
    await protectDatabase();
    for (const service of applications) await runtime.run(['tag', images[service], { api: 'self-ecom-api:local', 'admin-web': 'self-ecom-admin-web:local', 'store-web': 'self-ecom-store-web:local' }[service]], 'update_local_tag_' + service);
    // Compose replaces only the three applications; the database service is explicitly outside this operation.
    replaced = true;
    await runtime.compose(['up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '120', ...applications], override, 'deploy_only_three_accepted_applications');
    for (const service of applications) {
      const current = await runtime.service(service); requireCondition(current.Image === images[service], 'DEPLOYED_IMAGE_MISMATCH');
      await waitReady(runtime, current.Id);
      if (service === 'api') requireCondition((await runtime.volume(current, '/app/storage/uploads', 'uploads')).name === uploads.name, 'ORIGINAL_UPLOAD_VOLUME_CHANGED');
    }
    await protectDatabase();
    const spec = jsonFile(path.resolve('docs/openapi/openapi.json'));
    report.origins = [config.values.API_HOST_PORT, config.values.ADMIN_HOST_PORT, config.values.STORE_HOST_PORT].map(port => 'http://localhost:' + port);
    for (const origin of report.origins) {
      requireCondition((await fetch(origin + '/api/v1/health/ready', { signal: AbortSignal.timeout(15000) })).status === 200, 'DEPLOY_ORIGIN_NOT_READY');
      const response = await fetch(origin + '/api/docs-json', { signal: AbortSignal.timeout(15000) }); requireCondition(response.status === 200, 'DEPLOY_CONTRACT_NOT_READABLE');
      equalJson(await response.json(), spec, 'DEPLOY_FULL_CONTRACT_MISMATCH');
    }
    const after = await connectedClient(config);
    try {
      const snapshot = await captureDatabase(after);
      report.afterStartMigrationVerification = assertCoveringIndexTransition(baseline.database, snapshot.summary, { chain: migrationChain, beforeMigrationRows, afterMigrationRows: await readMigrationRows(after, snapshot.summary), allowSchedulerChanges: true });
      const tree = await helper(runtime, images.api, { volume: uploads.name }); assertSameTree(tree, baseline.uploads);
      report.afterApiStart = { allOriginalMembersPermissionsPasswordHashesBusinessAndFilesEqual: true,
        schedulerTechnicalTablesAllowedToChange: [...technicalTables], protectedTableCount: protectedSummary(snapshot.summary).tables.length,
        fullSnapshotSha256: sha(JSON.stringify(snapshot.summary)), filesCompared: tree.files.length };
      writeNewJson(path.join(privateFolder, 'after-start-snapshot.private.json'), snapshot.summary);
    } finally { await after.end(); }
    report.readableAt = new Date().toISOString(); report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.failure = error instanceof OpsError ? error.code : 'DEPLOYMENT_FAILED';
    // Before replacement the exact original containers are still recoverable. Do not overwrite or restore any database on failure.
    if (!replaced && originals.api) {
      let unchanged = !baseline;
      if (baseline) {
        const client = await connectedClient(config).catch(() => undefined);
        try { if (client) {
          const current = await captureDatabase(client);
          if (JSON.stringify(current.summary) === JSON.stringify(baseline.database)) unchanged = true;
          else if (migrationChain && beforeMigrationRows) {
            report.recoveryMigrationVerification = assertCoveringIndexTransition(baseline.database, current.summary, { chain: migrationChain, beforeMigrationRows, afterMigrationRows: await readMigrationRows(client, current.summary) }); unchanged = true;
          }
        } } catch { unchanged = false; } finally { await client?.end(); }
      }
      if (unchanged) {
        report.originalApplicationsResumed = true;
        for (const service of applications) try {
          const current = await runtime.inspect(originals[service].Id);
          if (originals[service].State.Running && !current.State.Running) await runtime.run(['start', originals[service].Id], 'recover_original_' + service, { recovery: true });
          if (originals[service].State.Running) await waitReady(runtime, originals[service].Id);
        } catch { report.originalApplicationsResumed = false; }
      }
    }
    report.requiresReviewBeforeFurtherChange = true;
  } finally {
    if (originals.db) try { await protectDatabase(); report.originalDatabaseProtected = true; } catch { report.status = 'failed'; report.databaseProtectionFailure = 'ORIGINAL_DB_PROTECTION_FAILED'; }
    report.finishedAt = new Date().toISOString(); report.privateFolder = privateFolder;
    writeNewJson(path.join(privateFolder, 'deployment.private.json'), report);
    writeNewJson(path.join(publicFolder, 'result.json'), { ...report, backup: report.backup ? { status: report.backup.status, backupId: report.backup.backupId, privateBackupRetained: true } : undefined });
  }
  requireCondition(report.status === 'passed', report.failure ?? report.databaseProtectionFailure ?? 'DEPLOYMENT_FAILED');
  return { status: report.status, evidence: path.join(publicFolder, 'result.json'), privateFolder, origins: report.origins, images };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  deployModule15(parseDeploymentArguments(process.argv.slice(2))).then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(JSON.stringify({ status: 'failed', code: error instanceof OpsError ? error.code : 'DEPLOYMENT_REJECTED', retainedResources: true })); process.exitCode = 1;
  });
}
