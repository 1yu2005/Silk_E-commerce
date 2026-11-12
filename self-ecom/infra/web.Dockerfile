# 文件作用：按指定站点构建前端静态资源，再由 Nginx 提供页面和同源 API 代理。
FROM node:24.18.0-bookworm-slim AS build
RUN npm install --global pnpm@11.25.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
ARG WEB_APP
# 前端构建只能读取这个公开的同源配置值。
ENV VITE_API_BASE_URL=/api/v1
RUN case "$WEB_APP" in admin-web|store-web) ;; *) exit 1 ;; esac \
    && pnpm --filter "@shop/$WEB_APP..." build \
    && cp -a "apps/$WEB_APP/dist" /site

FROM nginx:1.28.0-alpine AS runtime
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /site /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
