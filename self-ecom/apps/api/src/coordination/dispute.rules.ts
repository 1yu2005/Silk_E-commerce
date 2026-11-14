// 作用：争议及物品安排的稳定拒绝，不公开内部实物位置或证据。
const messages={DISPUTE_NOT_FOUND:'争议或物品安排不存在',DISPUTE_ALREADY_OPEN:'已有同类型待决定争议',DISPUTE_NOT_OPEN:'争议已经决定或撤销',CUSTODY_PLAN_INCOMPLETE:'物品安排未覆盖当前已核实的全部实物或在途事实',CUSTODY_FACT_STALE:'实物事实已变化，请重新核对',CUSTODY_EVENT_NOT_ALLOWED:'物品当前状态不允许此动作',AFTER_SALE_CLOSE_FORBIDDEN:'已有最终验收、回补、退款尝试或路线不允许关闭',HANDOVER_VERIFICATION_REQUIRED:'真实交运结果尚未核实',VERSION_CONFLICT:'资料已变化，请重新读取并核对',TASK_NOT_ASSIGNEE:'请先领取本轮对应任务',COMMAND_PAYLOAD_CONFLICT:'同一动作键对应不同请求',VALIDATION_FAILED:'请求参数不合法',COMMUNICATION_REQUIRED:'请引用当前售后的真实沟通记录'} as const;
export class DisputeError extends Error{readonly status:number;constructor(readonly code:keyof typeof messages){super(messages[code]);this.status=code==='DISPUTE_NOT_FOUND'?404:code==='VALIDATION_FAILED'?400:409;}}
export const custodyRef=(id:string)=>({businessType:'CUSTODY_ARRANGEMENT' as const,businessId:id});
export const activeCustody={status:{in:['PLANNED','IN_PROGRESS','EXCEPTION']}};
