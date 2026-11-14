// 作用：退款响应不明时保留本标签页原命令；只存业务字段，不存凭证，切换身份即清理。
import {ApiClientError} from '@shop/api-client';
import {settings,session} from '../services/api';
type First=Parameters<typeof settings.executeAfterSaleRefund>[0]['body'];
type Retry=Parameters<typeof settings.retryAfterSaleRefund>[0]['body'];
export type RefundCommand={action:'refund';body:First}|{action:'retry';body:Retry};
type Saved={ownerId:string;saleId:string;command:RefundCommand};
const key='self-ecom.refund.pending';
function clear(commandKey?:string){try{const current=JSON.parse(sessionStorage.getItem(key)??'null') as Saved|null;if(!commandKey||current?.command.body.commandKey===commandKey)sessionStorage.removeItem(key);}catch{/* 禁用存储时使用当前页面内存恢复。 */}}
session.subscribe(()=>clear());
export function readRefundCommand(ownerId:string,saleId:string):Saved|null{try{const v=JSON.parse(sessionStorage.getItem(key)??'null') as Saved|null;return ownerId&&v?.ownerId===ownerId&&v.saleId===saleId&&['refund','retry'].includes(v.command?.action)&&typeof v.command.body?.commandKey==='string'?v:null;}catch{return null;}}
export async function sendRefundCommand(saved:Saved){
 try{sessionStorage.setItem(key,JSON.stringify(saved));}catch{/* 不阻止业务；当前页面仍保留原闭包。 */}
 try{const {saleId:id,command:c}=saved;const result=await(c.action==='refund'?settings.executeAfterSaleRefund({path:{id},body:c.body}):settings.retryAfterSaleRefund({path:{id},body:c.body}));clear(c.body.commandKey);return result;}
 catch(e){if(e instanceof ApiClientError&&e.status&&e.status<500&&e.code!=='REQUEST_IN_PROGRESS')clear(saved.command.body.commandKey);throw e;}
}
