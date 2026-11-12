// 作用：验证真实应用装配、公共健康检查、响应与日志约定及生产路由边界。
import 'reflect-metadata';
import { Controller, Get, HttpException, type INestApplication, StreamableFile } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/common/configure-app.js';
import { APP_CONFIG, validateEnvironment } from '../src/config/environment.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// 这些路由仅存在于测试应用中，不会注册到 AppModule。
@Controller('contract-test')
class ContractTestController {
  @Get('data-field')
  getDataField() {
    return { data: 'business-value', requestId: 'business-value' };
  }

  @Get('failure')
  fail() {
    throw new Error('private-database-connection-string');
  }

  @Get('http-failure')
  failHttp() {
    throw new HttpException('private-sql-details', 500);
  }

  @Get('file')
  getFile() {
    return new StreamableFile(Buffer.from('file-content'), { type: 'text/plain' });
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let app: INestApplication;
let baseUrl: string;
const ping = vi.fn<() => Promise<void>>();
beforeEach(() => { ping.mockReset().mockResolvedValue(); });

beforeAll(async () => {
  const module = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [ContractTestController],
  }).overrideProvider(APP_CONFIG).useValue(validateEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/shop_test',
    CORS_ORIGINS: 'http://localhost:5173,http://localhost:5174',
  })).overrideProvider(PrismaService).useValue({ ping }).compile();
  app = module.createNestApplication();
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
});

afterAll(async () => { await app?.close(); });

it('reports liveness without requiring a database', async () => {
  const before = Date.now();
  const response = await fetch(`${baseUrl}/api/v1/health/live`);
  const body = await response.json() as {
    data: { status: string; service: string; timestamp: string };
    requestId: string;
  };

  expect(response.status).toBe(200);
  expect(Object.keys(body).sort()).toEqual(['data', 'requestId']);
  expect(body.data.status).toBe('ok');
  expect(body.data.service).toBe('shop-api');
  expect(body.data.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(Date.parse(body.data.timestamp)).toBeGreaterThanOrEqual(before);
  expect(Date.parse(body.data.timestamp)).toBeLessThanOrEqual(Date.now());
  expect(body.requestId).toMatch(uuidPattern);
  expect(response.headers.get('x-request-id')).toBe(body.requestId);
});

it('returns a readiness envelope after a successful database check', async () => {
  const response = await fetch(`${baseUrl}/api/v1/health/ready`);
  const body = await response.json() as {
    data: { status: string; checks: { database: string }; timestamp: string };
    requestId: string;
  };
  expect(response.status).toBe(200);
  expect(body.data.status).toBe('ready');
  expect(body.data.checks).toEqual({ database: 'up' });
  expect(body.data.timestamp).toMatch(/Z$/);
  expect(Number.isFinite(Date.parse(body.data.timestamp))).toBe(true);
  expect(ping).toHaveBeenCalledTimes(1);
  expect(body.requestId).toBe(response.headers.get('x-request-id'));
});

it('returns only safe database details on readiness failure and keeps liveness independent', async () => {
  ping.mockRejectedValue(new Error('private SQL postgres://secret@internal-host/database'));
  const response = await fetch(`${baseUrl}/api/v1/health/ready`);
  const body = await response.json() as { code: string; details: unknown; requestId: string };
  expect(response.status).toBe(503);
  expect(body).toEqual({ code: 'SERVICE_NOT_READY', message: '服务暂未就绪',
    details: { database: 'unavailable' }, requestId: expect.stringMatching(uuidPattern) });
  expect(body.requestId).toBe(response.headers.get('x-request-id'));
  expect(JSON.stringify(body)).not.toContain('private');
  ping.mockClear();
  expect((await fetch(`${baseUrl}/api/v1/health/live`)).status).toBe(200);
  expect(ping).not.toHaveBeenCalled();
});

it('does not expose liveness without the API prefix', async () => {
  const response = await fetch(`${baseUrl}/health/live`);
  expect(response.status).toBe(404);
});

it('does not register authentication test fixtures', async () => {
  const path = '/guard-public';
  const response = await fetch(`${baseUrl}/api/v1${path}`);
  expect(response.status).toBe(404);
});

it('requires a Bearer token at the real customer profile endpoint', async () => {
  const response = await fetch(`${baseUrl}/api/v1/store/me`);
  expect(response.status).toBe(401); expect((await response.json() as { code: string }).code).toBe('TOKEN_INVALID');
});

it('requires a Bearer token at the real logout endpoint', async () => {
  const response = await fetch(`${baseUrl}/api/v1/auth/logout`, { method: 'POST' });
  expect(response.status).toBe(401);
  expect((await response.json() as { code: string }).code).toBe('TOKEN_INVALID');
});

it('requires a Bearer token at the real employee profile endpoint', async () => {
  const response = await fetch(`${baseUrl}/api/v1/admin/me`);
  expect(response.status).toBe(401);
  expect((await response.json() as { code: string }).code).toBe('TOKEN_INVALID');
});

it('starts an HTTP server and rejects an unimplemented route', async () => {
  const response = await fetch(`${baseUrl}/api/v1/not-implemented`);
  expect(response.status).toBe(404);
  expect(response.headers.get('content-type')).toContain('application/json');
  const body = await response.json() as { code: string; message: string; requestId: string };
  expect(body.code).toBe('NOT_FOUND');
  expect(body.requestId).toMatch(uuidPattern);
  expect(response.headers.get('x-request-id')).toBe(body.requestId);
});

it('generates a fresh request ID and ignores caller-supplied IDs', async () => {
  const suppliedId = '00000000-0000-4000-8000-000000000000';
  const responses = await Promise.all(Array.from({ length: 10 }, () => fetch(
    `${baseUrl}/api/v1/health/live`, { headers: { 'X-Request-Id': suppliedId } },
  )));
  const ids = await Promise.all(responses.map(async response => {
    const body = await response.json() as { requestId: string };
    expect(body.requestId).toMatch(uuidPattern);
    expect(body.requestId).not.toBe(suppliedId);
    expect(response.headers.get('x-request-id')).toBe(body.requestId);
    return body.requestId;
  }));
  expect(new Set(ids).size).toBe(10);
});

it('wraps once without mistaking business data fields for an existing envelope', async () => {
  const response = await fetch(`${baseUrl}/api/v1/contract-test/data-field`);
  const body = await response.json() as { data: unknown; requestId: string };
  expect(body.data).toEqual({ data: 'business-value', requestId: 'business-value' });
  expect(body.requestId).toBe(response.headers.get('x-request-id'));
});

it.each(['failure', 'http-failure'])('sanitizes internal errors from %s', async route => {
  const response = await fetch(`${baseUrl}/api/v1/contract-test/${route}`);
  expect(response.status).toBe(500);
  const body = await response.json() as { code: string; message: string; requestId: string };
  expect(Object.keys(body).sort()).toEqual(['code', 'message', 'requestId']);
  expect(body.code).toBe('INTERNAL_ERROR');
  expect(JSON.stringify(body)).not.toContain('private-');
  expect(body.requestId).toMatch(uuidPattern);
  expect(body.requestId).toBe(response.headers.get('x-request-id'));
});

it('preserves binary responses while still returning the request ID header', async () => {
  const response = await fetch(`${baseUrl}/api/v1/contract-test/file`);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/plain');
  expect(await response.text()).toBe('file-content');
  expect(response.headers.get('x-request-id')).toMatch(uuidPattern);
});

it.each(['http://localhost:5173', 'http://localhost:5174'])(
  'allows the configured origin %s and exposes the request ID', async origin => {
    const response = await fetch(`${baseUrl}/api/v1/health/live`, { headers: { Origin: origin } });
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    expect(response.headers.get('access-control-expose-headers')).toContain('X-Request-Id');
    expect(response.headers.get('x-request-id')).toMatch(uuidPattern);
  },
);

it('does not grant browser access to an unlisted origin', async () => {
  const response = await fetch(`${baseUrl}/api/v1/health/live`, {
    headers: { Origin: 'https://unlisted.example' },
  });
  expect(response.headers.get('access-control-allow-origin')).toBeNull();
});
