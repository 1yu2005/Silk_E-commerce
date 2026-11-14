// 作用：使用独立 PostgreSQL 测试库验证数据库连接、迁移和健康检查恢复行为。
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/common/configure-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { assertSafeTestDatabase } from '../scripts/database-env.js';

// 禁止使用任意继承的 DATABASE_URL 执行此测试。
const safe = assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test') throw new Error('集成测试仅可在test环境执行');
let app: INestApplication;
let prisma: PrismaService;
let baseUrl: string;

beforeAll(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication();
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  prisma = app.get(PrismaService);
  baseUrl = await app.getUrl();
});
afterAll(async () => { await app?.close(); });

it('connects through the real Prisma PostgreSQL adapter to the isolated PostgreSQL16 database', async () => {
  const [row] = await prisma.$queryRaw<{ database: string; version: string; timezone: string }[]>`
    SELECT current_database() AS database, current_setting('server_version') AS version,
      current_setting('TimeZone') AS timezone`;
  expect(row?.database).toBe(safe.testName);
  expect(row?.version).toMatch(/^16\./);
  expect(row?.timezone).toBe('UTC');
  await expect(prisma.ping()).resolves.toBeUndefined();
});

it('已应用工程、认证、文件及设置任务基础迁移，并保留完整业务表', async () => {
  const rows = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null }[]>`
    SELECT migration_name, finished_at FROM public._prisma_migrations ORDER BY migration_name`;
  expect(rows).toEqual(['0001_bootstrap', '0002_auth_employee_permission_audit', '0003_files_communication_history',
    '0004_store_settings_tasks_deadlines', '0005_categories_products_skus_inventory_accounts','0006_inventory_sources_adjustments_ledger','0007_customer_status_addresses_cart','0008_orders_quotes_idempotency_blocks','0009_payments_stock_issues','0010_order_snapshot_file_reference']
    .map(migration_name => ({ migration_name, finished_at: expect.any(Date) })));
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
  expect(tables.map(row => row.tablename)).toEqual(['_prisma_migrations', 'address', 'audit_log', 'auth_session', 'business_state_history',
    'cart_item', 'category', 'communication', 'customer', 'customer_status_history', 'deadline_event', 'employee', 'employee_extra_permission', 'file_asset', 'file_reference',
    'initial_inventory_draft', 'initial_inventory_draft_line', 'inventory_action', 'inventory_adjustment', 'inventory_adjustment_line', 'inventory_balance', 'inventory_ledger', 'inventory_purchase_block', 'inventory_receipt_batch', 'inventory_source', 'inventory_source_line',
    'permission_definition', 'product', 'product_image', 'product_spec_dimension', 'product_spec_value', 'role_permission', 'scheduler_failure', 'scheduler_run', 'sku', 'sku_spec_choice', 'store_setting_head',
    'store_setting_version', 'system_guard', 'task', 'task_history', 'task_stage_cursor',
    'checkout_quote','checkout_quote_item','order','order_item','idempotency_record','order_block','timer_pause','order_timer_receipt',
    'task_business_source','task_business_source_history','payment','stock_incident','stock_incident_item','stock_incident_history','stock_incident_command','stock_replenishment'].sort());
});

it('keeps liveness working with the real database module installed', async () => {
  const response = await fetch(`${baseUrl}/api/v1/health/live`);
  expect(response.status).toBe(200);
  const body = await response.json() as { data: { status: string }; requestId: string };
  expect(body.data.status).toBe('ok');
  expect(body.requestId).toBe(response.headers.get('x-request-id'));
});

it('checks readiness against the real PostgreSQL database', async () => {
  const response = await fetch(`${baseUrl}/api/v1/health/ready`);
  expect(response.status).toBe(200);
  const body = await response.json() as {
    data: { status: string; checks: { database: string } }; requestId: string;
  };
  expect(body.data.status).toBe('ready');
  expect(body.data.checks.database).toBe('up');
  expect(body.requestId).toBe(response.headers.get('x-request-id'));
});

it('cancels a slow server query instead of leaving it running behind a timeout response', async () => {
  const started = performance.now();
  await expect(prisma.$queryRaw`SELECT pg_sleep(5)`).rejects.toThrow();
  expect(performance.now() - started).toBeLessThan(2500);
  const [row] = await prisma.$queryRaw<{ active: number }[]>`
    SELECT count(*)::int AS active FROM pg_stat_activity
    WHERE datname=current_database() AND pid<>pg_backend_pid()
      AND state='active' AND query LIKE '%pg_sleep(5)%'`;
  expect(row?.active).toBe(0);
  await expect(prisma.ping()).resolves.toBeUndefined();
});

it('shares concurrent probes only while in flight, then executes a fresh probe', async () => {
  const first = prisma.ping();
  expect(prisma.ping()).toBe(first);
  await Promise.all(Array.from({ length: 20 }, () => prisma.ping()));
  const next = prisma.ping();
  expect(next).not.toBe(first);
  await next;
});
