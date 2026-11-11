# 自营电商系统

一家自营店铺的后台管理站、简单顾客站和统一 API。

## 当前进度

板块1（M0-01：工程、数据库与四容器骨架）已于2026-11-11通过验收，SW-01～06、CK-01～08全部通过。已完成workspace、严格TypeScript、ESLint、Turborepo、NestJS、健康检查、统一响应、环境配置、PostgreSQL/Prisma/首迁移、独立测试库、DTO、日志、Swagger、两个React应用壳和四服务容器部署。实际证据见[验收记录](docs/verification/M0-01.md)。

当前页面只提供首页、未开放的登录表单及 404；没有账号认证、商品或订单业务。顾客端明确展示模拟交易说明。

## 版本

2026-11-11 查询包仓库并安装，提交完整 `pnpm-lock.yaml`。

| 工具 | 固定版本 |
|---|---|
| Node.js | 24.18.0（`.node-version`） |
| pnpm | 11.25.0（`packageManager`） |
| TypeScript | 6.0.3 |
| Turborepo | 2.11.10 |
| NestJS | 12.4.2 |
| React / React DOM | 19.3.1 |
| Vite / React 插件 | 8.3.8 / 5.2.0 |
| Ant Design | 6.7.0 |
| React Router DOM | 7.18.5 |
| Axios | 1.21.1 |
| ESLint / typescript-eslint | 10.14.0 / 8.72.2 |
| Vitest | 5.1.0 |
| Prisma CLI / Client / PostgreSQL适配器 | 7.10.1 |
| pg / @types/pg | 8.23.1 |
| tsx | 4.23.15 |
| PostgreSQL镜像 | postgres:16.6-bookworm |
| Nginx镜像 | nginx:1.28.0-alpine |
| Swagger | 12.1.1 |
| Pino / nestjs-pino / pino-http | 10.4.0 / 5.3.1 / 11.0.0 |
| class-validator / class-transformer | 0.15.1 / 0.5.1 |

TypeScript7不满足当前Swagger与typescript-eslint兼容范围，因此选用6.0.3。Prisma7使用PostgreSQL驱动适配器；CLI与客户端固定相同版本，不采用CLI提示的8.0候选版。pnpm11使用allowBuilds限定需要运行安装脚本的依赖。

本机 `node` 指向 `D:\develop\nodejs\node.exe`；Codex 提供的 `pnpm.cmd` 自带另一 Node 运行时（24.22.1）。本轮验证显式用 Node 24.18.0 运行 pnpm 的 JS 入口。普通开发环境应先确保 pnpm 实际使用 Node 24.18.0，避免只检查 `node --version` 却忽略包管理器启动脚本。

## 目录

```text
apps/api             NestJS API，端口 3000
apps/admin-web       后台 React 站点，端口 5173
apps/store-web       顾客 React 站点，端口 5174
packages/shared      公开接口基础类型，不导出数据库实体
packages/api-client  Axios 实例工厂，目前只配置地址和超时
packages/config      TypeScript 和 ESLint 公共配置
infra                四服务Compose、API/前端Dockerfile、Nginx与HTTP检查脚本
docs                 实施方案和实际验证记录
```

代码直接位于 self-ecom，不再嵌套 shop。当前目录属于上级学习笔记 Git 仓库，操作时不要修改其它学习笔记。

## 本地启动

在 self-ecom 根目录执行：

```powershell
node --version
pnpm --version
pnpm install --frozen-lockfile
Copy-Item .env.example .env
# 仅首次复制；已有 .env 不要覆盖。替换示例开发密码。
pnpm db:generate
docker compose --env-file .env -f infra/compose.yaml up -d db
# 等待db显示healthy后应用迁移。
pnpm db:migrate:deploy
pnpm dev
```

`pnpm dev` 会先构建依赖的公共包，再启动 API 与两个 Vite 服务。端口被占用时应先处理占用，两个 Vite 站点不会静默更换端口。

- 后台：<http://localhost:5173>
- 顾客端：<http://localhost:5174>
- 两站登录外壳：`/login`
- API存活检查：<http://localhost:3000/api/v1/health/live>，查询本身不连接数据库。API启动阶段会验证数据库连接；启动完成后live仍只反映进程存活。未实现路径返回统一JSON404。
- API就绪检查：<http://localhost:3000/api/v1/health/ready>，经Prisma执行SELECT1；成功200、data.status=ready、checks.database=up。数据库故障时返回503、SERVICE_NOT_READY和details.database=unavailable，不暴露驱动异常。

Vite将`/api`原路径代理到3000。API端口读取PORT，默认3000；修改PORT时须同步两站Vite代理。成功响应为`{data,requestId}`，错误为`{code,message,details?,requestId}`；每次请求生成服务端UUID并返回X-Request-Id，不接受客户端指定编号。文件流保持原始内容。生产启动与HTTP测试复用公共配置。日志、DTO校验、业务细分错误码及Swagger后续补齐。

## 环境配置

API统一从仓库根目录`.env`读取配置，不依赖启动时所在目录；进程/容器环境变量优先于文件。使用Node内置环境文件解析，不做`${...}`变量插值。`.env`已被Git忽略，不提交真实配置；`.env.example`只有示例。

| 变量 | 当前规则与用途 |
|---|---|
| NODE_ENV | development/test/production，默认development |
| PORT | 1～65535整数字符串，默认3000；实际用于监听 |
| DATABASE_URL | 必填PostgreSQL URL，包含主机、用户名和数据库名；Prisma启动时真实连接 |
| CORS_ORIGINS | 必填，逗号分隔两个不同的HTTP/HTTPS来源，不含路径或通配符；实际控制CORS并暴露X-Request-Id |
| UPLOAD_DIR | 绝对路径；省略时为仓库根目录下storage/uploads的绝对路径，目前不创建目录 |
| SWAGGER_ENABLED | 严格true/false，默认false；已解析，待Swagger接入 |
| LOG_LEVEL | fatal/error/warn/info/debug/trace/silent，默认info；已解析，待Pino接入 |

配置错误统一指出变量名和规则，不输出输入值或连接串；启动在监听端口前失败。CORS仅控制浏览器跨来源读取，不替代认证或接口权限；两个站点通过同源Vite代理仍可工作。

Compose读取POSTGRES_*与DB_HOST_PORT。TEST_DATABASE_URL供测试脚本使用，不能与开发库同名；本阶段要求位于相同数据库服务，测试库名以_test结尾。全局DTO校验尚未实现，环境校验不代表请求参数已校验。

## 开发数据库（当前仅数据库容器）

```powershell
docker compose --env-file .env -f infra/compose.yaml up -d db
docker compose --env-file .env -f infra/compose.yaml ps
```

镜像为postgres:16.6-bookworm，数据保存在db_data命名卷，健康检查通过pg_isready。当前本机5432已有PostgreSQL占用，因此项目默认映射`127.0.0.1:15432`到容器5432；本机DATABASE_URL/TEST_DATABASE_URL端口均为15432。容器内API连接数据库时将使用db:5432，而不是宿主机15432。如修改DB_HOST_PORT，需同时修改本机两个连接串端口。

2026-11-11已确认容器healthy、Prisma真实查询成功、PostgreSQL16.6、时区UTC；开发库与测试库均已应用0001_bootstrap。其余三个服务容器尚未实现。不要使用`down -v`作为常规重启，它会删除数据库卷。初始化后的数据库账号密码不会因修改.env而自动改变。

## Prisma、迁移与测试库

```powershell
pnpm db:generate
pnpm db:migrate:deploy
pnpm db:migrate:status
pnpm db:test:prepare
pnpm test:integration
```

脚本读取根目录.env，再调用固定版本Prisma。schema.prisma当前没有业务模型，已验证这种配置能生成Prisma7客户端；0001_bootstrap只执行CREATE SCHEMA IF NOT EXISTS public。唯一正式表为Prisma维护的_prisma_migrations，不添加虚假业务表或手动修改迁移记录。

`db:migrate:dev`只用于开发新迁移，生产环境拒绝该命令；部署使用`db:migrate:deploy`。已应用迁移不得原地修改，后续变更新增迁移。API不会自行运行迁移，更不会reset数据库。

PrismaService统一管理客户端和连接池：启动最多尝试3次，每次失败间隔250ms；连接/等待连接预算750ms，服务端statement_timeout为750ms，驱动query_timeout为1000ms。超时在驱动和数据库层生效，不仅靠Promise.race提前返回；真实pg_sleep(5)测试确认查询被终止。关闭应用时断开连接，最终启动错误不输出连接串，每连接使用UTC。

并发ready共享当前尚未结束的SELECT1，完成后不缓存结果，后续请求重新检查数据库，避免大量探针排队和故障恢复误判。已实测同一API进程在db停止时ready503/live200，恢复db后ready200；ready只证明当时能查询数据库，不替代migrate status或完整业务验收。

`db:test:prepare`校验目标后幂等创建shop_test，不重置已有库。`test:integration`先检查测试URL与开发库隔离，再准备测试库、仅对测试库执行migrate deploy并运行真实数据库测试。普通`pnpm test`隔离Prisma提供者，不连接或清理开发库。测试准备需要数据库账号具备创建数据库权限；失败时先检查权限，不删除现有卷。

## 四服务容器启动

在项目根目录执行（已存在`.env`时保留它）：

```powershell
docker compose --env-file .env -f infra/compose.yaml config --quiet
docker compose --env-file .env -f infra/compose.yaml build
docker compose --env-file .env -f infra/compose.yaml up -d --wait db
docker compose --env-file .env -f infra/compose.yaml run --rm --no-deps api pnpm --filter @shop/api db:migrate:deploy
docker compose --env-file .env -f infra/compose.yaml up -d --wait --wait-timeout 90
docker compose --env-file .env -f infra/compose.yaml ps
node infra/verify-compose.mjs
```

后台静态站为 http://localhost:8080 ，顾客静态站为 http://localhost:8081 。两站的`/api/docs`都可打开Swagger并同源试调。API容器内部为3000；宿主映射由`API_HOST_PORT`控制，示例默认3000，本机`.env`使用3001以便与开发模式并存，因此容器API文档为 http://localhost:3001/api/docs 。两种模式共用当前开发数据库；后续写入业务数据时需注意这一点。

容器CORS默认允许8080/8081，可用`COMPOSE_CORS_ORIGINS`设置两个来源；若修改前端宿主端口，应同步更新该变量。数据库连接由Compose注入容器内`db:5432`地址，数据库用户名/密码用于拼接URL时应使用URI安全字符（随机十六进制密码适用）。前端只构建公开的`/api/v1`配置，不接收数据库或认证秘密。

API镜像使用Node 24.18.0、pnpm 11.25.0、多阶段构建和生产依赖，包含Linux环境生成的Prisma客户端、部署迁移CLI和运行迁移脚本所需的tsx，以uid1000运行。运行镜像关闭pnpm执行脚本前自动安装依赖，依赖在构建时使用锁文件安装；修改依赖后重新构建镜像。可用同样的覆盖命令运行`db:migrate:status`。前端运行镜像使用Nginx 1.28.0，仅包含构建产物和Nginx配置；`/api/`原路径转发，其他页面支持SPA刷新，缺失资源返回404。index.html使用no-cache，带哈希的assets使用一年immutable缓存。Nginx使用Docker DNS刷新API地址，API容器重建后可重新连接。

数据库复用`self-ecom_db_data`，上传目录使用`self-ecom_uploads`挂载到`/app/storage/uploads`，不挂载给Nginx。迁移独立执行，应用启动不会reset或自动迁移。停止服务可运行`docker compose --env-file .env -f infra/compose.yaml stop`；日常操作保留数据卷，不运行`down -v`。修改源码后重新build并up；修改运行环境后重新up使容器重建。

## 工程检查命令

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

实际源码包参与lint/typecheck/build。普通测试94项，涵盖配置、CORS、HTTP契约、DTO校验、Swagger开关与契约、ready错误脱敏、请求日志和测试库安全边界；真实数据库集成测试6项，验证PostgreSQL16/UTC/测试库身份、迁移、live/ready、慢查询实际终止及并发检查复用。实际Docker停库/恢复另有记录，没有用Mock替代故障实验。测试专用端点不注册生产AppModule；完整端到端验收后续补齐。

API以Pino输出JSON日志，`LOG_LEVEL`控制级别。请求日志包含method、去查询参数的path、statusCode、responseTime（毫秒）及与响应头/体一致的requestId。HTTP日志不采集请求体、请求头或响应头，错误信息与堆栈不直接输出；不要在自由文本日志中拼接敏感数据。这些运行日志不替代后续业务审计。

设置根目录`.env`中的`SWAGGER_ENABLED=true`，启动API后访问 http://localhost:3000/api/docs ，原生OpenAPI JSON位于 http://localhost:3000/api/docs-json 。修改开关后需重启API；关闭时两个入口返回404。当前Health标签包含live/ready，展开接口后点击Try it out → Execute即可试调，无需登录。开发代理入口也可使用 http://localhost:5173/api/docs 和 http://localhost:5174/api/docs 。

运行`pnpm openapi:export`导出`docs/openapi/openapi.json`。导出仍校验环境配置，但不初始化数据库连接、不监听端口，也不要求Swagger开关开启。修改接口声明后重新导出；文档页面使用当前代码即时生成契约。后续Bearer认证在板块2接入。

实施计划见 [M0-01 实施方案](docs/design/M0-01.md)，阶段验证见 [M0-01 验证记录](docs/verification/M0-01.md)。

DTO校验基础：声明DTO类的参数启用严格字段白名单，额外字段和无效参数返回400（VALIDATION_FAILED），details包含field/message，不回显输入值。公共PaginationDto默认page=1、pageSize=20且最大100；数字和布尔转换必须显式声明，禁止宽松隐式转换。未声明DTO的路由不会自动获得字段校验；本阶段没有发布测试专用API。
