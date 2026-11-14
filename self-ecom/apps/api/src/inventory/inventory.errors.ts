// 作用：库存业务拒绝使用固定错误码，HTTP层只输出经过筛选的关联信息。
const messages = {
 VALIDATION_FAILED:'请求参数不合法', INVENTORY_NOT_FOUND:'库存账户不存在', SOURCE_NOT_FOUND:'库存来源不存在',
 ADJUSTMENT_NOT_FOUND:'库存登记不存在', VERSION_CONFLICT:'资料已更新，请刷新后确认', SOURCE_ALREADY_EXISTS:'同范围的来源凭据已经存在，请复用原来源',
 SOURCE_BATCH_ALREADY_POSTED:'此来源行和批次已经入账', SOURCE_QUANTITY_EXCEEDED:'来源净入账量超过核实数量',
 SOURCE_QUANTITY_BELOW_POSTED:'核实数量不能少于净已记数量', STOCK_INSUFFICIENT:'可用数量不足，已保留待核实任务',
 INVENTORY_LIMIT_EXCEEDED:'库存计算结果超出整数范围', CORRECTION_NOT_ALLOWED:'更正必须指向已入账原根明细，且保持合法净量',
 INVENTORY_ACTION_CONFLICT:'同一库存动作的内容不一致', INITIAL_CONVERSION_CONFLICT:'此草稿已按不同来源或批次转换',
 INITIAL_DRAFT_EMPTY:'数量草稿没有非零明细', INITIAL_DRAFT_NOT_EDITABLE:'数量草稿不能转换',
 ADJUSTMENT_NOT_PENDING:'只有待确认登记可以执行此操作', TASK_NOT_ASSIGNEE:'请由当前合资格经办处理',
 INVENTORY_CHECK_REQUIRED:'登记需要先完成核实', INVENTORY_CHECK_UNRESOLVED:'核实问题尚未解决',
 INVENTORY_DOMAIN_NOT_READY:'真实业务事实适配器尚未接入', ORDER_STOCK_BLOCKED:'订单库存受损尚未核实，不能付款或释放',
 PHYSICAL_CHECK_STALE:'实物核实版本已失效，请重新核实', RESTOCK_NOT_ALLOWED:'不满足最终回补条件',
} as const;
export class InventoryError extends Error {
 readonly status:number;
 constructor(readonly code:keyof typeof messages, readonly details?: {adjustmentId?:string;number?:string;checkRequired?:boolean}) {
  super(messages[code]); this.name='InventoryError'; this.status=code==='VALIDATION_FAILED'?400:code.endsWith('NOT_FOUND')?404:409;
 }
}
