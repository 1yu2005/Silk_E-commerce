/** 文件作用：编译真实应用并确定性导出契约；--check只检查漂移，不连接数据库或启动服务。 */
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
for (const config of ['packages/shared/tsconfig.json', 'apps/api/tsconfig.build.json']) {
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', config], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0 || result.error) process.exit(result.status ?? 1);
}
Object.assign(process.env, { NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: 'postgresql://contract:contract@127.0.0.1:1/contract',
  JWT_SECRET: 'contract-export-only-virtual-key-2026-0000', CORS_ORIGINS: 'http://localhost:5173,http://localhost:5174' });
const require = createRequire(path.join(root, 'apps/api/package.json')); require('reflect-metadata');
const { NestFactory } = require('@nestjs/core'); const { AppModule } = require('./dist/app.module.js');
const { createOpenApiDocument } = require('./dist/common/swagger.js');
const app = await NestFactory.create(AppModule, { logger: false });
try {
  app.setGlobalPrefix('api/v1'); const spec = createOpenApiDocument(app);
  const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
  const content = JSON.stringify(stable(spec), null, 2) + '\n';
  const target = path.resolve(root, process.argv.find(arg => arg.startsWith('--output='))?.slice(9) ?? 'docs/openapi/openapi.json');
  if (process.argv.includes('--check')) {
    const old = await readFile(target, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
    if (old.replaceAll('\r\n', '\n') !== content) throw new Error('OpenAPI与源码有差异，请运行pnpm openapi:export');
  } else { await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content); }
  console.log(JSON.stringify({ mode: process.argv.includes('--check') ? 'check' : 'export', databaseConnected: false,
    operations: Object.values(spec.paths).reduce((count, item) => count + Object.keys(item).filter(key => ['get','post','put','patch','delete'].includes(key)).length, 0) }));
} finally { await app.close(); }
