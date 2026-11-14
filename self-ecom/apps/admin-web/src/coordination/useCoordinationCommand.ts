// 作用：本标签页保存原动作与请求体；响应不明和刷新后仍按原键恢复，不存登录凭据。
import {ApiClientError} from '@shop/api-client';
import {useAfterSaleCommand} from '@shop/ui';
import {settings,session} from '../services/api';
import {useEmployeeAuth} from '../auth/use-employee-auth';
const operations=['claimTask','createAddressRequest','verifyAddressRequestPhysical','continueOriginalAddress','resolveAddressCancelReorder','handoffAddressOffline','handoffAddressAfterSale','applyAfterSaleFromException','followupOrderCoordination','createFrozenCustomerProxyContext','applyAfterSaleAsProxy','supplementAfterSaleAsProxy','saveReturnLogisticsAsProxy','recordOfflineResultAsProxy','createOfflineCase','beginOfflineCase','appendOfflineCaseEvent','resolveOfflineCase','closeOfflineCase','startDisputeFollowup','requestAfterSaleDispute','decideAfterSaleClose','recordCustodyEvent','startCustodyCorrection'] as const;
type Operation=typeof operations[number];
interface Saved {ownerId:string;operation:Operation;input:object}
const prefix='self-ecom.coordination.pending.';
function read(key:string,ownerId:string){try{const p=JSON.parse(sessionStorage.getItem(key)??'null') as Saved|null;return p?.ownerId===ownerId&&operations.includes(p.operation)&&p.input&&typeof p.input==='object'?p:null;}catch{return null;}}
function clear(key:string){try{sessionStorage.removeItem(key);}catch{/* 禁用存储仍沿本页内存原动作恢复。 */}}
const knownKeys=new Set<string>();
session.subscribe(()=>{for(const key of knownKeys)clear(key);knownKeys.clear();});
export function useCoordinationCommand(scope:string,onSaved:()=>void){
 const {employee}=useEmployeeAuth(),ownerId=employee?.id??'',key=prefix+scope;knownKeys.add(key);
 const send=async(p:Saved)=>{try{const run=settings[p.operation] as unknown as (input:object)=>Promise<unknown>;const result=await run(p.input);clear(key);return result;}catch(e){if(e instanceof ApiClientError&&e.status&&e.status<500&&e.code!=='REQUEST_IN_PROGRESS')clear(key);throw e;}};
 const command=useAfterSaleCommand(session,onSaved,()=>{const pending=read(key,ownerId);return pending?()=>send(pending):null;});
 function submit<K extends Operation>(operation:K,input:Parameters<(typeof settings)[K]>[0]){
  const original:Saved={ownerId,operation,input};return command.run(()=>{try{sessionStorage.setItem(key,JSON.stringify(original));}catch{/* 存储不可用时仍有useAfterSaleCommand内存保护。 */}return send(original);});
 }
 return {...command,submit};
}
export type CoordinationCommand=ReturnType<typeof useCoordinationCommand>;
