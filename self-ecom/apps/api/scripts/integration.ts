// 作用：每个套件独占本轮新建数据库，避免设置Head及不可变历史在套件间互相污染。
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { assertSafeTestDatabase, readDatabaseEnvironment } from './database-env.js';
import { runPrisma } from './database.js';

async function main() {
  const env = readDatabaseEnvironment();
  // 尝试连接管理数据库之前，先完成校验。
  const safe = assertSafeTestDatabase(env.DATABASE_URL, env.TEST_DATABASE_URL);
  const all = readdirSync(resolve(__dirname, '../test')).filter(n => n.endsWith('.integration.ts')).map(n => 'test/' + n);
  const requested = process.argv.slice(2), files = requested.length ? requested : all;
  if (files.some(f => !all.includes(f))) throw new Error('仅允许运行仓库中的明确集成测试文件');
  const adminUrl = new URL(safe.testUrl); adminUrl.pathname = '/postgres';
  const admin = new Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 3000 });
  let failed = false; await admin.connect();
  try { for (const file of files) {
    // 保留前置板块既定独占库白名单；订单套件使用本板块白名单。
    const name = (file.includes('/fulfillment') ? 'm210_' : file.includes('/orders') ? 'm108_' : 'm105_') + randomUUID().replaceAll('-', '') + '_test';
    const testUrl = new URL(safe.testUrl); testUrl.pathname = '/' + name;
    const variables = { ...env, NODE_ENV: 'test', DATABASE_URL: testUrl.toString(), DEVELOPMENT_DATABASE_URL: safe.developmentUrl };
    let created = false;
    try {
      await admin.query(`CREATE DATABASE "${name}" ENCODING 'UTF8' TEMPLATE template0`); created = true;
      runPrisma(['migrate', 'deploy'], variables);
      const result = spawnSync(process.execPath, [resolve(require.resolve('vitest/package.json'), '../vitest.mjs'),
        'run', '--config', 'vitest.integration.config.mts', file], {
        cwd: resolve(__dirname, '..'), env: variables, stdio: 'inherit', windowsHide: true,
      });
      if (result.error || result.status !== 0) failed = true;
    } catch (error) { failed = true; console.error(error instanceof Error ? error.message : '隔离套件失败'); }
    finally { if (created) { await admin.query(`DROP DATABASE "${name}"`); console.log(JSON.stringify({ suite: file, ownedDatabaseRemoved: true })); } }
  } } finally { await admin.end(); }
  if (failed) throw new Error('数据库集成测试存在失败，本轮独占资源已按归属清理');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : '数据库集成测试失败');
  process.exitCode = 1;
});
