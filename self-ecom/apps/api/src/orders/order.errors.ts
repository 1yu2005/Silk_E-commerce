// 作用：订单错误统一脱敏，冲突只返回顾客可见的确认信息。
const messages = {
 ORDER_NOT_READY_TO_SHIP:'订单尚未具备发货条件',ORDER_BLOCKED:'订单当前暂停发货',PACKING_CHECK_STALE:'打包核对已失效，请重新检查整单',HANDOVER_ALREADY_PENDING:'已有未决交运动作，请按原动作核实',ORDER_ALREADY_SHIPPED:'订单已存在真实交运事实',HANDOVER_NOT_FOUND:'交运动作不存在',HANDOVER_RESULT_CONFLICT:'交运动作已有不同结论',COMMAND_PAYLOAD_CONFLICT:'同一动作键对应不同请求',HANDOVER_VERIFICATION_REQUIRED:'请先领取交运核实任务',TASK_NOT_ASSIGNEE:'请先领取当前对应任务',SHIPMENT_EXCEPTION_UNRESOLVED:'异常双确认或实物版本尚不满足',TRACKING_CHANGE_BLOCKED:'当前阶段不可修正运单',ORDER_NOT_RECEIVABLE:'订单当前不能确认收货',RECEIPT_BLOCKED:'订单收货处于暂停状态',AFTER_SALE_READER_REQUIRED:'售后模块已安装但履约读取尚未接通',SHIPMENT_EXCEPTION_NOT_FOUND:'发货异常不存在',
 VALIDATION_FAILED:'请求参数不合法', ORDER_AMOUNT_LIMIT:'订单金额超出允许范围', ORDER_NOT_FOUND:'订单不存在', QUOTE_NOT_FOUND:'报价不存在',
 ADDRESS_NOT_FOUND:'地址不存在', CUSTOMER_TRADE_RESTRICTED:'当前账号被限制新建订单', QUOTE_EXPIRED:'报价已到期，请重新确认', PRICE_CHANGED:'价格或运费规则已变化，请重新确认',
 ADDRESS_CHANGED:'收货地址已变化，请重新选择并确认', CART_CHANGED:'购物车数量或项目已变化，请重新确认', STOCK_INSUFFICIENT:'可售库存不足', PRODUCT_UNAVAILABLE:'商品或规格当前不可购买',
 PURCHASE_BLOCKED:'该规格暂停新购', IDEMPOTENCY_PAYLOAD_CONFLICT:'同一购买确认键对应的内容不同', REQUEST_IN_PROGRESS:'购买请求处理中，请沿用原请求重试',
 ORDER_PAYMENT_EXPIRED:'已超过付款截止，不能继续付款', ORDER_NOT_PAYABLE:'当前订单不能付款', ORDER_NOT_UNPAID:'当前订单不是待付款订单',
 ORDER_STOCK_BLOCKED:'订单实物待核实或补齐，暂不能付款', ORDER_STOCK_CHECK_REQUIRED:'实物损耗尚未核实，暂不能安全释放',
 STOCK_INCIDENT_CONFLICT:'库存异常事实或版本冲突，请重新读取', PHYSICAL_CHECK_STALE:'实物核实版本已变化，请重新核实', VERSION_CONFLICT:'数据已变化，请重新读取',
 INCIDENT_NOT_FOUND:'库存异常不存在', TASK_NOT_ASSIGNED:'请先领取当前核实任务', INCIDENT_UNRESOLVED:'仍有未核实或未处理的影响，不能解除',
} as const;
export type OrderErrorCode=keyof typeof messages;
export class OrderError extends Error {
 readonly status:number; readonly retryAfterSeconds?:number;
 constructor(readonly code:OrderErrorCode,readonly details?:unknown){super(messages[code]);this.name='OrderError';this.status=['ORDER_NOT_FOUND','QUOTE_NOT_FOUND','ADDRESS_NOT_FOUND','INCIDENT_NOT_FOUND','HANDOVER_NOT_FOUND','SHIPMENT_EXCEPTION_NOT_FOUND'].includes(code)?404:['VALIDATION_FAILED','ORDER_AMOUNT_LIMIT'].includes(code)?400:409;if(code==='REQUEST_IN_PROGRESS')this.retryAfterSeconds=1;}
}
