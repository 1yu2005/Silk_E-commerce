// 作用：从本次实际编译的应用导出文件API契约；不初始化数据库、不监听端口、不触发清理任务。
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
  if (!document.paths['/api/v1/files']?.post?.requestBody?.content?.['multipart/form-data']
    || !document.paths['/api/v1/files/{id}/content']?.get?.responses?.['200']?.content?.['image/png']) throw new Error('文件API契约缺失');
  writeFileSync('docs/openapi/openapi.json', JSON.stringify(document, null, 2) + '\n');
  const result = { node: process.version, timestamp: new Date().toISOString(), source: '本次编译应用',
    operations: Object.values(document.paths).reduce((count, item) => count + Object.keys(item).filter(key => ['get', 'post', 'put', 'patch', 'delete'].includes(key)).length, 0),
    multipart: true, binary: true, databaseConnected: false };
  writeFileSync('docs/verification/evidence/M0-03/step03/openapi.json', JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result));
} finally { await app.close(); }
