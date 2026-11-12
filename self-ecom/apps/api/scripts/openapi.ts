// 作用：启动仅用于契约导出的应用上下文，写出与真实路由一致的 OpenAPI 文档。
import 'reflect-metadata';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';
import { createOpenApiDocument } from '../src/common/swagger.js';

async function exportDocument() {
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    app.setGlobalPrefix('api/v1');
    // 不初始化应用或监听端口，生成接口契约时不连接 PostgreSQL。
    const document = createOpenApiDocument(app);
    const directory = resolve(__dirname, '../../../docs/openapi');
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, 'openapi.json'), `${JSON.stringify(document, null, 2)}\n`);
    console.log('OpenAPI已导出至docs/openapi/openapi.json');
  } finally {
    await app.close();
  }
}

void exportDocument().catch(() => {
  console.error('OpenAPI导出失败，请检查配置和接口声明');
  process.exitCode = 1;
});
