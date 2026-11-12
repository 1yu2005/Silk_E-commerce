# 自营电商系统

一家自营店铺的后台管理站、顾客站和统一API。

## 当前进度

板块1（工程、数据库与四服务骨架）和板块2（登录、员工与权限）已验收。当前支持员工认证与管理、岗位及个人授权、顾客注册登录和本人资料维护，两端均适配电脑和手机。商品、库存、订单、发货等业务留待后续板块。

功能和技术说明见[板块2开发完成说明](项目文档/开发进度文档/开发完成说明/板块2_开发完成说明.md)，历史整体验收及后续初始化调整见[验收记录](docs/verification/M0-02.md#initial-admin-defaults)，整体安排见[开发进度总览](项目文档/开发进度总览.md)。

## 环境与目录

使用Node.js **24.18.0**、pnpm **11.25.0**及Docker Compose。安装依赖使用锁文件；其余依赖版本见各包的`package.json`和`pnpm-lock.yaml`。确认pnpm实际使用上述Node版本，工具自带启动脚本可能使用不同运行时。

技术栈：NestJS、React、Ant Design、PostgreSQL、Prisma、TypeScript和Turborepo。

```text
self-ecom/
├─ apps/
│  ├─ api/           NestJS后端
│  ├─ admin-web/     员工后台
│  └─ store-web/     顾客商城
├─ packages/
│  ├─ shared/        共用类型和校验规则
│  ├─ api-client/    前端请求和会话工具
│  └─ config/        TypeScript和代码检查配置
├─ infra/            Docker、Nginx和部署验证脚本
├─ docs/             技术设计、OpenAPI和验收证据
└─ 项目文档/         需求、板块设计、开发进度与完成说明
```

当前项目属于上级学习笔记Git仓库，操作时保留其他目录和已有未提交修改。

## 先选择启动方式

| 场景 | 阅读位置 | 实际启动的服务 |
|---|---|---|
| 第一次在本机开发 | [首次准备](#首次准备)，按步骤执行到底 | Docker运行数据库，本机运行API、后台、商城 |
| 已完成初始化，继续日常开发 | [日常启动](#日常启动)，执行两条命令 | 同上，修改代码后自动重新编译或刷新 |
| 四个服务全部使用Docker | [四服务容器启动](#四服务容器启动) | 数据库、API、后台、商城全部运行在容器中 |

先启动Docker Desktop并等待引擎就绪。以下命令使用PowerShell，均在项目根目录执行；若终端已位于该目录，直接执行对应场景的命令即可：

```powershell
Set-Location 'D:\实习\实习生全栈学习笔记\self-ecom'
```

## 本地启动

这是日常推荐方式：数据库在Docker，API与两个网站在本机。

### 首次准备

**第1步：确认版本并安装依赖。**

```powershell
node --version
pnpm --version
pnpm install --frozen-lockfile
```

Node应为24.18.0，pnpm应为11.25.0。

**第2步：创建并填写环境配置。**

```powershell
# 已有.env时保留原配置。
if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
}
```

打开根`.env`，替换示例数据库密码，使`DATABASE_URL`与`POSTGRES_*`一致；填写至少32字节的随机`JWT_SECRET`。需要接口文档时设置`SWAGGER_ENABLED=true`。**保存配置后再继续下面的命令。**

**第3步：生成数据库客户端、启动数据库、建表并初始化账号。**

确认`DATABASE_URL`指向目标开发库，然后按顺序逐条执行，每条成功后再继续：

```powershell
# 生成Prisma客户端。
pnpm db:generate
# 启动数据库，等待它就绪。
docker compose --env-file .env -f infra/compose.yaml up -d --wait db
# 应用迁移建表，再检查迁移状态。
pnpm db:migrate:deploy
pnpm db:migrate:status
# 初始化权限目录及首管理员；已有管理员不会被覆盖。
pnpm db:seed:permissions
pnpm db:seed:admin
```

首管理员默认账号为**`admin`**、密码为**`admin123`**，不要求首次改密。私有`.env`中的`INIT_ADMIN_USERNAME`和`INIT_ADMIN_PASSWORD`可覆盖默认值，显式空值会报错。seed仅在空员工库创建账号，不用于重置旧账号；新建员工和重置员工密码后的强制改密规则保留。

**第4步：启动API和两个网站。**

```powershell
pnpm dev
```

等待终端显示三个应用就绪，保持该终端运行，打开下方“本机访问网址”。以后继续开发，使用下面两条日常命令即可。

### 日常启动

前提：已完成上述首次准备。每次打开项目后，依次执行：

```powershell
# 启动数据库；已经运行时会保留现有数据。
docker compose --env-file .env -f infra/compose.yaml up -d --wait db
# 同时启动API、后台、商城，保持终端运行。
pnpm dev
```

新增依赖后先执行`pnpm install --frozen-lockfile`；拉取了新迁移时，在启动前执行`pnpm db:generate`、`pnpm db:migrate:deploy`。日常重启不需要重复初始化账号。

### 本机访问网址

首次运行和日常开发使用同一组网址：

| 入口 | 地址 |
|---|---|
| 后台登录 | <http://localhost:5173/login> |
| 商城首页 | <http://localhost:5174> |
| 顾客注册 / 登录 | <http://localhost:5174/register> / <http://localhost:5174/login> |
| API就绪检查 | <http://localhost:3000/api/v1/health/ready> |
| Swagger接口文档 | <http://localhost:3000/api/docs>，要求SWAGGER_ENABLED=true |

`pnpm dev`先构建共享包，再启动API和两个Vite服务。两站通过`/api`代理到本机3000；修改API的`PORT`时同步修改Vite代理。端口占用时不会静默换端口。

停止本机应用：在运行`pnpm dev`的终端按`Ctrl+C`。需要停止数据库时再执行：

```powershell
docker compose --env-file .env -f infra/compose.yaml stop db
```

## 环境配置

API和数据库脚本读取根`.env`，进程环境变量优先，不支持`${...}`插值。真实`.env`不提交，前端`VITE_*`只允许公开配置。

| 变量 | 用途或默认值 |
|---|---|
| `NODE_ENV`、`PORT` | 运行环境默认development，API端口默认3000 |
| `DATABASE_URL` | 开发库连接串；宿主机示例为localhost:15432 |
| `TEST_DATABASE_URL` | 独立测试库；与开发库同服务、不同名，库名以_test结尾 |
| `POSTGRES_DB/USER/PASSWORD`、`DB_HOST_PORT` | Compose数据库配置；宿主端口默认15432 |
| `JWT_SECRET`、`JWT_TTL_SECONDS` | 后端随机密钥至少32个UTF-8字节；有效期默认7200秒，允许1～86400 |
| `INIT_ADMIN_USERNAME/PASSWORD` | 可选，覆盖首管理员默认admin/admin123；容器内使用覆盖值时需显式传入 |
| `CORS_ORIGINS` | 两个不同的HTTP/HTTPS来源，逗号分隔 |
| `SWAGGER_ENABLED`、`LOG_LEVEL` | Swagger开关默认false，日志级别默认info |
| `UPLOAD_DIR` | 可选绝对路径，默认storage/uploads；文件上传留后续板块 |
| `VITE_API_BASE_URL` | 前端公开接口前缀，默认/api/v1 |
| `API_HOST_PORT/ADMIN_HOST_PORT/STORE_HOST_PORT` | 容器宿主端口默认3000/8080/8081 |
| `COMPOSE_CORS_ORIGINS` | 容器网站来源，默认localhost:8080和localhost:8081 |

数据库首次初始化后，修改`.env`不会自动修改已有数据库账号密码。更改`DB_HOST_PORT`时同步本机连接串；容器API通过`db:5432`连接数据库。

## 数据库与测试

| 命令 | 用途 |
|---|---|
| `pnpm db:generate` | 生成Prisma客户端 |
| `pnpm db:migrate:deploy` | 应用已有迁移 |
| `pnpm db:migrate:status` | 检查迁移；存在待应用迁移时可能非零退出 |
| `pnpm db:migrate:dev` | 开发新迁移，生产禁用 |
| `pnpm db:seed:permissions` | 初始化固定权限及岗位绑定 |
| `pnpm db:seed:admin` | 空员工库创建首管理员 |
| `pnpm db:test:prepare` | 校验隔离后准备测试库，不重置已有库 |
| `pnpm test:integration` | 校验隔离、准备测试库、应用测试库迁移并运行集成测试 |

权限和管理员seed也提供`:test`后缀命令，写入`TEST_DATABASE_URL`指定的库，要求已应用迁移。创建测试库需要数据库账号具有相应权限。

当前迁移为`0001_bootstrap`和`0002_auth_employee_permission_audit`。应用启动不自动迁移；已应用的迁移不要原地修改，后续变更新增迁移。普通`pnpm test`不连接开发库。

## 四服务容器启动

用于板块完成后的部署验证，四个服务全部在Docker中运行。镜像构建会安装依赖并生成Prisma客户端。先启动Docker Desktop，并按“首次准备”的第2步配置根`.env`。

### 第一次使用Docker，或切换到当前代码部署

在项目根目录按顺序执行，每条成功后再继续：

```powershell
# 检查配置并构建当前代码的镜像。
docker compose --env-file .env -f infra/compose.yaml config --quiet
docker compose --env-file .env -f infra/compose.yaml build
# 先启动数据库，再在容器内执行迁移和初始化。
docker compose --env-file .env -f infra/compose.yaml up -d --wait db
docker compose --env-file .env -f infra/compose.yaml run --rm --no-deps api pnpm db:migrate:deploy
docker compose --env-file .env -f infra/compose.yaml run --rm --no-deps api pnpm db:seed:permissions
docker compose --env-file .env -f infra/compose.yaml run --rm --no-deps api pnpm db:seed:admin
# 启动全部四个服务并查看状态。
docker compose --env-file .env -f infra/compose.yaml up -d --wait --wait-timeout 90
docker compose --env-file .env -f infra/compose.yaml ps
```

空员工库默认创建`admin / admin123`，无需首次强制改密；已有账号不覆盖。自定义容器初始化账号时，将配置放入当前进程环境，并为这次`run`增加`-e INIT_ADMIN_USERNAME -e INIT_ADMIN_PASSWORD`；API容器不会自动读取宿主机`.env`中的这两项。

### 后续启动已有Docker部署

代码、镜像和数据库结构没有变化时，只需：

```powershell
docker compose --env-file .env -f infra/compose.yaml up -d --wait --wait-timeout 90
docker compose --env-file .env -f infra/compose.yaml ps
```

`-d`表示后台运行，命令结束后可以关闭终端。源码或依赖变化后重新执行`build`再`up`；有新迁移时，在更新应用前执行上面的容器迁移命令。日常重启不需要重复seed。

### Docker访问网址

当前本机`.env`的API宿主端口为3001，后台和商城采用默认8080、8081：

| 入口 | 当前本机地址 |
|---|---|
| 后台登录 | <http://localhost:8080/login> |
| 商城首页 | <http://localhost:8081> |
| 顾客注册 / 登录 | <http://localhost:8081/register> / <http://localhost:8081/login> |
| 后台 / 商城代理的接口文档 | <http://localhost:8080/api/docs> / <http://localhost:8081/api/docs> |
| API直连接口文档 | <http://localhost:3001/api/docs> |
| API直连就绪检查 | <http://localhost:3001/api/v1/health/ready> |

接口文档均要求`SWAGGER_ENABLED=true`。新电脑从`.env.example`复制时，`API_HOST_PORT`默认为3000，届时表中的3001改为3000；与本机开发同时运行时可设为3001以避免端口冲突。网站端口由`ADMIN_HOST_PORT`、`STORE_HOST_PORT`控制，修改后同步`COMPOSE_CORS_ORIGINS`。两种启动方式默认共用同一开发数据库。

停止四服务并保留数据：

```powershell
docker compose --env-file .env -f infra/compose.yaml stop
```

数据保存在`db_data`卷，上传路径使用`uploads`卷，不要用`down -v`作为日常停止命令。Compose将JWT密钥作为运行配置传入API；数据库密码拼接连接串时应使用URI安全字符。Nginx不直接提供私有上传目录，修改运行配置后重新`up`使配置生效。

板块2已通过独立四服务验收，原开发库和旧运行容器未被该轮验收迁移或替换。隔离复验入口为`node infra/verify-auth-compose.mjs`，需Docker及已有Playwright/Chromium；可用`DOCKER_EXECUTABLE`、`PLAYWRIGHT_MODULE_PATH`和`PLAYWRIGHT_CHROMIUM_EXECUTABLE`指定工具路径。执行范围及证据见[验收记录](docs/verification/M0-02.md#module2-final-acceptance)。

## 工程检查与接口文档

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm openapi:export
```

OpenAPI导出到`docs/openapi/openapi.json`，需要有效环境配置（包括JWT），不连接数据库或启动服务。Swagger开关修改后需重启API；原始契约入口为`/api/docs-json`。浏览器复验所需环境、六组脚本和历史结果见[板块2验收记录](docs/verification/M0-02.md#module2-final-acceptance)。

四服务启动后，可在已有Node环境下执行`node infra/verify-compose.mjs`做基础检查；这是额外验证步骤，不是启动必需命令。

接口统一使用`/api/v1`前缀，成功返回`{ data, requestId }`，失败返回`{ code, message, details?, requestId }`。日志及响应通过requestId关联，日志不记录密码、JWT和连接串。`/health/live`检查进程，`/health/ready`检查数据库可访问；健康通过不代表迁移和业务验收已完成。

## 文档导航

- [开发进度总览](项目文档/开发进度总览.md)：当前状态、后续计划和协作规则。
- [通俗功能说明](项目文档/自营电商项目功能说明_通俗版.md) / [需求文档v2.0](项目文档/自营电商项目需求文档_v2.0.md)：项目业务和规则。
- [板块1完成说明](项目文档/开发进度文档/开发完成说明/板块1_开发完成说明.md) / [板块2完成说明](项目文档/开发进度文档/开发完成说明/板块2_开发完成说明.md)：已完成功能、架构和关键技术。
- [板块1设计](docs/design/M0-01.md) / [板块2设计](docs/design/M0-02.md)：技术方案和分步实施记录。
- [板块1验收](docs/verification/M0-01.md) / [板块2验收](docs/verification/M0-02.md#module2-final-acceptance)：验证结果、复验方法和适用边界。
