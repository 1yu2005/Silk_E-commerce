# 板块13需求与验证定位审查

审查日期：2026-11-14～15（Asia/Shanghai）。本表定位正式领域实现与本轮测试，不把测试文件存在视为测试通过，也不代替浏览器端到端验收。

本子任务已亲自运行并确认的证据：

- `evidence/M3-13/2026-11-14T16-23-50-234Z-stopped-refund-new-application-combination`：停止未交运退款后的原订单新申请组合补齐，完整争议集成13/13通过。第4测经真实顾客apply和客服review进入新实物核实轮，旧close原键仅重放旧售后CLOSED，不改变新售后/订单/阻塞/任务；旧check退款实际拒绝PHYSICAL_CHECK_STALE且无Attempt或回补，新check才可成功退款，原支付/旧check历史保持，成功重放不重复回补。本次替换第4测的覆盖内容，不增加或重复累计测试数。
- `evidence/M3-13/2026-11-14T15-53-05-228Z-custody-cross-arrangement-fixed`：争议集成13/13通过，含关闭/首次退款双顺序锁屏障、退款优先旧提请与来源结束、退款原key恢复、真实上传的管理员/仓储私有凭据及跨售后复用拒绝，以及同订单不同物品安排的更正命令键隔离。此前12测已包含在此次13测中。
- `evidence/M3-13/2026-11-14T15-51-56-369Z-custody-cross-arrangement-red`：修复前新增跨安排用例真实失败、原12测通过，接口把第二安排id与第一安排taskId拼成错误重放；对应修复后的13测验证跨安排冲突、原安排重放、另一安排新key正确归属。
- `evidence/M3-13/2026-11-14T15-55-32-517Z-settlement-refund-dispute-final`：退款来源衔接后的结算全套28/28通过，包括退款失败/原key恢复、回补/损耗竞争、0014旧资料升级当前0016及重复deploy。旧测试精确迁移数量从15更新为16，旧事实保护断言完整保留。
- `evidence/M3-13/2026-11-14T15-57-39-312Z-task-fixture-coordination-regression`：旧任务内核5套完整复验220/220通过（access38、deadline57、entry34、kernel47、reassign44）。仅在其TestingModule显式隔离新增OfflineCase/Custody生产适配器，使原真实SQL夹具保持独占注册；生产重复注册守卫、原缺失模块/锁否定断言全部保留。新增coordination套件仍使用真实AppModule与生产注册。
- `evidence/M3-13/2026-11-14T15-35-07-099Z-migration-upgrade-third`：0015→0016旧资料升级与重复deploy 1/1通过。所有旧表原有列逐行一致，原迁移checksum不变；新字段为NULL，不将迁移夹具描述为业务操作/真实上传验收。
- 独占库每次均全量应用0001～0016；测试自建升级库只归本轮所有，结束关闭连接后删除数据库。临时迁移文件目录保留，无递归删除文件。

| 文档验收项 | 实现与自动化定位 | 审查意见 |
|---|---|---|
| SW-01 双异常同版本双确认 | `FulfillmentService`、`coordination-handoffs.integration.ts`第1测；`fulfillment.integration.ts`双来源/WAIT/旧版本场景 | 共用原TaskBusinessSource，仅结束自身来源；原版本变化不继承意见。运行结果采用根任务本轮全量证据。 |
| SW-02 退款意见→正式售后 | `CoordinationService.fromException`、`coordination-handoffs.integration.ts` | 顾客同意与真实Communication、显式领单、既有售后唯一、PENDING_REVIEW独立审核、逐行check后全退、冻结双Task消费、审计回滚及并发已有专测。 |
| SW-03 未付改址取消重下 | `CoordinationService`、`coordination-address.integration.ts`未付改址场景 | 原地址/截止保留、不新增付款释放阻塞、顾客正式取消；订单快照保护由原订单测试补验。 |
| SW-04 已付未交改址暂停/移交 | 同上已付改址/继续原址/审计回滚场景 | 已领发货暂停、仓储独立核实、原子新售后阻塞移交；他来源仍保留、新发货轮不继承经办。 |
| SW-05 未知交运/已交转寄 | 改址集成未知Attempt/已交转寄/屏障竞争；履约集成历史运单更正 | 保留Attempt、原Shipment与地址不覆盖；工单仅记线下事实。 |
| SW-06 待付受损关闭/支付仲裁 | `orders.integration.ts`SW08、真实锁屏障三路线 | 复用原A/R与TD-11事实，不能仅以改址解除库存安全守卫。 |
| SW-07 异常全退批准 | `ReturnInspectionService`、`settlement.integration.ts`少件批准/移动失效/零可售/故障回滚 | 批准与最终核实分离，批准后新包裹/实物变化失效；退款失败不二次回补。 |
| SW-08 部分实收受限结案 | `DisputeService`、`coordination-disputes.integration.ts` | 实物逐Receipt当前版本覆盖；不改库存/Payment、不写FinalInspection/Refund；独立Custody/Offline任务持续，真实寄还签收后才resolve。 |
| SW-09 禁区/停止未交运退款 | 同上零可售FinalInspection、任意失败Attempt、核实失效回退、STOP_UNSHIPPED_REFUND、原订单新申请/审核/旧check拒绝/新check退款、关闭/验收与关闭/首次退款屏障竞争 | 锁内读取真实事实，核实/批准失效不删除历史；旧close原键只恢复旧售后，不结束新申请或释放其来源；新申请须重新核实。 |
| SW-10 冻结代录申请 | `ProxyInputService`、`proxy.integration.ts` | 原顾客token不可用；员工真实主体、一次Context、PROXY_INPUT显式领取、原领域支付/窗口/进行中唯一复用。 |
| SW-11 材料/物流/窗口 | 同上材料图片/物流两修订/期限测试 | 单号不是实收；窗口内旧售后到期后仍可补材料/物流；新申请超期拒绝。 |
| SW-12 Context失效/解冻撤权 | `ProxyInputService`、失效hook/扫描、proxy与handoffs屏障竞争 | 顾客statusVersion和员工主体锁、只取消自身来源、成功结果按当前有效身份恢复；不同员工不能继承核实。 |
| SW-13 超期线下诉求 | `OfflineCaseService`、`coordination-offline.integration.ts` | 独立OPEN→显式领取→begin/WAIT_EXTERNAL/resolve，管理员独立争议Task，原售后不重开。 |
| SW-14 线下金额/额外寄件 | 同上外部金额/运单/更正/公开投影测试 | 仅追加记录，不改Payment/Refund/InventoryAction；原事件不可覆盖，公开字段明确投影。 |
| SW-15 资格/转交/多来源 | 原task-reassign与task-access集成；新Custody/Offline/Proxy适配器 | 候选权限/当前经办锁内复核；完成Custody若需CORRECTION创建新OPEN轮、另行领取，只追加更正不改原去向。 |
| SW-16 期限/多阻塞/隐私 | 原fulfillment的BR05 0/2/5天、task-deadline及after-sales/settlement测试；新角色/附件HTTP专测 | 最后来源解除才重算期限、完成/退款不恢复；仓储不得读客服/身份核实详情。 |
| SW-L01 跨14/15补验 | 由后续板块真实统计/审计/部署验收覆盖 | 本表不将板块14/15标为完成。 |

| 集成验收项 | 覆盖定位与剩余证据要求 |
|---|---|
| IT-01 唯一/归属/幂等 | 0016 FK/CHECK/ownership triggers，地址/代理/争议/工单专测；跨Receipt/OrderItem/请求/文件拒绝，原事件不可变。 |
| IT-02 结案竞争 | disputes屏障控制close先于finalize、close/refund双顺序，零可售与失败Attempt后check失效仍禁止关闭；当前实收变更使旧请求失效。 |
| IT-03 状态/权限竞争 | handoffs代录/解冻屏障、proxy同键并发/撤权，原task员工资格竞争回归。 |
| IT-04 库存仲裁 | 原orders真实支付/异常/取消屏障及settlement损耗/refund双顺序回归。 |
| IT-05 地址/交运/移交 | coordination-address屏障、handoffs同key并发/审计回滚；真实来源不放行空隙。 |
| IT-06 物品/线下事件 | disputes部分实收、去向漏项/超量、独立后续、计划/事件不可变、完成后更正新轮；offline外部记录无交易副作用。 |
| IT-07 任务/期限/来源 | 新适配器复用Task内核；原task/after-sale/settlement/fulfillment全量回归结果以根任务证据为准。 |
| IT-08 故障/重启 | 新协作审计末端全回滚和原key恢复已有专测；原settlement包含双Nest/Prisma实例与数据库会话中断回滚。`docker-browser-complete/result.json`已通过独占Compose数据库/API重启及API重建，工单/物品事件/代录上下文/私有图片持久保留；数据库与uploads同一窗口备份和独立恢复仍属板块15，不能由重启代替。 |
| IT-09 隔离/错误契约 | 新HTTP强制字段白名单、角色/当前权限和私有附件；原query/FileBusinessAdapters规则复用。`docker-browser-complete/result.json`已通过客服/管理员争议页面、仓储物品领取/寄还/签收、冻结代录和顾客公开投影真实浏览器流程及截图；local-demo补常用环境原账号流程，公开副本已遮罩收货信息。 |
| IT-10 全链路前序补验 | handoffs真实申请→审核→核实→退款、disputes真实结案→仓储寄还→客服resolve、proxy三类输入、offline状态记录均有领域/HTTP集成。不能由这些测试代替实际浏览器端到端截图。 |
| IT-11 工程/迁移 | 专用0015→0016逐列旧资料保护/重复deploy已通过；新库16迁移多次成功。最终lint/typecheck/build/契约及全量结果由根任务统一出证。 |

本轮审查发现并已在实现中处理的实际问题：

1. 争议请求旧事实版本过期后不能永久占住同kind OPEN唯一。当前版本不同的新提请将旧请求WITHDRAWN、只结束旧来源，建立新的管理员任务轮，完整历史保留。
2. 完成物品安排后不能通过旧完成Task直接改历史。专用correction-followups建立新任务、另行领取后仅追加CORRECTION，安排仍COMPLETED、库存与原去向不变。
3. 物流预填NOT_YET_SENT不等于实际在途；真正DECLARED_SENT/IN_TRANSIT事实才要求后续在途安排。无物品NO_GOODS不得掩盖实收或在途。
4. 未匹配实物读模型缺少稳定id将无法按真实来源安排。读响应已补id，草稿输入仍严格不接受id，避免把读模型直接回传写接口。
5. CustodyEvent私有凭据已按真实owner批量读取fileId，物品执行页可复查原凭据；下载仍经现有文件授权，无磁盘路径或公开URL。
6. 开放争议提请不能使合法退款因TASK_SOURCE_ACTIVE整笔回滚。退款成功事务仅按本售后DisputeRequest结束ACTIVE DISPUTE_REQUEST来源，再将OPEN请求WITHDRAWN并保留原记录；不清理独立物品安排或线下工单。双顺序屏障已验证退款与关闭最多一条路线成功，库存最多回补一次。
7. 管理员结案凭据上传用途须与既有FilePolicy的COMMUNICATION_EVIDENCE一致，仓储物品事件仍使用INSPECTION_EVIDENCE；真实上传/绑定/下载测试验证用途和权限，无放宽文件policy。
8. 物品更正任务按订单/action/key保存结果时，命令摘要须包含路径arrangementId。现同订单不同安排复用同key会稳定拒绝COMMAND_PAYLOAD_CONFLICT，不能把旧taskId重放为新安排的任务；各自新key独立创建新轮，原安排原key仍恢复原结果。

最终统一证据已补齐：当前51套1665个不同数据库测试见去重对账，最终普通787项、类型/Lint/构建及199操作/197调用器契约均有本轮结果。独占Docker真实浏览器10组/301条响应记录、各岗位切换、内图、丢响应刷新恢复、DB/API重启及API重建、完整契约一致性和原资源保护均通过，见[最终隔离结果](evidence/M3-13/docker-browser-complete/result.json)。此为重启持久化，数据库＋上传完整备份恢复仍必须由板块15实际执行。

## 2026-11-15 前置遗留衔接补验追加

- [M2-10追加记录](M2-10.md)：SW-L01真实售后/交运/计时来源复验；SW-L02真实退款终态、消费扣回和**实际REFUNDED之后**管理员HTTP历史运单纠错。新组合位于`coordination-handoffs.integration.ts`首测，原本“第1测双异常”现为第2测，定位优先使用测试名称。完整9/9于UTC 2026-11-14 16:12:08.789～16:12:35.002通过，[命令结果](evidence/M3-13/2026-11-14T16-12-08-787Z-coordination-refunded-tracking-final/result.json)和[输出](evidence/M3-13/2026-11-14T16-12-08-787Z-coordination-refunded-tracking-final/output.redacted.txt)保留。只有承运人/单号及revision、命令/审计历史变化；原Shipment/Attempt、资金、库存、完成窗口与任务/计时事实保持，重放不重复写入。
- [M3-11追加记录](M3-11.md)：SW-L01真实验收/一次回补/失败重试/终态，以及SW-L02管理员受限结案、持续物品义务、冻结单动作代录、超期独立OfflineCase、共享来源及隐私补验。
- [M3-12追加记录](M3-12.md)：SW-L01真实争议、停止未交运退款、冻结代录、独立Task与晚到仓/补寄；SW-L02完整统计审计及最终系统/性能/备份恢复仍留板块14/15实际执行。

以上前置条目为领域和选定真实HTTP证据，浏览器证据独立列于最终隔离结果。最新[51套1665项去重对账](evidence/M3-13/integration-reconciled.json)采用49套首轮＋受影响完整套件复验＋新增套件；不是再次全量运行。首轮整体退出1保留，普通测试另列，重复执行不累计。[常用部署](evidence/M3-13/deployment-final.json)通过，原资料与账号保护通过；正式演示和Git/CI状态见主验收记录。

2026-11-15补齐M3-12 SW-L01“停止未交运退款后原窗口内重新申请”必要组合。真实执行命令与UTC起止见[结果](evidence/M3-13/2026-11-14T16-23-50-234Z-stopped-refund-new-application-combination/result.json)，[完整输出](evidence/M3-13/2026-11-14T16-23-50-234Z-stopped-refund-new-application-combination/output.redacted.txt)记录0001～0016完整迁移、争议13/13及退出0。原待发订单申请资格和支付/付款截止/售后截止未重写；新的PENDING_REVIEW任务不继承经办，审核后PHYSICAL_VERIFY新轮须显式领取，新售后check与旧INVALIDATED check分别归属。该组合仅补测试，未修改生产实现；API类型检查及测试文件ESLint均退出0。

常用部署及原资料、账号保护通过后，已按四份实际验收结果明确列出的项目逐个核对Compose项目标签和完整容器ID，仅停止本轮16个独占验收容器以释放板块14/15资源；16次停止命令均退出0。容器本身、8个独占卷、全部证据与4份私有浏览器profile仍保留，其他14个容器状态及全部原卷保持，未删除任何资源。停止清单、精确ID、退出码和保留核验见[隔离资源停止记录](evidence/M3-13/isolated-resources-stopped.json)。
