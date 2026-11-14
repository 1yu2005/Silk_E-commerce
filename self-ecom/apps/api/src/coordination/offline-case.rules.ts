// 作用：线下工单独立于系统交易；时间、记录金额与更正关系由领域命令复核。
export const offlineCaseTypes=['EXPIRED_AFTER_SALE','FORWARDING','EXTRA_RESHIPMENT','EXTERNAL_COMPENSATION','CUSTODY_FOLLOW','OTHER_SERVICE'] as const;
export const offlineCaseStatuses=['OPEN','IN_PROGRESS','WAIT_EXTERNAL','RESOLVED','CLOSED'] as const;
export const offlineEventKinds=['CONTACT','PROGRESS','EXTERNAL_RESULT','CORRECTION'] as const;
export const offlineChannels=['PHONE','EXTERNAL_MESSAGE','IN_PERSON','OTHER'] as const;
export const offlineRef=(id:string)=>({businessType:'OFFLINE_CASE' as const,businessId:id});
export const offlineActive={status:{in:['OPEN','CLAIMED','SUSPENDED'] as ('OPEN'|'CLAIMED'|'SUSPENDED')[]}};
export const offlineTerminal=(status:string)=>status==='RESOLVED'||status==='CLOSED';
const messages={OFFLINE_CASE_NOT_FOUND:'线下工单不存在',OFFLINE_CASE_ACTION_NOT_ALLOWED:'当前工单状态不允许此操作',OFFLINE_CASE_HAS_PENDING_ACTIONS:'仍有未完成物品安排或管理员争议，请继续处理',VERSION_CONFLICT:'资料已变化，请刷新核对',TASK_NOT_ASSIGNEE:'请先领取本轮对应任务',COMMAND_PAYLOAD_CONFLICT:'同一动作键对应不同请求',REQUEST_IN_PROGRESS:'请求正在处理，请使用原动作键恢复',VALIDATION_FAILED:'请求参数不合法'} as const;
export class OfflineCaseError extends Error{
 readonly status:number;
 constructor(readonly code:keyof typeof messages){super(messages[code]);this.status=code==='OFFLINE_CASE_NOT_FOUND'?404:code==='VALIDATION_FAILED'?400:409;}
}
export function offlineTime(value:string|Date,now:Date,allowFuture=false){
 const date=value instanceof Date?value:new Date(value);
 if(!Number.isFinite(+date)||+date<0||!allowFuture&&+date>+now)throw new OfflineCaseError('VALIDATION_FAILED');
 return date;
}
export interface OfflineEventFacts{kind:string;occurredAt:string;reportedAmountCents?:number;externalPaymentAt?:string;externalVerification?:string;carrier?:string;tracking?:string;correctsEventId?:string;waitExternal?:boolean;nextStep?:string;nextFollowAt?:string;adminDecision?:string;basedAdminRequestEventId?:string;expectedAdminTaskVersion?:number}
export function offlineEventFacts(input:OfflineEventFacts,now:Date){
 const occurredAt=offlineTime(input.occurredAt,now);
 if((input.kind==='CORRECTION')!==!!input.correctsEventId)throw new OfflineCaseError('VALIDATION_FAILED');
 if(input.reportedAmountCents!==undefined&&(!Number.isInteger(input.reportedAmountCents)||input.reportedAmountCents<0||input.reportedAmountCents>100000000))throw new OfflineCaseError('VALIDATION_FAILED');
 if((input.reportedAmountCents!==undefined)!==!!input.externalVerification||input.externalPaymentAt&&input.reportedAmountCents===undefined)throw new OfflineCaseError('VALIDATION_FAILED');
 if(input.externalVerification&&!['DECLARED','VERIFIED'].includes(input.externalVerification))throw new OfflineCaseError('VALIDATION_FAILED');
 if(!!input.carrier!==!!input.tracking||input.tracking&&!/^[A-Za-z0-9-]{1,100}$/.test(input.tracking))throw new OfflineCaseError('VALIDATION_FAILED');
 if(input.waitExternal&&(!input.nextStep?.trim()||!input.nextFollowAt))throw new OfflineCaseError('VALIDATION_FAILED');
 if(input.adminDecision==='REQUEST'&&(input.kind!=='PROGRESS'||input.basedAdminRequestEventId||input.expectedAdminTaskVersion!==undefined))throw new OfflineCaseError('VALIDATION_FAILED');
 if(input.adminDecision&&input.adminDecision!=='REQUEST'&&(!['APPROVED','DECLINED'].includes(input.adminDecision)||input.kind!=='EXTERNAL_RESULT'||!input.basedAdminRequestEventId))throw new OfflineCaseError('VALIDATION_FAILED');
 if(!input.adminDecision&&(input.basedAdminRequestEventId||input.expectedAdminTaskVersion!==undefined))throw new OfflineCaseError('VALIDATION_FAILED');
 return {occurredAt,externalPaymentAt:input.externalPaymentAt?offlineTime(input.externalPaymentAt,now):null,nextFollowAt:input.nextFollowAt?offlineTime(input.nextFollowAt,now,true):null};
}
