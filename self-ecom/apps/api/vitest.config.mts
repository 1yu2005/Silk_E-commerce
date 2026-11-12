// 作用：配置普通 API 单元测试范围与虚构 JWT 测试密钥，隔离本机真实秘密。
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['test/**/*.spec.ts'],
  // 测试进程使用独立虚构密钥，不读取本机真实JWT秘密。
  env: { JWT_SECRET: 'unit-test-only-jwt-key-not-for-use-2026', JWT_TTL_SECONDS: '7200' },
} });
