// Small production-image CI check. It deliberately excludes the long performance and browser acceptance runs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = 'self-ecom-m415-ci-' + randomUUID().slice(0, 8);
const output = path.join(root, 'output/testing/M4-15/ci-smoke', project);
const publicFolder = path.join(root, 'docs/verification/M4-15/ci-smoke', project);
const privateFolder = path.join(root, 'private-delivery/M4-15/ci-smoke', project);
for (const directory of [output, publicFolder, privateFolder]) mkdirSync(directory, { recursive: true, mode: 0o700 });
const databasePassword = randomBytes(32).toString('hex'), jwtSecret = randomBytes(48).toString('hex');
const secrets = [databasePassword, jwtSecret];
const redact = input => secrets.reduce((value, secret) => value.replaceAll(secret, '[REDACTED]'), String(input)).replace(/postgres(?:ql)?:\/\/[^\s"'`]+/g, '[REDACTED_DATABASE_URL]');
const docker = process.env.DOCKER_BINARY ?? 'docker';
const report = { schemaVersion: 1, kind: 'ci-production-image-smoke', project, startedAt: new Date().toISOString(), scope: ['three-production-image-builds', 'fresh-migration', 'two-spa-html-assets', 'same-origin-health', 'test-route-absence', 'database-outage-readiness', 'database-restart-recovery'], excludes: ['long-performance-run', 'full-browser-business-acceptance', 'backup-restore-acceptance'], commands: [], checks: [], images: [], status: 'RUNNING', resourcesRetained: true };
function run(args, label) {
  const startedAt = new Date().toISOString(), result = spawnSync(docker, args, { cwd: root, env: { ...process.env, ...values }, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  const log = 'command-' + report.commands.length + '.redacted.txt';
  writeFileSync(path.join(publicFolder, log), redact((result.stdout ?? '') + (result.stderr ?? '') + (result.error?.code ?? '')));
  report.commands.push({ label, command: ['docker', ...args], startedAt, endedAt: new Date().toISOString(), exitCode: result.status, log });
  assert.equal(result.status, 0, label + ': see retained redacted command log'); return result.stdout ?? '';
}
const freePort = () => new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(error => error ? reject(error) : resolve(port)); }); });
const ports = new Set(); while (ports.size < 4) ports.add(await freePort());
const [apiPort, adminPort, storePort, dbPort] = [...ports];
const envFile = path.join(privateFolder, 'compose.env');
assert.equal(spawnSync('git', ['check-ignore', '--quiet', envFile], { cwd: root, windowsHide: true }).status, 0, 'Runtime credentials must be Git-ignored');
assert.match(readFileSync(path.join(root, '.dockerignore'), 'utf8'), /^private-delivery\s*$/m);
const values = { POSTGRES_DB: 'm415_ci_smoke_test', POSTGRES_USER: 'ci_smoke', POSTGRES_PASSWORD: databasePassword, JWT_SECRET: jwtSecret, API_HOST_PORT: apiPort, ADMIN_HOST_PORT: adminPort, STORE_HOST_PORT: storePort, DB_HOST_PORT: dbPort, COMPOSE_CORS_ORIGINS: `http://localhost:${adminPort},http://localhost:${storePort}`, SWAGGER_ENABLED: 'false', LOG_LEVEL: 'silent', COMPOSE_BAKE: 'false', COMPOSE_PARALLEL_LIMIT: '1' };
writeFileSync(envFile, Object.entries(values).map(([key, value]) => key + '=' + value).join('\n') + '\n', { mode: 0o600 });
const override = path.join(output, 'compose.override.yaml');
writeFileSync(override, `services:\n  api:\n    image: ${project}-api:local\n  admin-web:\n    image: ${project}-admin-web:local\n  store-web:\n    image: ${project}-store-web:local\n`);
const composeBase = ['compose', '--project-name', project, '--env-file', envFile, '-f', 'infra/compose.yaml', '-f', override];
const compose = (args, label) => run([...composeBase, ...args], label);
const check = (name, data = {}) => { report.checks.push({ name, ...data }); console.log(JSON.stringify({ passed: name })); };
async function get(origin, route) { return fetch(origin + route, { signal: AbortSignal.timeout(5000) }); }
async function health(origin, kind, status) {
  const response = await get(origin, '/api/v1/health/' + kind); assert.equal(response.status, status);
  const json = await response.json(); assert.equal(json.requestId, response.headers.get('x-request-id'));
  const serialized = JSON.stringify(json); for (const secret of secrets) assert.ok(!serialized.includes(secret)); assert.ok(!serialized.includes('postgresql://'));
  return { status: response.status, requestId: json.requestId };
}
async function waitForHealthy(origin, timeoutMs = 90000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try { if ((await get(origin, '/api/v1/health/ready')).status === 200) return; } catch { /* bounded cold-start retry */ }
    await new Promise(resolveWait => setTimeout(resolveWait, 1000));
  }
  throw new Error('CI API did not become ready before the bounded deadline');
}
let owned = false;
try {
  run(['compose', 'version'], 'Compose availability');
  compose(['config', '--quiet'], 'isolated Compose configuration');
  for (const service of ['api', 'admin-web', 'store-web']) {
    compose(['build', service], 'build production image ' + service);
    const image = project + '-' + service + ':local';
    report.images.push({ service, image, id: run(['image', 'inspect', '--format', '{{.Id}}', image], 'record image ' + service).trim() });
  }
  owned = true; compose(['up', '-d', '--wait', '--wait-timeout', '90', 'db'], 'start new database volume');
  compose(['run', '--no-deps', '--name', project + '-migrate', 'api', 'pnpm', 'db:migrate:deploy'], 'apply all migrations using the production image');
  compose(['up', '-d', '--wait', '--wait-timeout', '150', 'api', 'admin-web', 'store-web'], 'cold start production services');
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  for (const [name, port] of [['admin-web', adminPort], ['store-web', storePort]]) {
    const origin = `http://127.0.0.1:${port}`;
    for (const route of ['/', '/login', '/missing-spa-route']) {
      const response = await get(origin, route); assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/html/);
      const html = await response.text(); assert.match(html, /id="root"/);
      const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(match => match[1]); assert.ok(assets.length > 0);
      for (const asset of assets) { const loaded = await get(origin, asset); assert.equal(loaded.status, 200); assert.match(loaded.headers.get('cache-control'), /immutable/); }
    }
    await health(origin, 'live', 200); await health(origin, 'ready', 200);
    assert.equal((await get(origin, '/api/v1/admin/me/permissions')).status, 401);
    assert.equal((await get(origin, '/uploads/not-public')).status, 404);
    check(name + ' HTML/assets, original API proxy and unauthenticated denial');
  }
  for (const route of ['/api/v1/test/set-time', '/api/v1/test/reset', '/api/v1/test/fail-refund']) assert.equal((await fetch(apiOrigin + route, { method: 'POST', signal: AbortSignal.timeout(5000) })).status, 404);
  check('production image has no test control HTTP route');
  compose(['stop', 'db'], 'stop only this isolated database');
  await health(apiOrigin, 'live', 200); await health(apiOrigin, 'ready', 503);
  check('database unavailable: live 200, ready 503, secret-free response');
  compose(['start', 'db'], 'restart retained database'); await waitForHealthy(apiOrigin);
  await health(apiOrigin, 'ready', 200); check('database restart restores readiness');
  compose(['restart', 'api'], 'restart retained API'); await waitForHealthy(apiOrigin);
  await health(apiOrigin, 'ready', 200); check('API restart retains migration and readiness');
  report.status = 'PASSED';
} catch (error) {
  report.status = 'FAILED'; report.error = redact(error.message); process.exitCode = 1;
} finally {
  if (owned) {
    try { compose(['logs', '--no-color', '--tail', '120'], 'retain isolated service logs'); } catch { /* preserve original failure */ }
    try { compose(['stop', 'admin-web', 'store-web', 'api', 'db'], 'stop only owned services; preserve containers and volumes'); } catch { report.stopFailed = true; report.status = 'FAILED'; process.exitCode = 1; }
  }
  report.endedAt = new Date().toISOString(); writeFileSync(path.join(publicFolder, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ project, status: report.status, evidence: path.relative(root, publicFolder), resourcesRetained: true }));
}
