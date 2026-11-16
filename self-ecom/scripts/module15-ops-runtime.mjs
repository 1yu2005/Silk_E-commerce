// 作用：运维工具的显式配置、Docker身份、保留现场命令和完整私有文件校验；不加载根.env。
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { OpsError, requireCondition } from './module15-ops-snapshot.mjs';

export const ROOT = process.cwd();
export const SERVICES = ['db', 'api', 'admin-web', 'store-web'];
const systemKeys = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'DOCKER_CONFIG', 'DOCKER_HOST', 'DOCKER_CONTEXT']);
export const safeEnvironment = (values = {}, inherited = process.env) => ({ ...Object.fromEntries(Object.entries(inherited).filter(([key]) => systemKeys.has(key.toUpperCase()))), ...values });
export const defaultDockerExecutable = (platform = process.platform, localAppData = process.env.LOCALAPPDATA ?? '') => platform === 'win32' ? path.join(localAppData, 'Programs/DockerDesktop/resources/bin/docker.exe') : 'docker';
export const secretRedactor = values => text => Object.entries(values).filter(([key, value]) => /PASSWORD|SECRET|TOKEN|DATABASE_URL/.test(key) && typeof value === 'string' && value).reduce((out, [, value]) => out.replaceAll(value, '[REDACTED]'), String(text)).replace(/postgres(?:ql)?:\/\/[^\s"'\x60]+/g, '[REDACTED_DATABASE_URL]');
export const equalJson = (a, b, code) => requireCondition(JSON.stringify(a) === JSON.stringify(b), code);
export function jsonFile(file) { const stat = lstatSync(noLinkPath(file)); requireCondition(stat.isFile() && !stat.isSymbolicLink(), 'JSON_FILE_INVALID'); return JSON.parse(readFileSync(file, 'utf8')); }
export function writeNewJson(file, data) { writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
export const unique = prefix => prefix + '-' + randomUUID().slice(0, 8);
export function projectName(value) { requireCondition(/^[a-z][a-z0-9-]{2,62}$/.test(value ?? ''), 'PROJECT_INVALID'); return value; }
export function noLinkPath(value) {
  const absolute = path.resolve(value), relative = path.relative(ROOT, absolute);
  requireCondition(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'PATH_OUTSIDE_WORKSPACE');
  let current = ROOT;
  for (const part of relative.split(path.sep)) { current = path.join(current, part); if (existsSync(current)) requireCondition(!lstatSync(current).isSymbolicLink(), 'SYMLINK_PATH_REFUSED'); }
  return absolute;
}
export async function privatePath(value, { directory = false, fresh = false } = {}) {
  const absolute = noLinkPath(value);
  if (fresh) requireCondition(!existsSync(absolute), 'OUTPUT_ALREADY_EXISTS');
  const checked = await command('git', ['check-ignore', '--quiet', directory ? path.join(absolute, '.m415-private-check') : absolute], { env: safeEnvironment(), allowFailure: true });
  requireCondition(checked.exitCode === 0, 'PRIVATE_PATH_MUST_BE_IGNORED');
  if (directory) mkdirSync(absolute, { recursive: true, mode: 0o700 });
  return absolute;
}
export function readConfig(file, project, { restore = false } = {}) {
  projectName(project);
  const envFile = noLinkPath(file); requireCondition(existsSync(envFile) && lstatSync(envFile).isFile(), 'ENV_FILE_REQUIRED');
  const values = parseEnv(readFileSync(envFile, 'utf8'));
  for (const key of ['POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'JWT_SECRET']) requireCondition(typeof values[key] === 'string' && values[key].length > 0, 'MISSING_' + key);
  requireCondition(/^[a-z][a-z0-9_]{2,62}$/.test(values.POSTGRES_DB) && !['postgres', 'template0', 'template1'].includes(values.POSTGRES_DB), 'DATABASE_NAME_INVALID');
  requireCondition(/^[a-z][a-z0-9_]{0,62}$/.test(values.POSTGRES_USER), 'DATABASE_USER_INVALID');
  requireCondition(values.JWT_SECRET.length >= 32, 'JWT_SECRET_INVALID');
  for (const value of Object.values(values)) requireCondition(!value.includes('${'), 'ENV_INTERPOLATION_REFUSED');
  const defaults = { DB_HOST_PORT: '15432', API_HOST_PORT: '3000', ADMIN_HOST_PORT: '8080', STORE_HOST_PORT: '8081' };
  for (const [key, fallback] of Object.entries(defaults)) {
    if (restore) requireCondition(values[key] !== undefined, 'RESTORE_PORT_REQUIRED');
    values[key] ??= fallback;
    requireCondition(/^\d{1,5}$/.test(values[key]) && +values[key] > 0 && +values[key] < 65536, 'PORT_INVALID');
  }
  requireCondition(new Set(Object.keys(defaults).map(key => values[key])).size === 4, 'PORTS_MUST_BE_DISTINCT');
  if (restore) {
    requireCondition(/restore/.test(project) && project !== 'self-ecom', 'RESTORE_PROJECT_REQUIRED');
    requireCondition(/restore/.test(values.POSTGRES_DB), 'RESTORE_DATABASE_REQUIRED');
    if (values.RESTORE_PROJECT) requireCondition(values.RESTORE_PROJECT === project, 'RESTORE_PROJECT_MISMATCH');
    if (values.RESTORE_DATABASE_NAME) requireCondition(values.RESTORE_DATABASE_NAME === values.POSTGRES_DB, 'RESTORE_DATABASE_MISMATCH');
  }
  const hostUrl = new URL('postgresql://127.0.0.1:' + values.DB_HOST_PORT + '/' + values.POSTGRES_DB);
  hostUrl.username = values.POSTGRES_USER; hostUrl.password = values.POSTGRES_PASSWORD;
  const internalUrl = new URL(hostUrl); internalUrl.hostname = 'db'; internalUrl.port = '5432';
  values.DATABASE_URL = hostUrl.href;
  values.COMPOSE_CORS_ORIGINS = 'http://localhost:' + values.ADMIN_HOST_PORT + ',http://localhost:' + values.STORE_HOST_PORT;
  return { project, envFile, values, hostUrl: hostUrl.href, internalUrl: internalUrl.href, redact: secretRedactor(values), docker: values.DOCKER_EXECUTABLE ?? process.env.DOCKER_EXECUTABLE ?? defaultDockerExecutable(), env: safeEnvironment(values) };
}

export async function command(executable, args, { env = safeEnvironment(), input, allowFailure = false, timeout = 600_000 } = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', overflow = false;
    const timer = setTimeout(() => { child.kill(); }, timeout);
    child.stdout.on('data', bytes => { stdout += bytes; if (Buffer.byteLength(stdout) > 128 * 1024 * 1024) { overflow = true; child.kill(); } });
    child.stderr.on('data', bytes => { stderr += bytes; if (Buffer.byteLength(stderr) > 16 * 1024 * 1024) { overflow = true; child.kill(); } });
    child.on('error', () => { clearTimeout(timer); reject(new OpsError('COMMAND_UNAVAILABLE')); });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      if (overflow) { reject(new OpsError('COMMAND_OUTPUT_LIMIT')); return; }
      const result = { exitCode, signal, stdout, stderr };
      if (exitCode !== 0 && !allowFailure) reject(new OpsError('COMMAND_FAILED')); else resolve(result);
    });
    child.stdin.on('error', () => undefined); child.stdin.end(input);
  });
}

export class DockerRuntime {
  constructor(config, report, logFile) { this.config = config; this.report = report; this.logFile = logFile; this.interrupted = false; }
  async run(args, label, { input, allowFailure = false, recovery = false } = {}) {
    if (!recovery) requireCondition(!this.interrupted, 'INTERRUPTED');
    const startedAt = new Date().toISOString();
    const result = await command(this.config.docker, args, { env: this.config.env, input, allowFailure: true });
    this.report.commands.push({ label, startedAt, endedAt: new Date().toISOString(), exitCode: result.exitCode, signal: result.signal });
    if (this.logFile) writeFileSync(this.logFile, JSON.stringify({ label, exitCode: result.exitCode, stderrBytes: Buffer.byteLength(result.stderr), stderrSha256: createHash('sha256').update(result.stderr).digest('hex') }) + '\n', { flag: 'a', mode: 0o600 });
    requireCondition(allowFailure || result.exitCode === 0, 'DOCKER_' + label.replace(/[^A-Z0-9_]/gi, '_').toUpperCase());
    if (!recovery) requireCondition(!this.interrupted, 'INTERRUPTED');
    return result.stdout.trim();
  }
  async inspect(id) { return JSON.parse(await this.run(['inspect', '--format', '{{json .}}', id], 'inspect_container')); }
  async service(service) {
    const ids = (await this.run(['ps', '-a', '--filter', 'label=com.docker.compose.project=' + this.config.project, '--filter', 'label=com.docker.compose.service=' + service, '--filter', 'label=com.docker.compose.oneoff=False', '--format', '{{.ID}}'], 'resolve_' + service)).split(/\s+/).filter(Boolean);
    requireCondition(ids.length === 1, 'SERVICE_NOT_UNIQUE_' + service);
    const container = await this.inspect(ids[0]);
    requireCondition(container.Config.Labels['com.docker.compose.project'] === this.config.project && container.Config.Labels['com.docker.compose.service'] === service, 'CONTAINER_LABEL_MISMATCH');
    return container;
  }
  async volume(container, destination, key) {
    const mounts = container.Mounts.filter(mount => mount.Destination === destination);
    requireCondition(mounts.length === 1 && mounts[0].Type === 'volume' && mounts[0].Name, 'NAMED_VOLUME_REQUIRED');
    const volume = JSON.parse(await this.run(['volume', 'inspect', '--format', '{{json .}}', mounts[0].Name], 'inspect_volume'));
    requireCondition(volume.Labels?.['com.docker.compose.project'] === this.config.project && volume.Labels?.['com.docker.compose.volume'] === key && volume.Driver === 'local', 'VOLUME_LABEL_OR_DRIVER_MISMATCH');
    return { name: volume.Name, driver: volume.Driver, destination };
  }
  composeArgs(override) { return ['compose', '--project-name', this.config.project, '--project-directory', ROOT, '--env-file', this.config.envFile, '-f', path.join(ROOT, 'infra/compose.yaml'), ...(override ? ['-f', override] : [])]; }
  async compose(args, override, label) { return this.run([...this.composeArgs(override), ...args], label); }
  async validateCompose(override) {
    const model = JSON.parse(await this.compose(['config', '--format', 'json'], override, 'validate_compose'));
    requireCondition(model.name === this.config.project, 'COMPOSE_PROJECT_MISMATCH');
    for (const [key, volume] of Object.entries(model.volumes ?? {})) requireCondition(!volume.external && volume.name === this.config.project + '_' + key && !volume.driver_opts, 'COMPOSE_VOLUME_UNSAFE');
    requireCondition(model.services.api.environment.DATABASE_URL === this.config.internalUrl, 'COMPOSE_DATABASE_MISMATCH');
    for (const [service, key] of [['db', 'DB_HOST_PORT'], ['api', 'API_HOST_PORT'], ['admin-web', 'ADMIN_HOST_PORT'], ['store-web', 'STORE_HOST_PORT']]) {
      const ports = model.services[service].ports;
      requireCondition(ports?.length === 1 && ports[0].host_ip === '127.0.0.1' && String(ports[0].published) === this.config.values[key], 'COMPOSE_PORT_MISMATCH');
    }
    return model;
  }
}

export const safeContainer = container => ({ id: container.Id, image: container.Image, user: container.Config.User, running: container.State.Running, startedAt: container.State.StartedAt, ports: Object.values(container.HostConfig?.PortBindings ?? {}).flatMap(rows => (rows ?? []).map(row => row.HostPort)).sort(), mounts: container.Mounts.map(mount => ({ name: mount.Name, type: mount.Type, destination: mount.Destination })) });
export async function connectedClient(config) {
  const { Client } = createRequire(path.join(ROOT, 'apps/api/package.json'))('pg');
  const client = new Client({ connectionString: config.hostUrl, connectionTimeoutMillis: 5000, statement_timeout: 300_000, query_timeout: 310_000, application_name: 'self-ecom-m415-ops', options: '-c timezone=UTC -c default_transaction_read_only=on' });
  await client.connect(); return client;
}
export async function noOtherClients(client) {
  const rows = (await client.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'")).rows;
  requireCondition(rows.length === 0, 'UNKNOWN_DATABASE_CLIENTS');
}
export function validRelative(value) { return typeof value === 'string' && (value === '' || value.split('/').every(part => part && part !== '.' && part !== '..' && !part.endsWith('.') && !part.endsWith(' ') && !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part) && !/[\\:<>|"?*]/.test(part) && ![...part].some(character => character.charCodeAt(0) < 32))); }
export async function hashFile(file) { const stat = lstatSync(noLinkPath(file)); requireCondition(stat.isFile() && !stat.isSymbolicLink(), 'HASH_FILE_INVALID'); const hash = createHash('sha256'); for await (const bytes of createReadStream(file)) hash.update(bytes); return hash.digest('hex'); }
export async function localTree(root) {
  requireCondition(existsSync(root) && lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink(), 'UPLOAD_ROOT_INVALID');
  const files = [], directories = [];
  async function visit(relative) {
    requireCondition(validRelative(relative), 'UNSAFE_FILE_PATH');
    const absolute = path.join(root, relative), stat = lstatSync(absolute);
    requireCondition(!stat.isSymbolicLink(), 'UPLOAD_LINK_REFUSED');
    if (stat.isDirectory()) {
      directories.push({ path: relative, mode: stat.mode & 0o777, mtimeMs: stat.mtimeMs });
      for (const name of readdirSync(absolute).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) await visit(relative ? relative + '/' + name : name);
    } else {
      requireCondition(stat.isFile(), 'UPLOAD_SPECIAL_FILE_REFUSED');
      files.push({ path: relative, size: String(stat.size), sha256: await hashFile(absolute), mode: stat.mode & 0o777, mtimeMs: stat.mtimeMs });
    }
  }
  await visit(''); return { directories, files };
}
export const contentTree = tree => ({ directories: tree.directories.map(row => row.path), files: tree.files.map(({ path: file, size, sha256 }) => ({ path: file, size, sha256 })) });
export function assertSameTree(actual, expected) { equalJson(contentTree(actual), contentTree(expected), 'UPLOAD_CONTENT_MISMATCH'); }
export function verifyMigrationFiles(rows, migrations) {
  const map = new Map(migrations.map(row => [row.name, row.sha256]));
  requireCondition(rows.every(row => map.get(row.migration_name) === row.checksum), 'IMAGE_MIGRATION_CHECKSUM_MISMATCH');
}

export const helperProgram = String.raw`
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
(async()=>{let input='';for await(const chunk of process.stdin)input+=chunk;const options=JSON.parse(input||'{}'),root='/volume';
const check=p=>{if(p!==''&&!p.split('/').every(x=>x&&x!=='.'&&x!=='..'&&!x.endsWith('.')&&!x.endsWith(' ')&&!/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(x)&&!/[\\:\x00-\x1f<>|"?*]/.test(x)))throw Error('PATH');};
const files=[],directories=[];async function walk(relative){check(relative);const full=path.join(root,relative),s=fs.lstatSync(full);if(s.isSymbolicLink())throw Error('LINK');if(s.isDirectory()){directories.push({path:relative,mode:s.mode&511,mtimeMs:s.mtimeMs});for(const name of fs.readdirSync(full).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))))await walk(relative?relative+'/'+name:name);}else{if(!s.isFile())throw Error('TYPE');const h=crypto.createHash('sha256');for await(const bytes of fs.createReadStream(full))h.update(bytes);files.push({path:relative,size:String(s.size),sha256:h.digest('hex'),mode:s.mode&511,mtimeMs:s.mtimeMs});}}
if(options.mode==='identity'){console.log(JSON.stringify({uid:process.getuid(),gid:process.getgid()}));return;}
if(options.mode==='migrations'){const p='/app/prisma/migrations',rows=[];for(const name of fs.readdirSync(p).filter(n=>/^\d{4}_/.test(n)).sort()){const file=path.join(p,name,'migration.sql');rows.push({name,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});}console.log(JSON.stringify(rows));return;}
await walk('');
if(options.mode==='fix'){if(process.getuid()!==0||!Number.isSafeInteger(options.uid)||options.uid===0||!Number.isSafeInteger(options.gid))throw Error('USER');const expected=options.tree;const simplify=t=>JSON.stringify({directories:t.directories.map(r=>r.path),files:t.files.map(({path,size,sha256})=>({path,size,sha256}))});if(simplify({files,directories})!==simplify(expected))throw Error('CONTENT');for(const entry of [...expected.files,...expected.directories].reverse()){check(entry.path);const full=path.join(root,entry.path);if(fs.lstatSync(full).isSymbolicLink())throw Error('LINK');fs.chownSync(full,options.uid,options.gid);fs.chmodSync(full,entry.mode);fs.utimesSync(full,new Date(entry.mtimeMs),new Date(entry.mtimeMs));}console.log(JSON.stringify({fixed:true}));return;}
console.log(JSON.stringify({files,directories}));
})().catch(()=>{console.error('MAINTENANCE_HELPER_FAILED');process.exitCode=1;});
`;
export async function helper(runtime, image, { volume, writable = false, root = false, input = { mode: 'scan' } } = {}) {
  const name = unique('self-ecom-m415-helper');
  const args = ['create', '--name', name, '--interactive', '--network', 'none', '--read-only', '--no-healthcheck', '--label', 'self-ecom.module15.helper=' + runtime.config.project, ...(root ? ['--user', '0:0'] : []), ...(volume ? ['--mount', 'type=volume,src=' + volume + ',dst=/volume' + (writable ? '' : ',readonly')] : []), '--entrypoint', 'node', image, '-e', helperProgram];
  const id = await runtime.run(args, 'create_retained_helper');
  runtime.report.helpers ??= []; runtime.report.helpers.push({ id, name, volume, writable, root });
  return JSON.parse(await runtime.run(['start', '--attach', '--interactive', id], 'run_retained_helper', { input: JSON.stringify(input) }));
}
export async function waitReady(runtime, containerId) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const container = await runtime.inspect(containerId);
    requireCondition(container.State.Running, 'SERVICE_STOPPED_WHILE_WAITING');
    if (container.State.Health?.Status === 'healthy') return;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new OpsError('SERVICE_READY_TIMEOUT');
}
export async function assertNewProject(runtime) {
  for (const args of [['ps', '-a', '--filter', 'label=com.docker.compose.project=' + runtime.config.project, '-q'], ['volume', 'ls', '--filter', 'label=com.docker.compose.project=' + runtime.config.project, '-q'], ['network', 'ls', '--filter', 'label=com.docker.compose.project=' + runtime.config.project, '-q']]) requireCondition(!(await runtime.run(args, 'reject_existing_target')).trim(), 'RESTORE_PROJECT_ALREADY_EXISTS');
  const volumeNames = (await runtime.run(['volume', 'ls', '--format', '{{.Name}}'], 'reject_unlabelled_target_volumes')).split(/\s+/);
  requireCondition(!['db_data', 'uploads'].some(name => volumeNames.includes(runtime.config.project + '_' + name)), 'RESTORE_VOLUME_NAME_ALREADY_EXISTS');
  const networkNames = (await runtime.run(['network', 'ls', '--format', '{{.Name}}'], 'reject_unlabelled_target_network')).split(/\s+/);
  requireCondition(!networkNames.includes(runtime.config.project + '_default'), 'RESTORE_NETWORK_NAME_ALREADY_EXISTS');
}
export function requireFresh(file) { requireCondition(!existsSync(file), 'OUTPUT_ALREADY_EXISTS'); }
export function existingRealPath(file) { const absolute = noLinkPath(file); requireCondition(existsSync(absolute), 'INPUT_NOT_FOUND'); return realpathSync(absolute); }
