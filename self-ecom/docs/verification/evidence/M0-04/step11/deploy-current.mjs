// 作用：将已独立验收的同一镜像部署到现有四服务，保留数据库/上传卷与账号；只读验证，不重复seed或写业务数据。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
const directory = 'docs/verification/evidence/M0-04/step11'; const destination = directory + '/deployment.json';
assert.ok(!existsSync(destination), '不能覆盖部署证据');
const acceptancePath = process.argv[2]; assert.ok(acceptancePath);
const acceptance = JSON.parse(readFileSync(acceptancePath, 'utf8')); assert.equal(acceptance.status, 'passed');
assert.ok(acceptance.cleaned && acceptance.originalResourcesPreserved); assert.match(acceptance.imagePrefix, /^self-ecom-m004-acceptance-[a-f0-9]{8}$/);
const env = { ...parseEnv(readFileSync('.env', 'utf8')), ...process.env }; const docker = env.DOCKER_EXECUTABLE;
assert.ok(docker); const commands = [];
const redact = output => Object.entries(env).filter(([key, value]) => /PASSWORD|SECRET|DATABASE_URL|TOKEN/.test(key) && value?.length > 5)
  .reduce((text, [, value]) => text.replaceAll(value, '[REDACTED]'), output);
const run = (args, name) => {
  const result = spawnSync(docker, args, { env, windowsHide: true, encoding: 'utf8', timeout: 180000, maxBuffer: 10 * 1024 * 1024 });
  // inspect只保存状态和卷归属；完整Config.Env仅留在当前内存，禁止把运行密钥写入证据。
  const inspection = args[0] === 'inspect' && result.status === 0 ? JSON.stringify(JSON.parse(result.stdout).map(container => ({
    Id: container.Id, Name: container.Name, Image: container.Image, State: container.State, Mounts: container.Mounts,
  })), null, 2) : null;
  const output = redact(inspection ?? (result.stdout ?? '') + (result.stderr ?? '')); writeFileSync(`${directory}/deployment-${name}.txt`, output);
  commands.push({ name, exitCode: result.status }); assert.equal(result.status, 0, '部署步骤失败：' + name); assert.ok(!result.error); console.log(JSON.stringify({ step: name, passed: true }));
  return result.stdout.trim();
};
const base = ['compose', '--project-name', 'self-ecom', '--env-file', resolve('.env'), '-f', resolve('infra/compose.yaml')];
run([...base, 'config', '--quiet'], 'configuration');
const before = JSON.parse(run(['inspect', 'self-ecom-db-1'], 'database-before'))[0];
const volumeNames = before.Mounts.filter(mount => mount.Type === 'volume').map(mount => mount.Name);
assert.deepEqual(volumeNames, ['self-ecom_db_data']);
const images = [];
for (const [source, target] of [['api', 'api'], ['admin', 'admin-web'], ['store', 'store-web']]) {
  const verified = `${acceptance.imagePrefix}-${source}:local`; const deployed = `self-ecom-${target}:local`;
  run(['tag', verified, deployed], 'tag-' + target);
  const digest = run(['image', 'inspect', '--format', '{{.Id}}', verified], 'image-' + target);
  assert.equal(run(['image', 'inspect', '--format', '{{.Id}}', deployed], 'tag-check-' + target), digest);
  images.push({ service: target, verified, deployed, digest });
}
run([...base, 'run', '--rm', '--no-deps', 'api', 'pnpm', 'db:migrate:status'], 'migration-status');
run([...base, 'up', '-d', '--no-deps', '--wait', '--wait-timeout', '120', 'api', 'admin-web', 'store-web'], 'start-applications');
const after = JSON.parse(run(['inspect', 'self-ecom-db-1'], 'database-after'))[0];
assert.equal(after.Id, before.Id); assert.equal(after.State.StartedAt, before.State.StartedAt);
const endpoints = [];
for (const [port, path] of [[env.API_HOST_PORT || '3000', '/api/v1/health/ready'], [env.API_HOST_PORT || '3000', '/api/docs-json'],
  [env.ADMIN_HOST_PORT || '8080', '/tasks'], [env.ADMIN_HOST_PORT || '8080', '/settings'], [env.STORE_HOST_PORT || '8081', '/'],
  [env.STORE_HOST_PORT || '8081', '/api/v1/store/contact']]) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(8000) }); assert.equal(response.status, 200);
  const row = { port: Number(port), path, status: response.status, requestId: response.headers.get('x-request-id') };
  if (path.endsWith('docs-json')) {
    const schema = await response.json(); row.operations = Object.values(schema.paths).reduce((sum, item) => sum + Object.keys(item).filter(method => ['get', 'put', 'post', 'patch', 'delete'].includes(method)).length, 0); assert.equal(row.operations, 40);
  }
  if (path.endsWith('/store/contact')) { row.data = (await response.json()).data; assert.deepEqual(row.data, { configured: false, servicePhone: null, serviceHours: null, settingsVersion: 0 }); }
  endpoints.push(row);
}
const containers = JSON.parse(run(['inspect', 'self-ecom-db-1', 'self-ecom-api-1', 'self-ecom-admin-web-1', 'self-ecom-store-web-1'], 'containers'))
  .map(container => ({ name: container.Name, image: container.Image, running: container.State.Running, health: container.State.Health?.Status }));
assert.ok(containers.every(container => container.running && container.health === 'healthy'));
const report = { checkedAt: new Date().toISOString(), passed: true, acceptance: acceptancePath, images, endpoints, containers, commands,
  databaseContainerUnchanged: true, databaseVolumePreserved: true, noSeedsOrBusinessWrites: true };
writeFileSync(destination, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ passed: true, containers: containers.length, endpoints: endpoints.length, databaseUnchanged: true }));
