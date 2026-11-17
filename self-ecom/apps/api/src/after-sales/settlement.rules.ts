// 作用：稳定的板块12业务拒绝，公开说明不含技术细节。
const messages={RETURN_PARCELS_PENDING:'仍有已登记但未收包的包裹，请实际收包；误登记须先撤销更正',RECEIPT_SOURCE_CANCELLATION_FORBIDDEN:'仅可撤销没有物流记录且尚未实收的仓储误登记',RECEIPT_ALREADY_RECORDED:'该包裹已经实际收包',RECEIPT_SOURCE_CONFLICT:'该实包来源已登记，请核对原标签',INSPECTION_INCOMPLETE:'当前实物尚未全部检查完成',INSPECTION_QUANTITY_MISMATCH:'实收、可售和应退数量不符',FINAL_INSPECTION_ALREADY_EXISTS:'该售后已经最终验收',EXCEPTION_APPROVAL_REQUIRED:'需要管理员异常全额退款批准',EXCEPTION_APPROVAL_STALE:'实物发生变化，须重新核对和批准',PHYSICAL_CHECK_STALE:'实物核实已失效，请重新核实',PHYSICAL_CHECK_INCOMPLETE:'全单可售及损耗尚未核实完整',REFUND_PRECONDITION_FAILED:'尚不满足退款条件',REFUND_ALREADY_SUCCEEDED:'该退款已成功，不能再次执行',VERSION_CONFLICT:'资料已变化，请刷新后核对',VALIDATION_FAILED:'请求参数不合法',HANDOVER_VERIFICATION_REQUIRED:'请先核实交运事实',TASK_NOT_ASSIGNEE:'请先领取当前轮次任务',COMMAND_PAYLOAD_CONFLICT:'同一动作键不能改变请求',AFTER_SALE_ACTION_NOT_ALLOWED:'当前阶段不允许此动作'} as const;
export class SettlementError extends Error{
 readonly status:number;
 constructor(readonly code:keyof typeof messages){super(messages[code]);this.status=code==='VALIDATION_FAILED'?400:409;}
}
export const activeTasks={status:{in:['OPEN','CLAIMED','SUSPENDED'] as ('OPEN'|'CLAIMED'|'SUSPENDED')[]}};
export const sameIds=(a:readonly string[],b:readonly string[])=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
export function normalizeReceiptSource(s:string){return s.normalize('NFC').trim().replace(/[A-Z]/g,c=>c.toLowerCase());}
