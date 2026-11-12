// 作用：显式运行首管理员初始化，连接前校验环境和可选测试库隔离。
import { assertSafeTestDatabase, parseDatabaseUrl, readDatabaseEnvironment } from './database-env.js';
import { validateEnvironment } from '../src/config/environment.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { InitialAdminSeedError, readInitialAdminConfig, seedInitialAdmin } from '../src/auth/initial-admin-seed.js';
import { PermissionSeedConflictError } from '../src/permissions/permission-seed.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--test')) throw new Error('管理员初始化参数不合法');
  const env = readDatabaseEnvironment();
  const testing = args[0] === '--test';
  // 所有配置及隔离检查在连接前完成；不接受命令行密码、不自动迁移或重置数据库。
  const databaseUrl = testing ? assertSafeTestDatabase(env.DATABASE_URL, env.TEST_DATABASE_URL).testUrl
    : parseDatabaseUrl(env.DATABASE_URL, 'DATABASE_URL').toString();
  const config = readInitialAdminConfig(env);
  const prisma = new PrismaService(validateEnvironment({ ...env, DATABASE_URL: databaseUrl }));
  try {
    const result = await seedInitialAdmin(prisma, config);
    console.log(JSON.stringify({ status: 'initialized', target: testing ? 'test' : 'configured', ...result }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // 固定错误只指明变量或恢复要求，不附带密码、哈希、连接串或驱动原文。
  console.error(error instanceof InitialAdminSeedError || error instanceof PermissionSeedConflictError
    ? error.message : '管理员初始化失败，请检查参数、配置、迁移与数据库状态');
  process.exitCode = 1;
});
