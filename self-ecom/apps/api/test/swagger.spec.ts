import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/common/configure-app.js';
import { APP_CONFIG, validateEnvironment } from '../src/config/environment.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type { OpenAPIObject } from '@nestjs/swagger';

it.each([true, false])('serves native Swagger documents only when enabled=%s', async enabled => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG).useValue(validateEnvironment({ NODE_ENV: 'test', LOG_LEVEL: 'silent',
      DATABASE_URL: 'postgresql://test:test@localhost:15432/shop_test',
      CORS_ORIGINS: 'http://localhost:5173,http://localhost:5174', SWAGGER_ENABLED: String(enabled) }))
    .overrideProvider(PrismaService).useValue({ ping: async () => {} }).compile();
  const app: INestApplication = module.createNestApplication();
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  try {
    const url = await app.getUrl();
    for (const path of ['/api/docs', '/api/docs-json']) {
      const response = await fetch(`${url}${path}`);
      expect(response.status).toBe(enabled ? 200 : 404);
      expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
      if (!enabled) {
        expect((await response.json() as { code: string }).code).toBe('NOT_FOUND');
      } else if (path.endsWith('-json')) {
        const doc = await response.json() as OpenAPIObject;
        expect(doc.openapi).toMatch(/^3\./);
        expect(doc).not.toHaveProperty('data');
        expect(doc.servers).toEqual([{ url: '/' }]);
        expect(Object.keys(doc.paths).sort()).toEqual(['/api/v1/health/live', '/api/v1/health/ready']);
        const live = doc.paths['/api/v1/health/live']!.get!;
        const ready = doc.paths['/api/v1/health/ready']!.get!;
        expect(live.operationId).toBe('getLiveness');
        expect(ready.operationId).toBe('getReadiness');
        expect(ready.tags).toEqual(['Health']);
        expect(ready.responses).toHaveProperty('503');
        expect(JSON.stringify(live.responses)).toContain('X-Request-Id');
        expect(JSON.stringify(live.responses)).toContain('date-time');
        expect(JSON.stringify(live.responses)).toContain('requestId');
        expect(doc.components?.securitySchemes ?? {}).toEqual({});
      } else {
        expect(response.headers.get('content-type')).toContain('text/html');
        expect(await response.text()).toContain('swagger-ui');
      }
    }
    if (enabled) {
      const asset = await fetch(`${url}/api/docs/swagger-ui-bundle.js`);
      expect(asset.status).toBe(200);
      expect((await asset.text()).length).toBeGreaterThan(1000);
    }
    expect((await fetch(`${url}/api/v1/api/docs`)).status).toBe(404);
    expect((await fetch(`${url}/api/docs-yaml`)).status).toBe(404);
  } finally { await app.close(); }
});
