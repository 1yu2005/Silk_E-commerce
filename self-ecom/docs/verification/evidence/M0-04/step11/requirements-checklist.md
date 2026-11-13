# 板块4本轮需求核对

日期：2026-11-13；执行：Codex本机验证。代码基线为main / `5342a69`加保留的未提交板块4改动，不代表已提交或已完成最终文档交付。需求依据为板块文档1.1、1.2及SW/IT条目；本表只引用步骤11本轮证据。

## 本期8项范围

| 需求 | 实际实现 | 本轮证据与结论 |
|---|---|---|
| 全店设置及公开联系 | `src/settings`正式API、后台设置/历史/详情，商城公共布局联系信息 | 设置浏览器11项、生产Docker设置操作通过；整数分、8项期限、地址、电话、权限均有实际校验 |
| 版本并发保护、旧阶段快照 | Head行锁、expectedVersion、新版本只追加；Task保存来源版本和完整规则快照 | `settings.integration.ts`、`task-entry.integration.ts`通过；两管理员竞争、同内容不写、旧任务不回写、新阶段采用新配置 |
| 北京时间和期限事实 | `src/common/time`、`TaskDeadlineService`及事件服务 | `time.spec.ts`、`task-deadline.integration.ts`通过；UTC存储、周末/月年/闰年、截止等号、原截止不变和历史逾期保留 |
| 轮次与领取/交接 | Task/Cursor/History/DeadlineEvent正式表、查询与命令服务/API | `task-access/entry/reassign.integration.ts`及任务浏览器17项通过；真实连接并发、版本冲突、原因、资格、唯一领取和轮次保持 |
| 员工失去资格同步回池 | 员工停用/调岗/附加权限命令调用真实EligibilityService，复用同一事务 | `task-reassign.integration.ts`及三个员工模块回归通过；故障回滚、双方锁竞争、多任务与无关撤权均覆盖 |
| 扫描、失败和恢复 | 正式启动补扫/分钟扫描、逐项事务、唯一逾期事实、运行锁与失败记录 | `task-kernel.integration.ts`通过；115项分页、两实例、单项/全局失败、崩溃识别、停机补扫及完成/延期竞争；生产启动空扫描也通过 |
| BR-05暂停内核 | 纯规则、OrderTimerService事务端口及独立SQL适配器 | `order-timer.spec.ts`与`task-kernel.integration.ts`通过；多阻塞、只冻结/恢复一次、至少3天、补录交运、再次暂停、完成/退款及整组回滚 |
| 工作台及商城页面 | 我的待办/岗位池/管理员待安排、任务详情/操作/时间线与公开联系 | 两套浏览器28项整组通过，pageErrors为空；生产Nginx页面保存、历史、手机空态和电话链接通过 |

上述测试文件均位于`apps/api/test`，源码路径以`apps/api`为根；前端路径以实际工作区为准。完整普通/数据库日志见[全量普通结果](unit-attempt1.json)、[全量数据库结果](integration-attempt1.json)。成功写操作通过正式服务、认证、Prisma和审计，领域夹具只存在独占测试库。

## SW与IT逐项对应

SW原文是可手工复现的步骤。本轮采用同语义自动化HTTP/浏览器和真实SQL验收；只有Docker报告中明确记录的Swagger设置/摘要与文件操作进行了浏览器现场Authorize。没有把全部SW写成人工逐条执行。

| 条目 | 本轮状态 | 主要证据 |
|---|---|---|
| SW-01 初始化/权限 | 通过，自动化及生产Swagger读取 | 设置浏览器、Docker报告设置组 |
| SW-02 严格输入/409 | 通过，自动化 | settings集成、设置浏览器、Docker设置组 |
| SW-03 旧阶段不改/新阶段取新版本 | 通过，内核隔离夹具 | settings及task-entry集成 |
| SW-04 查询/领取竞争 | 通过，隔离HTTP与SQL | task-access集成、任务core组 |
| SW-05 释放/转交/阻塞 | 通过，隔离HTTP与SQL | task-access/reassign集成、任务core组 |
| SW-06 撤权/停用/调岗回池 | 通过，真实员工命令与夹具领域 | task-reassign集成、任务scope组 |
| SW-07 重复扫描 | 通过，内核SQL及生产空扫描 | task-kernel集成、Docker扫描组 |
| SW-08 延期保留旧逾期 | 通过，隔离HTTP与SQL | task-deadline集成、任务deadline组 |
| SW-09 首次指定/生产空态 | 通过，隔离动作及生产空态 | task-deadline集成、任务deadline/empty组、Docker任务组 |
| IT-01 时间边界 | 通过 | time普通测试、两端非北京时间浏览器 |
| IT-02 并发/轮次/约束 | 通过 | task-access/entry、tasks-schema/migration集成 |
| IT-03 变更同事务/竞争 | 通过 | task-reassign及员工status/role/extra-permission集成 |
| IT-04 设置快照/延期 | 通过，本期内核范围 | settings、task-entry/deadline集成 |
| IT-05 BR-05规则及端口 | 通过，本期内核范围 | order-timer普通、task-kernel集成 |
| IT-06 扫描恢复 | 通过 | task-kernel集成、生产启动记录 |
| IT-07 权限/字段 | 通过 | settings、task-access/reassign/deadline及前序认证集成 |
| IT-08 页面/全工程/前序回归 | 通过 | 756普通、1373集成、六工作区类型、Lint、生产构建、契约/漂移、28浏览器及21组Docker |
| SW-L01 真实补材料/补寄/售后发货新轮 | 待后续补验 | 真实业务尚未开发，不能用SQL夹具替代 |
| SW-L02 真实订单暂停与撤权闭环 | 待后续补验 | 真实Order/OrderBlock/TimerPause和交运/售后流程随后续板块接入 |

## 证据入口与限制

- [任务浏览器17项](../../../../../output/playwright/M0-04-step11/browser-tasks-attempt1/result.json)、[设置浏览器11项](../../../../../output/playwright/M0-04-step11/browser-settings-attempt1/result.json)：本轮各自整组通过，区别于步骤10分组证据；注入的读取/网络故障仅验证错误保护。
- [四服务Docker21组/164次HTTP](../../../../../output/playwright/M0-04-step11/docker-attempt1/result.json)：独立空卷与随机端口，前三板块认证/文件一起回归；测试项目已清理，原项目资源保留。
- [实际部署](deployment.json)、[开发库只读](development-readonly-deployed-final.json)：现有四服务healthy；数据库容器及卷保留，旧12表摘要和四迁移保持，临时库残留0。Head仍0/null；任务为空是当前缺业务的正确结果。
- 生产模块不注册测试领域或造任务HTTP。真实业务仓储缺失时明确拒绝；当前通过的领取、回池、暂停等内核场景，不代表完整服装订单链路完成。
- 本轮未新增生产迁移、依赖、配置要求、开发账号或演示经营数据。原账号和密码保持；扫描正常新增SchedulerRun，不宣称数据库完全无新增行。
- 未执行：用户逐条人工验收、全套交付文档收尾。总览/项目README/板块交付清单/最终开发完成说明留后续指令；本轮只更新设计与验证证据。
