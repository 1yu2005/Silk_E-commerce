# 自营电商系统

面向自营服装店铺的后台管理站、顾客站和统一API。后续商品与SKU按款式、颜色、尺码组织。

## 当前进度

板块1～4已按本期范围验收，M0“工程可运行”完成。当前支持员工与顾客认证、权限、头像与受控图片、公共记录和接口契约，以及全店设置/版本、北京时间期限计算、任务工作台、领取交接/资格回池、超期扫描和暂停计时内核；两端均适配电脑和手机。真实商品、库存、订单、发货和售后流程留待后续板块。

功能和技术说明见[板块2开发完成说明](项目文档/开发进度文档/开发完成说明/板块2_开发完成说明.md)，历史整体验收及后续初始化调整见[验收记录](docs/verification/M0-02.md#initial-admin-defaults)，整体安排见[开发进度总览](项目文档/开发进度总览.md)。

板块4于2026-11-13完成本期验收：756项普通、1373项数据库集成、28项浏览器场景、六工作区类型、Lint、构建及契约/漂移检查通过；独立四服务21组、164次HTTP请求通过，包含前三板块认证/文件回归。现有四服务已更新为同一组已验收镜像，部署核对均healthy，数据库与上传卷保留。功能、8张新表、13个新接口和后续接入点见[板块4完成说明](项目文档/开发进度文档/开发完成说明/板块4_开发完成说明.md)，具体范围与失败修正见[验收记录](docs/verification/M0-04.md)。旧板块结果仍保留，不能当成本次文档收尾重新执行的测试。真实业务适配器未接入时明确拒绝，GitHub CI尚未运行。

开发库保留已有账号、头像等可展示资料；本板块未新增服装商品、演示任务或预设经营设置。后续可保留真实服装展示数据，网络图片经文件模块存储并记录来源；回滚/并发验证继续用隔离测试库。新增演示员工/顾客在对应完成说明汇总，现有密码不写入仓库。

开发时每个小任务只运行相关测试，板块收尾再做全量与四服务验收；具体协作规则见[开发进度总览](项目文档/开发进度总览.md)。下一板块为5“分类商品与前台浏览”，先只读核查和确认第一步，再逐步开发。

### 全店设置与任务

管理员在后台`/settings`填写运费、包邮、退货地址、客服电话/服务时间和8项期限，填写原因后保存；`/settings/versions`查看完整历史。金额页面用元、存储用整数分；同内容不造新版本，409冲突须重读。商城公共布局显示可拨打电话，公开接口不返回内部地址；开发库当前未配置，须由管理员亲自填写。

后台`/tasks`提供我的待办、合资格岗位池和管理员待安排，以及详情、领取/释放/转交/延期和统一历史。修改全店设置不回写旧任务快照；延期保留原截止和曾逾期。正式环境启动补扫、每分钟扫描，test环境不自动调度。当前无真实库存/订单/售后任务，列表为空；BR-05暂停规则及事务接口已完成，真实订单表与业务闭环待后续接通。

手动体验任务动作见[隔离应用说明](apps/api/test/acceptance/README.md)，使用独立专属库、5175页面与3001测试API。**当前Docker API也占3001，须按说明先停止Docker的api服务，结束隔离应用后再恢复**；不要同时启动或把测试页面误接到开发库。任务测试账号只在临时库，密码随机且仅在启动终端显示。

图片接口：`POST /api/v1/files`、`GET /api/v1/files/{id}`、`GET /api/v1/files/{id}/content`。本机Swagger在`http://localhost:3000/api/docs`，先登录并Authorize；multipart先放purpose、再放一个file。支持JPEG/PNG/WebP、单图5MiB、宽高各10000及总像素4000万以内，不支持动画；服务端实际解码重编码，不按扩展名放行。未绑定图片仅本人可读，24小时到期；业务绑定只供后端事务调用，不提供任意业务ID绑定接口。

头像入口：顾客站“我的账号”，登录后选图、等待上传预览，再点“保存头像”。`PUT /api/v1/store/me/avatar`只接收本人头像fileId，`DELETE`清当前头像；登录、本人查询和昵称修改均返回真实avatarUrl。保存失败可用原上传结果重试。头像公开展示，更换或移除会保留历史图片及旧公开链接，请勿上传私人凭证。`@shop/ui`提供公共上传、错误提示及私有Blob预览，两端分别使用自己的认证客户端；后台真实业务附件页面待对应板块接入。

文件默认存于`storage/uploads`，不通过静态目录公开；部署沿用API上传卷。默认每主体20次/分钟、最多100张未绑定图片，清理每300秒一批；可用`.env.example`中的`FILE_*`调整，无须覆盖真实`.env`。过期STAGED与无元数据孤儿可清理，已绑定及历史引用保留；孤儿采用48小时保守窗口。两个站点的6MiB请求体、代理JSON 413和私有缓存已在独立Docker环境验证；代理requestId为32位十六进制，API为UUID。常用四服务已在板块4收尾部署为当前验收代码。

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
│  ├─ contract-tools/ 固定版本的OpenAPI开发生成工具
│  ├─ ui/            公共图片上传、私有预览与错误提示
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
| `UPLOAD_DIR` | 可选绝对路径，默认storage/uploads；Docker使用上传卷 |
| `FILE_STAGED_QUOTA/FILE_UPLOADS_PER_MINUTE/FILE_CLEANUP_INTERVAL_SECONDS` | 未绑定图片配额/每主体每分钟上传次数/清理周期，默认100/20/300 |
| `VITE_API_BASE_URL` | 前端公开接口前缀，默认/api/v1 |
| `API_HOST_PORT/ADMIN_HOST_PORT/STORE_HOST_PORT` | 容器宿主端口默认3000/8080/8081 |
| `COMPOSE_CORS_ORIGINS` | 容器网站来源，默认localhost:8080和localhost:8081 |

数据库首次初始化后，修改`.env`不会自动修改已有数据库账号密码。更改`DB_HOST_PORT`时同步本机连接串；容器API通过`db:5432`连接数据库。

板块4没有新增必须配置的环境变量。运费、地址、电话和期限从后台保存，不写入.env；未保存时设置保持未就绪，不用默认电话/地址让真实业务继续。

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
| `pnpm openapi:export` | 编译当前API并稳定导出docs/openapi/openapi.json，不连接数据库 |
| `pnpm api-client:generate` | 从导出契约生成packages/api-client/src/generated的类型与JSON调用器 |
| `pnpm contracts:check` | 检查源码、OpenAPI和生成产物是否一致，有差异非零退出，不自动改写契约 |

权限和管理员seed也提供`:test`后缀命令，写入`TEST_DATABASE_URL`指定的库，要求已应用迁移。创建测试库需要数据库账号具有相应权限。

接口变更后依次运行`pnpm openapi:export`、`pnpm api-client:generate`和`pnpm contracts:check`，连同契约与生成文件一起审阅。JSON调用器复用现有Axios认证、双域隔离及错误处理；文件上传/二进制仍使用手写FormData/Blob薄封装。生成器固定openapi-typescript7.13.0，其TypeScript5.9.3放在独立工具工作区；工程保持TypeScript6.0.3。首次准备仍先安装依赖并生成Prisma客户端。

GitHub工作流位于实际仓库根目录的`.github/workflows/self-ecom-contracts.yml`（本项目上级目录），仅对self-ecom相关变更执行契约检查及相关测试；本机验证通过不代表GitHub已运行。公共指纹只处理已验证、白名单业务载荷，区分图片顺序与集合；不会自动给请求添加幂等键，也不提供订单幂等结果重放，后续订单板块须在业务事务接入。

仓库迁移为`0001_bootstrap`、`0002_auth_employee_permission_audit`、`0003_files_communication_history`、`0004_store_settings_tasks_deadlines`。开发库已应用0004，新增设置、任务、期限与扫描的8张表；旧12表账号、会话和资料摘要保持，只初始化版本0的设置指针。0003曾用于修复头像字段缺失的登录异常，历史见[M0-03本机修复](docs/verification/M0-03.md#本机顾客登录修复步骤1补充2026-11-13)。生成新Prisma客户端后，启动API前须用`pnpm db:migrate:status`确认结构；健康检查不能替代结构校验。应用不自动迁移，已应用迁移不原地修改。普通`pnpm test`不连接开发库。

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

最新完整隔离部署复验：`node infra/verify-auth-compose.mjs --settings --output=output/playwright/新的验收目录`，自动包含原认证和`--files`范围。默认从源码冻结安装、构建三个应用，使用随机项目、端口、凭据和独立空卷，结束只清理本次容器项目。需要可用Docker及已有Playwright/Chromium，可用`DOCKER_EXECUTABLE`、`PLAYWRIGHT_MODULE_PATH`和`PLAYWRIGHT_CHROMIUM_EXECUTABLE`指定工具路径；始终使用新输出目录保留证据。板块4[验收记录](docs/verification/M0-04.md)含设置、公开联系、任务空态、Swagger、扫描与重启持久化；真实任务并发/回池/暂停使用独占测试库单独验证。

2026-11-13已将验收镜像部署到常用四服务，数据库容器和旧卷保持，部署报告见[证据](docs/verification/evidence/M0-04/step11/deployment.json)。后续源码改变后仍需重新构建/部署，容器健康不能代替代码版本与业务验收核对。

## 工程检查与接口文档

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm openapi:export
pnpm api-client:generate
pnpm contracts:check
```

OpenAPI导出到`docs/openapi/openapi.json`，导出脚本使用虚构配置，不连接数据库或启动服务；客户端随后从该文档生成。`contracts:check`只比较源码、文档与生成产物，发现漂移退出非零；`node scripts/test-contract-drift.mjs`验证检查确实能拒绝漂移。Swagger开关修改后需重启API；原始契约入口为`/api/docs-json`。浏览器复验所需环境和历史结果见[板块2验收记录](docs/verification/M0-02.md#module2-final-acceptance)。

四服务启动后，可在已有Node环境下执行`node infra/verify-compose.mjs`做基础检查；这是额外验证步骤，不是启动必需命令。

接口统一使用`/api/v1`前缀，成功返回`{ data, requestId }`，失败返回`{ code, message, details?, requestId }`。日志及响应通过requestId关联，日志不记录密码、JWT和连接串。`/health/live`检查进程，`/health/ready`检查数据库可访问；健康通过不代表迁移和业务验收已完成。

## 文档导航

- [开发进度总览](项目文档/开发进度总览.md)：当前状态、后续计划和协作规则。
- [通俗功能说明](项目文档/自营电商项目功能说明_通俗版.md) / [需求文档v2.0](项目文档/自营电商项目需求文档_v2.0.md)：项目业务和规则。
- [板块1完成说明](项目文档/开发进度文档/开发完成说明/板块1_开发完成说明.md) / [板块2完成说明](项目文档/开发进度文档/开发完成说明/板块2_开发完成说明.md)：已完成功能、架构和关键技术。
- [板块3完成说明](项目文档/开发进度文档/开发完成说明/板块3_开发完成说明.md) / [设计](docs/design/M0-03.md) / [验收](docs/verification/M0-03.md#module3-final-acceptance)：图片、头像、审计记录及公共契约，含真实部署证据与后续边界。
- [板块4完成说明](项目文档/开发进度文档/开发完成说明/板块4_开发完成说明.md) / [设计](docs/design/M0-04.md) / [验收](docs/verification/M0-04.md)：设置、期限、任务、扫描及暂停内核，含真实业务后续接入边界。
- [板块1设计](docs/design/M0-01.md) / [板块2设计](docs/design/M0-02.md)：技术方案和分步实施记录。
- [板块1验收](docs/verification/M0-01.md) / [板块2验收](docs/verification/M0-02.md#module2-final-acceptance)：验证结果、复验方法和适用边界。
