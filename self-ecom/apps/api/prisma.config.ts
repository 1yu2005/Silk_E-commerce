// 作用：声明 Prisma schema 与迁移目录，由受控脚本提供已校验的数据库配置。
import { defineConfig, env } from 'prisma/config';

// 项目脚本先加载根目录 .env 并校验目标，再调用 Prisma。
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
