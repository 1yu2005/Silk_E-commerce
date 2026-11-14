// 作用：协作错误只返回固定说明，不将地址、核实记录或内部实物位置带出。
const messages = {
 COORDINATION_NOT_FOUND:'协作记录不存在', ADDRESS_REQUEST_ALREADY_OPEN:'该订单已有待处理改址诉求',
 ADDRESS_REQUEST_NOT_OPEN:'改址诉求已移交或结束', VERSION_CONFLICT:'资料已变化，请重新读取并核对',
 TASK_NOT_ASSIGNEE:'请先领取本轮对应任务', COMMAND_PAYLOAD_CONFLICT:'同一动作键对应不同请求',
 COMMUNICATION_REQUIRED:'请引用本来源的明确顾客意见沟通记录', PHYSICAL_CHECK_STALE:'实物事实已变化，请重新核实',
 HANDOVER_VERIFICATION_REQUIRED:'请先核实真实交运结果', ADDRESS_ROUTE_NOT_ALLOWED:'当前订单事实不能使用该改址路线',
 VALIDATION_FAILED:'请求参数不合法', AFTER_SALE_ALREADY_ACTIVE:'该订单已有进行中售后',
} as const;
export class CoordinationError extends Error {
 readonly status:number;
 constructor(readonly code:keyof typeof messages){super(messages[code]);this.status=code==='COORDINATION_NOT_FOUND'?404:code==='VALIDATION_FAILED'?400:409;}
}
export const activeCoordinationTasks={status:{in:['OPEN','CLAIMED','SUSPENDED'] as ('OPEN'|'CLAIMED'|'SUSPENDED')[]}};
