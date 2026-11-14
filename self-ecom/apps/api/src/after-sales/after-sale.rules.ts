// 作用：固定售后状态与申请资格，客户端不能决定金额、数量或交运事实。
import type {Order} from '@prisma/client';
export const afterSaleStatuses=['PENDING_REVIEW','WAIT_SUPPLEMENT','WAIT_FULFILLMENT_CHECK','WAIT_REFUND','WAIT_RETURN','WAIT_RECEIPT','WAIT_INSPECTION','INSPECTION_EXCEPTION','FINAL_INSPECTION','REFUNDING','REFUND_FAILED','REJECTED','WITHDRAWN','CLOSED','SUCCEEDED'] as const;
export const terminalStatuses=['REJECTED','WITHDRAWN','CLOSED','SUCCEEDED'];
export const activeAfterSale={status:{notIn:terminalStatuses}};
export const activeTaskStatuses=['OPEN','CLAIMED','SUSPENDED'] as const;
export const saleRef=(id:string)=>({businessType:'AFTER_SALE' as const,businessId:id});
export const orderRef=(id:string)=>({businessType:'ORDER' as const,businessId:id});
const messages={AFTER_SALE_NOT_FOUND:'售后不存在',AFTER_SALE_ALREADY_ACTIVE:'该订单已有进行中售后',ORDER_NOT_ELIGIBLE_FOR_AFTER_SALE:'订单当前不能申请售后',AFTER_SALE_WINDOW_EXPIRED:'已超过本订单在线售后申请期限，请联系店铺',AFTER_SALE_TYPE_NOT_ALLOWED:'未发货订单仅可申请仅退款',AFTER_SALE_ACTION_NOT_ALLOWED:'当前售后阶段不允许此操作',AFTER_SALE_CLOSE_FORBIDDEN:'当前事实不允许普通关闭，请联系管理员协调',AFTER_SALE_CLOSE_FACTS_REQUIRED:'售后关闭安全读取尚未接通',RETURN_ADDRESS_NOT_CONFIGURED:'尚未配置完整退货地址',RETURN_VERIFICATION_STALE:'寄回核实已失效，请重新核实',RETURN_IN_TRANSIT:'已有寄出或在途事实，不能普通关闭',COMMAND_PAYLOAD_CONFLICT:'同一动作键对应不同请求',VERSION_CONFLICT:'资料已变化，请刷新后核对',TASK_NOT_ASSIGNEE:'请先领取本轮对应任务',HANDOVER_VERIFICATION_REQUIRED:'请先核实真实交运结果',VALIDATION_FAILED:'请求参数不合法'} as const;
export class AfterSaleError extends Error{readonly status:number;constructor(readonly code:keyof typeof messages){super(messages[code]);this.status=code==='AFTER_SALE_NOT_FOUND'?404:code==='VALIDATION_FAILED'?400:409;}}
export function assertApplication(order:Order,type:string,now:Date){if(!['WAIT_SHIPMENT','SHIPPED','COMPLETED'].includes(order.status))throw new AfterSaleError('ORDER_NOT_ELIGIBLE_FOR_AFTER_SALE');if(order.status==='COMPLETED'&&(!order.afterSaleDeadline||+now>=+order.afterSaleDeadline))throw new AfterSaleError('AFTER_SALE_WINDOW_EXPIRED');if(order.status==='WAIT_SHIPMENT'&&type!=='REFUND_ONLY')throw new AfterSaleError('AFTER_SALE_TYPE_NOT_ALLOWED');}
