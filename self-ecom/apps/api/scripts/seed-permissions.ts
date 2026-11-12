// 作用：显式运行固定权限目录初始化，校验目标数据库并使用事务提交。
import { readDatabaseEnvironment, assertSafeTestDatabase, parseDatabaseUrl } from './database-env.js';
import { validateEnvironment } from '../src/config/environment.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PermissionSeedConflictError, seedPermissionCatalog } from '../src/permissions/permission-seed.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--test')) throw new Error('权限初始化参数不合法');
  const env = readDatabaseEnvironment();
  const testing = args[0] === '--test';
  // 测试命令先校验隔离，连接前完成检查；不自动迁移、创建或清空数据库。
  const databaseUrl = testing ? assertSafeTestDatabase(env.DATABASE_URL, env.TEST_DATABASE_URL).testUrl
    : parseDatabaseUrl(env.DATABASE_URL, 'DATABASE_URL').toString();
  const prisma = new PrismaService(validateEnvironment({ ...env, DATABASE_URL: databaseUrl }));
  try {
    const result = await seedPermissionCatalog(prisma);
    console.log(JSON.stringify({ status: 'seeded', target: testing ? 'test' : 'configured', ...result }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // 仅输出固定业务错误；驱动原文可能包含SQL或连接信息。
  console.error(error instanceof PermissionSeedConflictError ? error.message : '权限目录初始化失败，请检查参数、配置、迁移与数据库状态');
  process.exitCode = 1;
});
