// 作用：先用1000单同构语料验证数据库约束和只读对账；1000单绝不记为正式10万性能通过。
import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { expect, it } from 'vitest';
import { fixture, setupCoordinationFixtures } from './coordination-fixtures.js';
import { seedModule15Performance } from './fixtures/module15-performance.js';
import { StoreSettingsService } from '../src/settings/store-settings.service.js';
import { APP_CONFIG } from '../src/config/environment.js';
setupCoordinationFixtures({ databasePrefix: 'm415' });

it('IT15-FIXTURE：1000单同构合法语料及完整只读对账（非正式性能验收）', async () => {
  const { app, db, admin } = fixture, settings = app.get(StoreSettingsService), current = await settings.current();
  const original = current.currentSetting!;
  await settings.update(admin.actor, admin.token, { ...original, expectedVersion: current.version, deadlines: { ...original.deadlines, paymentMinutes: 1440 }, reason: '独占性能环境合法付款期限' }, randomUUID());
  const head = await db.storeSettingHead.findUniqueOrThrow({ where: { id: 1 }, include: { currentVersion: true } });
  const uploadsRoot = app.get(APP_CONFIG).uploadDir;
  const dataset = await seedModule15Performance({ employeeId: admin.actor.subjectId, setting: head.currentVersion!, uploadsRoot, orderCount: 1000 });
  expect(dataset.counts.orders).toBe(1000); expect(dataset.counts.items).toBe(1400); expect(dataset.counts.payments).toBe(900); expect(dataset.counts.refunds).toBe(100);
  const script = pathToFileURL(resolve(__dirname, '../../../scripts/reconcile.mjs')).href;
  const { runReconcile } = await import(script) as { runReconcile(options: {client: Client; uploadsRoot: string; scope: {target: string; database: string}}): Promise<{status: string; checks: {passed: boolean; violationCount: string}[]}> };
  const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  try {
    const report = await runReconcile({ client, uploadsRoot, scope: {target:'performance-fixture-diagnostic',database:new URL(process.env.DATABASE_URL!).pathname.slice(1)} });
    const evidence = resolve(__dirname, '../../../output/testing/M4-15', new Date().toISOString().replaceAll(':','-') + '-fixture-diagnostic'); mkdirSync(evidence, {recursive:true});
    writeFileSync(resolve(evidence, 'summary.json'), JSON.stringify({ kind:'module15-fixture-diagnostic', dataset, reconcile:report },null,2)+'\n');
    console.log(JSON.stringify({fixtureDiagnosticEvidence:evidence,counts:dataset.counts,reconcileStatus:report.status,checks:report.checks}));
    expect(report.status).toBe('passed'); expect(report.checks.every(check=>check.passed && check.violationCount==='0')).toBe(true);
  } finally { await client.end(); }
}, 180000);
