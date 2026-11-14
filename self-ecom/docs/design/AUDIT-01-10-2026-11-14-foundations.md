# 板块1—4基础能力复查记录

审查日期：2026-11-14（Asia/Shanghai）。本记录是板块1—10审查的基础域分项，记录本轮实际检查、缺陷和验证，不能替代总验收或证明全库不存在缺陷。依据板块1—4开发文档、现有M0设计及实际源码核对；历史“已完成”未作为本轮测试结果。

最终续验：本分项下文“截至写入时待统一回归”属于阶段快照；主审已完成783普通、1539不同数据库用例通过证据、最终Docker12组/402响应、常用部署及原数据保护。实际失败/复验与边界统一见[本轮最终验收](../verification/AUDIT-01-10-2026-11-14.md)，不重复累计本分项定向用例。

## 要求与实现对应

以下API路径均带`/api/v1`前缀。入口列表示当前代码已经注册的正式入口；本分项未单独重启容器或逐一执行浏览器验收，运行状态及整体验收由主审记录提供。

| 板块与要求 | 真实源码与当前入口 | 关键验证与后续边界 |
|---|---|---|
| 1：四服务、独立迁移、配置及健康检查 | `infra/compose.yaml`、`infra/api.Dockerfile`、`infra/web.Dockerfile`；`apps/api/src/config/environment.ts`、`prisma/prisma.service.ts`、`health/health.controller.ts`；`/health/live`、`/health/ready` | 核对配置错误不回显值、连接/查询超时、健康查询不永久缓存、迁移与启动分离；`environment.spec.ts`、`bootstrap.spec.ts`及数据库安全/迁移测试由统一回归执行。本分项不将旧Docker证据视为本轮构建通过。 |
| 1、3：统一响应、严格DTO、请求编号、脱敏日志和契约 | `common/configure-app.ts`、`common/http/`、`common/logging.ts`、`common/swagger.ts`；生产控制器与生成客户端 | 核对白名单DTO、错误映射、前缀、认证传输和请求目标限制；`validation.spec.ts`、`logging.spec.ts`、`swagger.spec.ts`及客户端契约测试由统一回归执行。未增加无业务授权的通用修改接口。 |
| 2：员工/顾客分域认证、会话撤销、强制改密及最新权限 | `auth/jwt-token.service.ts`、`auth-session.service.ts`、`current-identity.service.ts`、两类Guard及登录/改密/注销服务；`/admin/auth/login`、`/store/auth/login`、`/admin/me`、`/store/me`、`/auth/logout` | 核对JWT最小声明、域匹配、数据库会话/版本、密码快照锁内复核和最后可用管理员保护；本轮定向`auth-session.spec.ts`通过，其余认证集成由主审统一执行。账号密码、岗位和授权未通过本分项改写。 |
| 2：员工管理、权限依赖、撤权与真实任务回池同事务 | `employees/`、`permissions/permission.service.ts`、`tasks/task-eligibility.service.ts`；`/admin/employees`及其管理动作；后台`/employees` | 核对管理员稳定锁→员工→完整业务→游标/任务锁序，调岗清额外授权、停用撤销会话，失败向外传播回滚；对应`employee-*.integration.ts`、`task-reassign.integration.ts`。后续领域仍必须注册真实交接适配器，不能用默认成功代替。 |
| 3：图片用途/配额、实际解码、文件引用与受控读取 | `files/files.service.ts`、`file-access.service.ts`、`file-binding.service.ts`、`file-storage.service.ts`、`multipart-upload.ts`、`image-codec.ts`及各业务适配器；`POST /files`、`GET /files/:id`、`GET /files/:id/content` | 核对主体/用途、STAGED有效期、同聚合复用、保留历史引用、文件锁与清理互斥、路径及链接防护；本轮修复两处等锁后JWT复核缺口，新增真实数据库回归。普通文件/审计定向36项通过；数据库绿色待统一回归。售后/退货等未接入领域继续默认拒绝。 |
| 3：审计、状态历史、内部/公开沟通隔离 | `audit/audit.service.ts`、`records/communication.service.ts`、`state-history.service.ts`、`communication-files.adapter.ts`；`/admin/communications`、`/store/orders/:id/communications` | 核对最小审计白名单、调用方事务、公开字段投影、私有原记录更正关系和附件范围；本轮修复沟通业务锁等待后的JWT复核缺口。`audit-records.spec.ts`定向通过；真实记录、附件、回滚集成待统一回归。 |
| 4：全店设置版本、整数金额、历史快照、公开联系方式 | `settings/store-settings.service.ts`及DTO；`/admin/settings`、`/admin/settings/versions`、`/store/contact`；后台`/settings`、`/settings/versions` | 核对Head锁与expectedVersion、同内容无新历史、仅公开联系列、下游在原事务固化设置版本；后台`settings/model.ts`按字符串转换整数分。普通/数据库设置用例由统一回归执行；退货地址批准快照等仍随板块11—12真实业务补验。 |
| 4：任务轮次/资格/动作/期限、逾期扫描、BR-05暂停恢复 | `tasks/task-entry.service.ts`、`task-command.service.ts`、`task-lifecycle.service.ts`、`task-source.service.ts`、`task-deadline*.ts`、`task-overdue-scan.service.ts`、`order-timer*.ts`、`common/time/deadline.ts`；`/admin/tasks`及领取/释放/转交/延期；后台`/tasks` | 核对签发上下文、幂等、完整锁计划、当前资格、旧逾期保留、来源独立结束、最后阻塞解除恢复和扫描失败重试；本轮`task-kernel.spec.ts`定向通过。订单及库存已有真实适配器，售后补材料/补寄轮次和退款终结仍归板块11—12；不得把本轮SQL内核夹具当成未来售后接通。 |

额外检查了后台认证路由、员工查询/管理/创建/详情、设置表单、任务列表/详情/动作、商品和库存命令钩子，以及公共客户端的认证、会话、JSON/文件传输和UI私有图片/上传器。已检查会话revision隔离、同步pending、版本冲突与不确定结果提示、金额转换和Blob释放，本分项未发现新的已证实前端缺陷，未据此宣称所有UI均已浏览器验收。

## 三处JWT时序缺陷

共同触发条件：请求进入时凭证有效，随后等待真实业务/文件锁，等待结束时JWT已到`exp`。主体行锁可以阻止另一事务撤权或停用，不能阻止时间自然推进。

| 缺陷 | 修复前实际结果 | 修复与回归 |
|---|---|---|
| 沟通追加等业务锁后未复核 | `records.integration.ts`新增“沟通业务锁等待跨过JWT到期后拒绝写入”红测，原实现仍返回已创建沟通记录，退出码1 | `CommunicationService.authorize`在领域授权完成后再次`authenticate`并核对同主体、同会话；过期在创建沟通前拒绝，不新增沟通/审计。 |
| 文件绑定等业务/文件锁后未复核 | `files.integration.ts`新增绑定红测，原实现仍生成引用并变成RETAINED，退出码1 | `FileBindingService.bindFiles`在完整文件锁后调用`access.current(tx, access, false)`，在写引用前复核；保留原事务已有主体锁，不反向补锁。 |
| 私有RETAINED文件等业务锁后未复核 | 同文件新增私有元数据红测，原实现仍返回元数据，退出码1 | `FilesService.authorize`在真实引用适配器READ授权完成后再次复核，过期不返回私有资料。公开内容已有公开引用授权路径保持。 |

回归使用真实JWT签发、数据库会话、真实SQL业务归属/锁及真实文件引用；只推进注入时钟到`exp`，不修改宿主机时间，也不等待实际令牌自然到期。修复未改数据库结构或既有迁移。

红测证据（独占隔离数据库，由主审执行）：

- [沟通JWT红测](../verification/evidence/AUDIT-01-10-2026-11-14/integration-red-record-jwt.json)：2026-11-14 16:34，迁移退出码0，目标测试退出码1。
- [文件JWT两项红测](../verification/evidence/AUDIT-01-10-2026-11-14/integration-red-file-jwt.json)：2026-11-14 16:37—16:38，迁移退出码0，两项目标测试退出码1。

截至本分项记录写入时，修复后的真实数据库绿色复验尚待主审统一执行。上述红测只能证明原缺陷，不能冒充修复验收通过。

## 已证伪的分页疑点与清理判断

曾怀疑沟通列表将`page=2147483647,pageSize=100`对应的大偏移传给Prisma会溢出。真实PostgreSQL定向执行返回正确空页，1项通过、退出码0，[证据](../verification/evidence/AUDIT-01-10-2026-11-14/integration-red-record-page.json)。因此没有修改生产分页实现，也未将此项计入缺陷；仅保留新增的大页码边界回归。

没有确认可安全删除的基础域死代码。任务来源、生命周期、计时、文件和状态适配器包含后续板块有效合同，检查了注册、依赖注入、公开导出及调用机制后保留。文件清理器重复bootstrap缺少保护的现象未证明正常生命周期中的实际后果，未据此改代码或宣称缺陷。未批量/递归删除文件或目录。

## 本分项实际执行的检查

以下命令均在`apps/api`执行，`node`实际为`D:\develop\nodejs\node.exe`。普通测试同时设置`NODE_OPTIONS`预加载`docs/verification/evidence/M0-04/step11/retain-artifacts.mjs`，并使用保留临时文件的配置；不拦截业务单文件删除，不放宽功能断言。

| 时间/检查 | 实际命令 | 结果 |
|---|---|---|
| 16:35:25，认证/任务/审计普通定向 | `node node_modules/vitest/vitest.mjs run --config test/verification/retained.config.mts test/audit-records.spec.ts test/auth-session.spec.ts test/task-kernel.spec.ts` | 退出码0，3文件27项通过。 |
| 16:39:22，文件普通首轮 | `node node_modules/vitest/vitest.mjs run --config test/verification/retained.config.mts test/files.spec.ts test/audit-records.spec.ts` | 退出码1；沙箱对AppData祖先目录的`lstat`返回EPERM，15项通过、21项因套件初始化失败未执行。分类为环境权限问题，未改产品校验。 |
| 16:39:46，文件普通原命令复验 | 同上一命令，通过执行权限恢复临时目录祖先读取 | 退出码0，2文件36项全部通过，临时目录保留。此36项与前组有15项重复审计用例，不累加为63个独立用例。 |
| 本轮修改文件Lint | `node ../../node_modules/eslint/bin/eslint.js src/records/communication.service.ts src/files/file-binding.service.ts src/files/files.service.ts test/records.integration.ts test/files.integration.ts` | 退出码0。仅本分项5个修改文件，不冒称全工程Lint。 |
| API类型检查 | `node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` | 退出码0；包含API源码及测试配置范围，不冒称两站/所有公共包均已检查。 |

初次分项未另行执行数据库、四服务Docker构建部署或全套浏览器检查，避免与主审并行修改/统一验证互相干扰；之后追加的真实数据库定向复验见下节。最终绿色集成、全工程检查、运行入口和板块1—10总验收以主审本轮记录为准。未执行Git暂存、提交或推送；测试数据及临时目录按本轮策略保留。

## 追加：真实订单沟通附件的存在性隐藏

主审在真实Docker验收发现：他人顾客读取已绑定的顾客可见沟通附件时，HTTP虽然为404，错误码却是`ORDER_NOT_FOUND`；随机不存在文件则返回`FILE_NOT_FOUND`，因而可推断附件关联订单。根因是`CommunicationFilesAdapter`复用真实ORDER沟通适配器时，未转换其明确的归属/不存在拒绝，订单错误穿透了文件入口。

在文件与沟通的桥接边界仅将明确的`OrderError`实例且`code === 'ORDER_NOT_FOUND'`转换为`FILE_NOT_FOUND`。其它领域冲突、真实数据库错误以及仅具有同名`code/status`的未知异常继续向外抛出，不用通用404判断掩盖故障。订单原有沟通接口继续保留`ORDER_NOT_FOUND`语义。

在`orders.integration.ts`新增两个用例，使用真实AppModule、订单归属、上传图片、沟通与文件引用，未用文件内核测试scope代替真实订单：

- 本人能读取元数据和实际二进制；他人访问元数据/内容与随机不存在文件统一404及文件错误码、消息；他人访问订单沟通接口仍为订单错误。
- 在已建立真实引用后注入实际只读SQL错误，确认Prisma的`P2010`继续抛出；`VERSION_CONFLICT`及伪装404的未知异常保持原异常对象；恢复注入后本人仍可正常读取。

| 日期/时间（2026-11-14） | 实际验证 | 结果与证据 |
|---|---|---|
| 17:03:58 | `node scripts/verify-audit-01-10.mjs integration communication-file-boundary-red test/orders.integration.ts --testNamePattern=文件边界：` | 迁移退出码0；测试1失败、1通过，测试退出码1。失败明确收到`ORDER_NOT_FOUND`而期望`FILE_NOT_FOUND`。[红测](../verification/evidence/AUDIT-01-10-2026-11-14/integration-communication-file-boundary-red.json)。 |
| 17:04:37 | 同runner，label=`communication-file-boundary-green`，文件=`test/orders.integration.ts`，pattern=`文件边界：\|IT06/08\|权限、脱敏` | 迁移/测试退出码0；3项通过，另27项未匹配定向范围。包括两个新增用例及原订单快照图片用例。[绿色](../verification/evidence/AUDIT-01-10-2026-11-14/integration-communication-file-boundary-green.json)。 |
| 17:05:33—17:05:46 | 同runner，label=`communication-file-compatibility`，文件=`test/files.integration.ts test/records.integration.ts`，pattern=`沟通\|私有文件业务锁` | 两库迁移及测试退出码全部0；files 4项、records 16项通过。仅为相关定向复验，不与主审全量重复累计。[衔接回归](../verification/evidence/AUDIT-01-10-2026-11-14/integration-communication-file-compatibility.json)。 |
| 17:04期间 | `node node_modules/eslint/bin/eslint.js apps/api/src/records/communication-files.adapter.ts apps/api/test/orders.integration.ts`；`node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --noEmit` | 两命令均退出码0。只代表修改文件Lint及API类型检查。 |

上述命令在项目根目录执行，node仍为`D:\develop\nodejs\node.exe`；runner创建的4个独占数据库、原红测现场及临时上传文件全部保留。未改已应用迁移、账号或目标业务数据，Docker最终镜像复验由主审统一完成。
