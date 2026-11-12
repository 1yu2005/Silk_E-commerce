# 文件作用：构建含 Prisma 与显式运维命令的 API 镜像，并以非 root 用户运行。
FROM node:24.18.0-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@11.25.0
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
# 生成客户端时使用不含真实凭据的构建专用地址，不会连接数据库。
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build pnpm --filter @shop/api db:generate
# API复用共享密码规则，先生成共享包导出的dist。
RUN pnpm --filter @shop/shared build \
    && pnpm --filter @shop/api build \
    && pnpm --filter @shop/api deploy --prod --legacy /runtime \
    && mkdir -p /runtime/node_modules/.prisma \
    && cp -a "$(dirname "$(node -p "require.resolve('.prisma/client/package.json', { paths: [require.resolve('@prisma/client', { paths: ['/app/apps/api'] })] })")")" /runtime/node_modules/.prisma/client

FROM base AS runtime
ENV NODE_ENV=production PORT=3000 UPLOAD_DIR=/app/storage/uploads
# 部署依赖保持固定，运行运维脚本前禁止自动安装依赖。
ENV pnpm_config_verify_deps_before_run=false
COPY --from=build --chown=node:node /runtime /app
RUN mkdir -p /app/storage/uploads && chown -R node:node /app/storage
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
