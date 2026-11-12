// 作用：配置 PostgreSQL 集成测试文件范围、超时和串行执行等验收约定。
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: {
  include: ['test/**/*.integration.ts'],
  testTimeout: 15_000,
  hookTimeout: 15_000,
  fileParallelism: false,
  // 只在隔离测试进程生效；生产配置无默认密钥。
  env: { JWT_SECRET: 'integration-only-jwt-key-not-for-use-2026', JWT_TTL_SECONDS: '7200' },
} });
