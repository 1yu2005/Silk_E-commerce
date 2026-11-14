// 作用：受控代录的真实主体、单动作范围和当前冻结版本检查；不创建顾客会话。
import type {Prisma} from '@prisma/client';
import type {TaskCommandActor} from '../tasks/task-business-adapters.js';
import {salePermission} from '../after-sales/after-sale.access.js';

export const proxyActions=['APPLY_AFTER_SALE','SUPPLEMENT','RETURN_LOGISTICS','OFFLINE_RESULT'] as const;
export type ProxyAction=typeof proxyActions[number];
export interface AfterSaleInputOrigin {readonly proxyContextId?:string;readonly representedCustomerId:string;readonly sourceCommunicationId:string;readonly assistance:true}
const messages={PROXY_CONTEXT_NOT_FOUND:'身份核实上下文不存在',PROXY_CONTEXT_EXPIRED:'本次身份核实已过期，请重新核实',PROXY_CONTEXT_CONSUMED:'本次身份核实已使用，请为新输入重新核实',PROXY_CONTEXT_MISMATCH:'身份核实与当前经办、动作或原单不符',CUSTOMER_STATUS_CHANGED:'顾客状态已变化，请重新核实',COMMAND_PAYLOAD_CONFLICT:'同一动作键对应不同请求',VERSION_CONFLICT:'资料已变化，请刷新核对',TASK_NOT_ASSIGNEE:'请先领取本轮代录任务',VALIDATION_FAILED:'请求参数不合法'} as const;
export class ProxyError extends Error {readonly status:number;constructor(readonly code:keyof typeof messages){super(messages[code]);this.status=code==='PROXY_CONTEXT_NOT_FOUND'?404:code==='VALIDATION_FAILED'?400:409;}}
export function proxyPermission(actor:TaskCommandActor){for(const p of ['customer.frozen.proxy','customer.read','after-sale.service.read'])salePermission(actor,p);if(actor.subjectType!=='EMPLOYEE')throw new ProxyError('PROXY_CONTEXT_NOT_FOUND');return actor;}
export async function assertProxyContext(tx:Prisma.TransactionClient,actor:TaskCommandActor,id:string,action:string,orderId:string,now:Date,afterSaleId?:string){
 const employee=proxyPermission(actor),context=await tx.proxyContext.findUnique({where:{id}});
 if(!context)throw new ProxyError('PROXY_CONTEXT_NOT_FOUND');
 if(context.verifiedById!==employee.subjectId||context.action!==action||context.orderId!==orderId||afterSaleId!==undefined&&context.afterSaleId!==afterSaleId)throw new ProxyError('PROXY_CONTEXT_MISMATCH');
 if(context.status==='CONSUMED')throw new ProxyError('PROXY_CONTEXT_CONSUMED');
 if(context.status!=='VERIFIED')throw new ProxyError('CUSTOMER_STATUS_CHANGED');
 if(context.expiresAt<=now)throw new ProxyError('PROXY_CONTEXT_EXPIRED');
 const customer=await tx.customer.findUnique({where:{id:context.customerId}}),order=await tx.order.findUnique({where:{id:orderId}});
 if(!customer||customer.status!=='LOGIN_FROZEN'||customer.statusVersion!==context.customerStatusVersion)throw new ProxyError('CUSTOMER_STATUS_CHANGED');
 if(!order||order.customerId!==customer.id)throw new ProxyError('PROXY_CONTEXT_MISMATCH');
 return context;
}
