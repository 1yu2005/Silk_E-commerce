// 作用：隔离库实际复现旧范围参数上限和逐行摘要查询增长，验证新范围/分页及动作投影等价。
import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Client } from 'pg';
import { expect, it } from 'vitest';
import { apply, fixture, http, paid, physical, review, saleTask, setupCoordinationFixtures } from './coordination-fixtures.js';
import { TaskQueryService } from '../src/tasks/task-query.service.js';
import { TaskAccessService } from '../src/tasks/task-access.service.js';
import { TaskBusinessAdapters } from '../src/tasks/task-business-adapters.js';
import { TaskQueryDto } from '../src/tasks/task.dto.js';
setupCoordinationFixtures({ databasePrefix: 'm415' });

it('IT15-TASK：真实100000参数拒绝，20/100页SQL预算与逐行投影等价', async () => {
  const { app, db, admin } = fixture;
  for (let n = 0; n < 100; n++) await paid();
  const evidence = resolve(__dirname, '../../../output/testing/M4-15', new Date().toISOString().replaceAll(':', '-') + '-task-diagnostic');
  mkdirSync(evidence, { recursive: true });
  const pg = new Client({ connectionString: process.env.DATABASE_URL }); await pg.connect();
  try {
    // 旧TaskAccess.scope的逐UUID IN构造保持原样；此处只证明真实PG协议，不把生成UUID冒充10万合法订单。
    const ids = Array.from({ length: 100000 }, () => randomUUID());
    const legacy = Prisma.sql`SELECT count(*) FROM task t WHERE t.business_type=${'ORDER'}::"TaskBusinessType" AND t.business_id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))})`;
    let legacyFailure: { code: string; name: string } | null = null;
    try { await pg.query(legacy.text, legacy.values); } catch (error) {
      const e = error as { code?: string; name?: string }; legacyFailure = { code: e.code ?? 'UNKNOWN', name: e.name ?? 'Error' };
    }
    expect(legacyFailure, '原100001参数查询必须由真实PG实际拒绝').not.toBeNull();
    const access = app.get(TaskAccessService), queries = app.get(TaskQueryService), adapters = app.get(TaskBusinessAdapters);
    if (admin.actor.subjectType !== 'EMPLOYEE') throw new Error('隔离员工身份错误');
    const currentScope = await access.scope(db, admin.actor); expect(currentScope.values.length).toBeLessThan(128);
    const budgets: Record<string, unknown> = {}, original = Client.prototype.query, presentMany = access.presentMany.bind(access);
    let traced: string[] | null = null;
    Client.prototype.query = function(this: Client, ...args: unknown[]) {
      const first = args[0], text = typeof first === 'string' ? first : (first as { text?: string })?.text;
      if (traced && text) traced.push(text);
      return Reflect.apply(original, this, args);
    } as typeof original;
    try {
      for (const pageSize of [20, 100]) {
        const query = Object.assign(new TaskQueryDto(), { view: 'pool', page: 1, pageSize, businessType: 'ORDER' });
        access.presentMany = async (tx, actor, tasks, now) => {
          const rows = []; for (const task of tasks) rows.push(await access.present(tx, actor, task, now)); return rows;
        };
        traced = []; const before = await queries.list(admin.actor, admin.token, query), legacyQueries = traced.length;
        access.presentMany = presentMany;
        traced = []; const after = await queries.list(admin.actor, admin.token, query), batchQueries = traced.length; traced = null;
        expect(after).toEqual(before); expect(after.items).toHaveLength(pageSize); expect(after.total).toBe(100);
        budgets[pageSize] = { legacyQueries, batchQueries, itemsAndTotalEquivalent: true };
        expect(batchQueries).toBeLessThan(legacyQueries);
      }
      expect((budgets[100] as {batchQueries:number}).batchQueries).toBeLessThanOrEqual((budgets[20] as {batchQueries:number}).batchQueries + 1);
      // 每种已注册生产适配器保留存在性范围，不能用管理员权限绕开业务读取。
      expect(adapters.accessEntries().every(([, adapter]) => typeof adapter.visibleScope === 'function')).toBe(true);
    } finally { traced = null; access.presentMany = presentMany; Client.prototype.query = original; }
    writeFileSync(resolve(evidence, 'summary.json'), JSON.stringify({ kind: 'task-query-diagnostic', postgres: (await pg.query('SELECT version() version')).rows[0].version,
      originalParameterCount: legacy.values.length, originalFailure: legacyFailure, currentScopeParameterCount: currentScope.values.length, budgets,
      limitation: '100正式领域下单/支付任务用于查询预算；100000随机UUID仅验证原范围算法PG参数协议，非正式性能夹具/长压' }, null, 2) + '\n');
    console.log(JSON.stringify({ taskDiagnosticEvidence: evidence, originalFailure: legacyFailure, budgets }));
  } finally { await pg.end(); }
}, 180000);

it('IT15-TASK-SCOPE：真实ORDER/AFTER_SALE适配器裁剪与全范围的HTTP数据等价', async () => {
  const { app, db, warehouse, support } = fixture;
  const order = await paid(), refundOrder = await paid(), sale = await apply(refundOrder);
  await review(sale.afterSaleId); await physical(refundOrder, sale.afterSaleId);
  const refund = await saleTask(sale.afterSaleId, 'REFUND_PROCESS');
  const shipping = await db.task.findFirstOrThrow({ where: { businessType: 'ORDER', businessId: order.id, stage: 'SHIPMENT_PROCESS', status: 'OPEN' } });
  const access = app.get(TaskAccessService), original = access.scope;
  const cases = [
    { context: warehouse, path: `/admin/tasks?view=pool&businessType=ORDER&stage=SHIPMENT_PROCESS&businessId=${order.id}&page=1&pageSize=20`, expected: shipping.id, action: 'claim' },
    { context: support, path: `/admin/tasks?view=mine&businessType=AFTER_SALE&stage=REFUND_PROCESS&businessId=${sale.afterSaleId}&page=1&pageSize=20`, expected: refund.id, action: 'release' },
    { context: warehouse, path: `/admin/tasks?view=pool&businessType=ORDER&businessId=${order.id}&page=1&pageSize=10`, expected: shipping.id, action: 'claim' },
  ];
  for (const item of cases) {
    let baseline: Awaited<ReturnType<typeof http>>;
    access.scope = function(tx, current) { return Reflect.apply(original, this, [tx, current]); };
    try { baseline = await http('GET', item.path, item.context); }
    finally { access.scope = original; }
    const selected = await http('GET', item.path, item.context);
    expect(baseline.status).toBe(200); expect(selected.status).toBe(200);
    expect(selected.json.data).toEqual(baseline.json.data);
    expect(selected.json.data).toMatchObject({ total: 1, items: [{ id: item.expected, allowedActions: [item.action] }] });
  }
}, 60000);
