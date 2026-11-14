// 作用：保存本标签页尚未确认的原命令；恢复沿用原键、版本与原体，不存登录凭证。
import {settings,session} from '../services/api';
type Body<K extends keyof typeof settings>=Parameters<(typeof settings)[K]>[0] extends {body:infer B}?B:never;
type Bodies={pack:Body<'packOrderShipment'>;physical:Body<'invalidateOrderPacking'>;prepare:Body<'prepareOrderShipment'>;start:Body<'startOrderHandover'>;confirm:Body<'confirmOrderHandover'>;uncertain:Body<'declareOrderHandoverUncertain'>;resolve:Body<'resolveOrderHandover'>;exception:Body<'createShipmentException'>;warehouse:Body<'confirmShipmentExceptionReady'>;customer:Body<'recordShipmentCustomerChoice'>;exceptionResolve:Body<'resolveShipmentException'>;tracking:Body<'correctShipmentTracking'>;historical:Body<'correctHistoricalShipmentTracking'>};
export type FulfillmentCommand={[K in keyof Bodies]:{action:K;body:Bodies[K];exceptionId?:string}}[keyof Bodies];
export type SavedFulfillmentCommand={ownerId:string;orderId:string;command:FulfillmentCommand};
const key='self-ecom.fulfillment.pending';
const allowed=['pack','physical','prepare','start','confirm','uncertain','resolve','exception','warehouse','customer','exceptionResolve','tracking','historical'];
export function readFulfillmentCommand(ownerId:string):SavedFulfillmentCommand|null{try{const value=JSON.parse(sessionStorage.getItem(key)??'null') as SavedFulfillmentCommand|null;return value?.ownerId===ownerId&&typeof value.orderId==='string'&&allowed.includes(value.command?.action)&&typeof value.command.body?.commandKey==='string'?value:null;}catch{return null;}}
export function saveFulfillmentCommand(value:SavedFulfillmentCommand){sessionStorage.setItem(key,JSON.stringify(value));}
export function clearFulfillmentCommand(){sessionStorage.removeItem(key);}
// 会话变化即清理内部草稿，防止同一标签页换人后看到上一人的证据或待处理动作。
session.subscribe(()=>{clearFulfillmentCommand();});
export function sendFulfillmentCommand(id:string,c:FulfillmentCommand){const path={id};switch(c.action){
 case 'pack':return settings.packOrderShipment({path,body:c.body});case 'physical':return settings.invalidateOrderPacking({path,body:c.body});case 'prepare':return settings.prepareOrderShipment({path,body:c.body});
 case 'start':return settings.startOrderHandover({path,body:c.body});case 'confirm':return settings.confirmOrderHandover({path,body:c.body});case 'uncertain':return settings.declareOrderHandoverUncertain({path,body:c.body});case 'resolve':return settings.resolveOrderHandover({path,body:c.body});
 case 'exception':return settings.createShipmentException({path,body:c.body});case 'warehouse':return settings.confirmShipmentExceptionReady({path:{id,exceptionId:c.exceptionId!},body:c.body});case 'customer':return settings.recordShipmentCustomerChoice({path:{id,exceptionId:c.exceptionId!},body:c.body});case 'exceptionResolve':return settings.resolveShipmentException({path:{id,exceptionId:c.exceptionId!},body:c.body});
 case 'tracking':return settings.correctShipmentTracking({path,body:c.body});case 'historical':return settings.correctHistoricalShipmentTracking({path,body:c.body});
}}
