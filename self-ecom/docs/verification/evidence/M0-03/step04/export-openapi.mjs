// 作用：从本次编译应用导出头像与文件契约，不连接数据库或启动清理任务。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
const require = createRequire(resolve('apps/api/package.json'));
require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require(resolve('apps/api/dist/app.module.js'));
const { createOpenApiDocument } = require(resolve('apps/api/dist/common/swagger.js'));
const app = await NestFactory.create(AppModule, { logger: false });
try {
  app.setGlobalPrefix('api/v1'); const document = createOpenApiDocument(app);
  assert.ok(document.paths['/api/v1/store/me/avatar']?.put);
  assert.ok(document.paths['/api/v1/store/me/avatar']?.delete);
  assert.ok(document.paths['/api/v1/files']?.post?.requestBody?.content?.['multipart/form-data']);
  assert.ok(document.paths['/api/v1/files/{id}/content']?.get?.responses?.['200']?.content?.['image/png']);
  const operations = Object.values(document.paths).reduce((count, item) => count + Object.keys(item)
    .filter(key => ['get', 'post', 'put', 'patch', 'delete'].includes(key)).length, 0);
  assert.equal(operations, 27);
  writeFileSync('docs/openapi/openapi.json', JSON.stringify(document, null, 2) + '\n');
  const result = { node: process.version, timestamp: new Date().toISOString(), source: '本次编译应用', operations,
    avatarCommands: true, multipart: true, binary: true, databaseConnected: false };
  writeFileSync('docs/verification/evidence/M0-03/step04/openapi.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally { await app.close(); }
