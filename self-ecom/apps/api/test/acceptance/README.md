# 板块4任务隔离验收应用

这里只验证任务内核和页面，订单/售后由真实SQL夹具替代，不表示真实服装业务已开发。生产AppModule不导入这里，也没有造任务HTTP接口。

## 启动

在项目根目录使用两个终端。保持现有数据库容器运行，真实.env须已有不同名的DATABASE_URL和TEST_DATABASE_URL；不需要修改.env。

当前常用Docker API也映射到3001，与本隔离应用冲突。需要手动体验时，先停止Docker的api服务，保留数据库和数据卷：

```powershell
docker compose --env-file .env -f infra/compose.yaml stop api
```

此时8080/8081的API暂不可用；原本机3000/5173/5174不受这条命令影响。确认3001空闲后再启动下方隔离应用，不结束未知进程，不将5175代理改到正式API。这里只是操作说明，文档收尾没有执行启停。

终端一：

```powershell
pnpm --filter @shop/api test:tasks:fixtures
```

会先编译独立test入口，然后新建`task_acceptance_<随机ID>_test`，部署现有迁移并初始化账号/四类夹具。每次都是新库，不重置现有shop_test。只允许test环境，生产进程环境明确拒绝。

- Swagger：<http://127.0.0.1:3001/api/docs>。
- 账号：task_admin（验收管理员）、warehouse_a/warehouse_b（仓储甲/乙）、support_a/support_b（客服甲/乙），均启用且已改密。
- 登录密码每次随机生成，仅在启动终端显示，不写入仓库。这里只存在临时测试账号，原Iris和顾客账号不变。
- 使用Swagger时，先调用员工登录，再将accessToken本体填入Authorize；不要将密码或令牌截图写入证据。

终端二：

```powershell
pnpm --filter @shop/admin-web dev:tasks:acceptance
```

访问<http://127.0.0.1:5175/tasks>，使用终端一显示的账号/密码。5175只代理3001，原3000/5173/5174保持原开发用途。两个应用都只绑定本机，端口冲突时不杀已有服务。

如本机PowerShell的pnpm包装器不可用，可以用已有Node直接运行，不重新安装依赖：

```powershell
node apps/api/scripts/task-acceptance.mjs --fixtures
node apps/admin-web/scripts/tasks-acceptance.mjs
```

## 夹具与建议操作

| 名称 | 初始状态 | 用途 |
|---|---|---|
| 验收-T1 | 待领取、仓储资格、无自动期限 | 仓储甲领取/释放，管理员转交仓储乙或首次指定截止 |
| 验收-T2 | 待领取、客服审核、已逾期 | 查看当前逾期，管理员延期后核对原截止/曾逾期及统一历史 |
| 验收-T3 | 客服甲已领，附加inventory.read及其完整依赖 | 管理员从员工详情撤销其个人额外资格，核对任务回池、待安排和历史 |
| 验收-T4 | 仓储甲已领，真实SQL领域状态不可安全释放 | 页面不提供释放；Swagger强行提交仍409 TASK_RELEASE_BLOCKED |

任务和员工ID都由启动终端输出。转交候选来自真实员工列表；选择客服接仓储任务仍由服务器拒绝，不靠下拉框制造成功。刷新、筛选、分页、领取/释放/转交/延期使用正式API、Guard、事务和审计。

查看无任务页面时，终端一改用`pnpm --filter @shop/api test:tasks:serve`或`node apps/api/scripts/task-acceptance.mjs`，会新建无任务、未设置的隔离库，同时准备上述五个登录账号。该空态与生产尚无真实业务时一致。

## 退出及限制

先在5175终端Ctrl+C关闭页面服务，再在3001终端Ctrl+C。正常关闭会先释放应用连接，再删除**本轮创建的明确专属数据库**。不删除工作区文件，不操作开发库或其它库，不强制终止未知连接。

如果开始前停止了Docker API，在3001隔离进程完全退出后恢复原服务：

```powershell
docker compose --env-file .env -f infra/compose.yaml up -d --no-deps --wait api
```

如果进程被系统强杀，正常关闭逻辑可能未执行。根据启动终端的完整库名核对后手动处理残留库；不要用批量清理或模糊匹配删除。启动脚本不会为了清理旧库而删除其它运行的数据。

test环境不自动开启一分钟扫描器；内核扫描的真实重入、运行记录、故障与恢复由本步HTTP烟测和步骤9的专属库测试验证。本应用没有通用完成/暂停/造任务或任意SQL接口。真实领域阶段重入和BR-05订单闭环仍随后续订单/发货/售后板块补验。
