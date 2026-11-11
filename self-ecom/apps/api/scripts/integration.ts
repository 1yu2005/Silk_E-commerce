import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { assertSafeTestDatabase, readDatabaseEnvironment } from './database-env.js';
import { prepareTestDatabase, runPrisma } from './database.js';

async function main() {
  const env = readDatabaseEnvironment();
  // 尝试连接管理数据库之前，先完成校验。
  const safe = assertSafeTestDatabase(env.DATABASE_URL, env.TEST_DATABASE_URL);
  await prepareTestDatabase(env);
  const testEnv = { ...env, NODE_ENV: 'test', DATABASE_URL: safe.testUrl,
    DEVELOPMENT_DATABASE_URL: safe.developmentUrl };
  runPrisma(['migrate', 'deploy'], testEnv);
  const result = spawnSync(process.execPath, [resolve(require.resolve('vitest/package.json'), '../vitest.mjs'),
    'run', '--config', 'vitest.integration.config.mts'], {
    cwd: resolve(__dirname, '..'), env: testEnv, stdio: 'inherit', windowsHide: true,
  });
  if (result.error || result.status !== 0) throw new Error('数据库集成测试失败');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : '数据库集成测试失败');
  process.exitCode = 1;
});
