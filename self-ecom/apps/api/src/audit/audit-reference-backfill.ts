// 作用：有界keyset补齐投影；高水位固定，不改原审计。事务提交后才推进断点。
import { Prisma, type PrismaClient } from '@prisma/client';
import { appendAuditBusinessReferences, type ReferenceDiagnostic } from './audit-business-reference.js';

export interface AuditReferencePosition { createdAt:string;id:string }
export interface AuditReferenceCheckpoint { version:1;highWater:AuditReferencePosition|null;after:AuditReferencePosition|null }
const position=(row:{createdAt:Date;id:string}):AuditReferencePosition=>({createdAt:row.createdAt.toISOString(),id:row.id});
export async function initialAuditReferenceCheckpoint(db:PrismaClient):Promise<AuditReferenceCheckpoint> {
  const high=await db.auditLog.findFirst({orderBy:[{createdAt:'desc'},{id:'desc'}],select:{createdAt:true,id:true}});
  return {version:1,highWater:high?position(high):null,after:null};
}
export function validAuditReferenceCheckpoint(value:unknown):value is AuditReferenceCheckpoint {
  if(!value||typeof value!=='object')return false;
  const state=value as AuditReferenceCheckpoint;
  const valid=(p:AuditReferencePosition|null)=>p===null||!!p&&typeof p.createdAt==='string'&&Number.isFinite(Date.parse(p.createdAt))&&new Date(p.createdAt).toISOString()===p.createdAt&&typeof p.id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.id);
  return state.version===1&&valid(state.highWater)&&valid(state.after)&&(!state.after||!!state.highWater&&(state.after.createdAt<state.highWater.createdAt||state.after.createdAt===state.highWater.createdAt&&state.after.id<=state.highWater.id));
}
export async function backfillAuditReferenceBatch(db:PrismaClient,state:AuditReferenceCheckpoint,batchSize=200) {
  if(!validAuditReferenceCheckpoint(state)||!Number.isInteger(batchSize)||batchSize<1||batchSize>1000)throw new Error('审计回填断点或批大小无效');
  if(!state.highWater)return {checkpoint:state,scanned:0,inserted:0,done:true,diagnostics:[] as ReferenceDiagnostic[]};
  const high=state.highWater,after=state.after;
  return db.$transaction(async tx=>{
    const rows=await tx.auditLog.findMany({where:{AND:[
      {OR:[{createdAt:{lt:new Date(high.createdAt)}},{createdAt:new Date(high.createdAt),id:{lte:high.id}}]},
      ...(after?[{OR:[{createdAt:{gt:new Date(after.createdAt)}},{createdAt:new Date(after.createdAt),id:{gt:after.id}}]}]:[]),
    ]},orderBy:[{createdAt:'asc'},{id:'asc'}],take:batchSize,select:{id:true,createdAt:true,targetType:true,targetId:true,action:true,afterData:true}});
    const resolved=await appendAuditBusinessReferences(tx,rows),last=rows.at(-1);
    return {checkpoint:{...state,after:last?position(last):state.after},scanned:rows.length,inserted:resolved.inserted,done:rows.length<batchSize||!!last&&last.id===high.id&&last.createdAt.toISOString()===high.createdAt,diagnostics:resolved.diagnostics};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:15000});
}
