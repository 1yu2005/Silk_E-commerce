import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { assertSafeTestDatabase, parseDatabaseUrl, readDatabaseEnvironment } from './database-env.js';

export function runPrisma(args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), ...args], {
    cwd: resolve(__dirname, '..'), env, stdio: 'inherit', windowsHide: true,
  });
  if (result.error || result.status !== 0) throw new Error('Prisma命令执行失败');
}

export async function prepareTestDatabase(env: NodeJS.ProcessEnv) {
  const safe = assertSafeTestDatabase(env.DATABASE_URL, env.TEST_DATABASE_URL);
  const adminUrl = new URL(safe.developmentUrl);
  adminUrl.pathname = '/postgres';
  const client = new Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 2000,
    statement_timeout: 5000, query_timeout: 6000 });
  try {
    await client.connect();
    const found = await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [safe.testName]);
    if (!found.rowCount) {
      // 标识符已通过严格的 [a-z0-9_] 白名单校验。
      try { await client.query(`CREATE DATABASE "${safe.testName}" ENCODING 'UTF8' TEMPLATE template0`); }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === '42P04')) throw error; }
    }
    console.log('独立测试库已就绪，未重置或清理任何数据库');
  } catch {
    throw new Error('测试库准备失败，请检查服务、权限和连接配置');
  } finally {
    await client.end();
  }
  return safe;
}

async function main() {
  const env = readDatabaseEnvironment();
  const command = process.argv[2];
  if (command === 'prepare-test') {
    await prepareTestDatabase(env);
    return;
  }
  parseDatabaseUrl(env.DATABASE_URL, 'DATABASE_URL');
  const commands: Record<string, string[]> = {
    generate: ['generate'],
    'migrate-dev': ['migrate', 'dev'],
    'migrate-deploy': ['migrate', 'deploy'],
    'migrate-status': ['migrate', 'status'],
  };
  const args = command ? commands[command] : undefined;
  if (!args) throw new Error('未知数据库命令');
  if (command === 'migrate-dev' && env.NODE_ENV === 'production') {
    throw new Error('生产环境禁止migrate dev，请使用migrate deploy');
  }
  runPrisma([...args, ...process.argv.slice(3)], env);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : '数据库命令失败');
    process.exitCode = 1;
  });
}
