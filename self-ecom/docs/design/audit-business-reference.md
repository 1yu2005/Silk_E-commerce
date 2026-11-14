# 板块14审计业务引用及维护

2026-11-15，增量迁移 `0017_reporting_audit_query_indexes`。审计查询使用确定的业务引用检索订单、售后、退款、库存调整、线下工单。原 `AuditLog` 字段、发生时间和原因不改写；引用的 `createdAt` 只表示投影建立时间。

`AuditService.appendAudit` 在调用方原事务内保存审计并调用共用解析器，再 `createMany(skipDuplicates)`。数据库强制审计 FK RESTRICT、固定业务枚举、三字段主键及非空标识。引用插入失败向上传播，业务、审计、命令结果共同回滚。无引用公共 CRUD 或读取时补写。

解析只读真实对象的稳定编号及关系：订单直接归属；售后到订单；退款到售后/订单；任务到真实 businessType/businessId；库存动作支持订单、支付、退款、退货最终验收、调整；支付到订单，最终验收到售后及订单；缺货事件经逐项订单明细关联多张订单，库存购买限制经真实事件关联；沟通按真实范围；改址、争议、保管、代录、线下事件按其真实实体关联。Coordination仅以受控动作辨别目标实体，不信任快照中的 orderId/businessId。上传、身份、目录、设置等没有本期五类业务引用。不会使用 requestId 相邻、自由文本或任意 JSON 猜归属。

明确 refund/refund-retry 动作引用实际退款；早期申请/审核日志不会因后来退款而补挂退款。代录创建/失效记录不会挂上后来的执行结果；消费动作可通过真实 ProxyExecution 关联结果售后。发货异常移交日志须与真实移交来源及结果售后同时匹配，才关联该售后，早期异常日志不会倒挂后来移交结果。未知动作或缺失对象只报告诊断，不能声称所有历史均可按业务号搜到。已有 targetId 为 varchar(100)，先验证 UUID 形状后以小写规范值查询 UUID 列，保留原日志标识及大小写，不整表强制转型。

在 API 目录运行维护命令：

```powershell
node node_modules/tsx/dist/cli.mjs scripts/backfill-audit-references.ts --apply --checkpoint ../../output/testing/M4-14/audit-reference-checkpoint.json --batch-size 200 --max-batches 100
```

命令沿用既有私有配置 `DATABASE_URL`，不输出连接信息。检查点父目录须已存在；检查点包含数据库身份散列及 version/highWater/after，不含凭据。每批上限1000，单次批数上限10000；默认200×100，达到批数上限会保留断点并输出 done=false。每批读取和追加引用使用短 REPEATABLE READ 事务；仅在提交后原子替换断点。固定最大 `(createdAt,id)`，以同一双字段 keyset 前进；事务失败或进程中断后重复上一批不会重复插入。输出只有本次扫描/新增量、诊断次数及最多20个日志 ID 样本，不输出快照、原因或业务隐私。

同一断点用于恢复当前高水位；要扫描此后新增的历史，另选新断点文件。在线审计已有同事务引用。完成断点重跑扫描/新增0；从头重跑新增0。缺失关系后来修复时另开新断点重跑，不修改旧日志。

本轮定向验证见 `reporting-audit-references.integration.ts` 和 `reporting-migration.integration.ts`。迁移覆盖空库全链和0016旧库逐列快照、旧迁移校验和、重复部署；审计覆盖真实支付/任务/退款/线下、伪造快照、回填边界/断点/幂等、数据库约束及真实插入故障回滚。全部在本轮 m414 随机独占库，临时目录保留，结束仅移除已创建的专属数据库。
