// 作用：验证严格 DTO 转换、未声明字段拒绝、分页边界和脱敏校验响应。
import 'reflect-metadata';
import { Body, Controller, Get, Post, Query, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDefined, IsString } from 'class-validator';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/common/configure-app.js';
import { PaginationDto } from '../src/common/http/pagination.dto.js';
import { strictBoolean } from '../src/common/http/dto-transforms.js';
import { APP_CONFIG, validateEnvironment } from '../src/config/environment.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AfterSaleCloseFacts } from '../src/after-sales/after-sale-close-facts.js';
import { ContractError } from '@shop/shared';

class InputDto {
  @IsDefined()
  @IsString()
  name!: string;

  @Transform(({ value }: { value: unknown }) => strictBoolean(value))
  @IsBoolean()
  enabled!: boolean;
}

@Controller('validation-test')
class ValidationController {
  @Get()
  list(@Query() query: PaginationDto) { return query; }

  @Post()
  create(@Body() input: InputDto) { return input; }
  @Post('conflict')
  conflict() { throw new ContractError('IDEMPOTENCY_PAYLOAD_CONFLICT'); }
}

// Vitest 的 TypeScript 转换器不生成装饰器元数据，这里补充与生产环境
// tsc 相同的元数据，让 HTTP 测试验证 Nest 实际的 DTO 识别过程。
Reflect.defineMetadata('design:paramtypes', [PaginationDto], ValidationController.prototype, 'list');
Reflect.defineMetadata('design:paramtypes', [InputDto], ValidationController.prototype, 'create');

let app: INestApplication;
let url: string;
beforeAll(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule], controllers: [ValidationController] })
    .overrideProvider(APP_CONFIG).useValue(validateEnvironment({ NODE_ENV: 'test', LOG_LEVEL: 'silent',
      DATABASE_URL: 'postgresql://test:test@localhost:15432/shop_test',
      CORS_ORIGINS: 'http://localhost:5173,http://localhost:5174' }))
    .overrideProvider(AfterSaleCloseFacts).useValue({})
    .overrideProvider(PrismaService).useValue({ ping: async () => {} }).compile();
  app = module.createNestApplication();
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  url = `${await app.getUrl()}/api/v1/validation-test`;
});
afterAll(async () => { await app?.close(); });

it('公共幂等冲突返回409及统一请求编号，不回显请求内的秘密', async () => {
  const response = await fetch(`${url}/conflict`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'private-transient-value' }) });
  expect(response.status).toBe(409); const body = await response.json() as { code: string; requestId: string };
  expect(body.code).toBe('IDEMPOTENCY_PAYLOAD_CONFLICT'); expect(body.requestId).toBe(response.headers.get('x-request-id'));
  expect(JSON.stringify(body)).not.toContain('private-transient-value');
});

it.each([
  ['', { page: 1, pageSize: 20 }],
  ['?page=2&pageSize=100', { page: 2, pageSize: 100 }],
])('applies pagination defaults and explicit conversion: %s', async (query, data) => {
  const response = await fetch(`${url}${query}`);
  expect(response.status).toBe(200);
  expect((await response.json() as { data: unknown }).data).toEqual(data);
});

it.each(['?page=0', '?page=-1', '?page=1.5', '?page=', '?page=%20', '?page=1e2',
  '?page=0x10', '?page=9007199254740992', '?pageSize=101', '?pageSize=0',
  '?page=1&page=2', '?extra=private-value'])('rejects invalid pagination: %s', async query => {
  const response = await fetch(`${url}${query}`);
  const body = await response.json() as { code: string; details: unknown[]; requestId: string };
  expect(response.status).toBe(400);
  expect(body.code).toBe('VALIDATION_FAILED');
  expect(body.details.length).toBeGreaterThan(0);
  expect(body.requestId).toBe(response.headers.get('x-request-id'));
  expect(JSON.stringify(body)).not.toContain('private-value');
});

it.each([true, false, 'true', 'false'])('converts strict boolean %s', async enabled => {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'sample', enabled }) });
  expect(response.status).toBe(201);
  expect((await response.json() as { data: { enabled: boolean } }).data.enabled)
    .toBe(enabled === true || enabled === 'true');
});

it.each([
  {}, { name: 123, enabled: true }, { name: 'sample' },
  ...[0, 1, '', 'TRUE', '0', '1', 'yes', null, [], {}].map(enabled => ({ name: 'sample', enabled })),
  { name: 'sample', enabled: true, password: 'private-password' },
  { name: null, enabled: true },
])('rejects missing, mistyped and additional body fields %#', async input => {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input) });
  const body = await response.json() as { details: unknown[]; requestId: string };
  expect(response.status).toBe(400);
  expect(body.details.length).toBeGreaterThan(0);
  expect(body.requestId).toBe(response.headers.get('x-request-id'));
  expect(JSON.stringify(body)).not.toContain('private-password');
});
