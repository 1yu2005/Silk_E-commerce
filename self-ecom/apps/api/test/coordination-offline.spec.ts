// 作用：金额/时间/更正语义边界独立验证；真实经办、事务和文件由数据库集成覆盖。
import {expect,it} from 'vitest';
import {offlineEventFacts,OfflineCaseError} from '../src/coordination/offline-case.rules.js';
const now=new Date('2026-11-14T12:00:00Z'),base={kind:'EXTERNAL_RESULT',occurredAt:'2026-11-14T11:59:00Z'};
it('线下金额只收整数分，支持0与上界并要求声明/核实标记',()=>{
 for(const reportedAmountCents of [0,100000000])expect(offlineEventFacts({...base,reportedAmountCents,externalVerification:'DECLARED'},now).occurredAt.toISOString()).toBe(base.occurredAt.replace('00Z','00.000Z'));
 for(const reportedAmountCents of [-1,0.01,100000001,Number.NaN])expect(()=>offlineEventFacts({...base,reportedAmountCents,externalVerification:'VERIFIED'},now)).toThrow(OfflineCaseError);
 expect(()=>offlineEventFacts({...base,reportedAmountCents:100},now)).toThrow(OfflineCaseError);
 expect(()=>offlineEventFacts({...base,externalPaymentAt:base.occurredAt},now)).toThrow(OfflineCaseError);
});
it('发生与线下付款时间不可未来；人工下次跟进可将来但不改系统期限',()=>{
 expect(()=>offlineEventFacts({...base,occurredAt:'2026-11-14T12:00:01Z'},now)).toThrow(OfflineCaseError);
 expect(()=>offlineEventFacts({...base,reportedAmountCents:100,externalVerification:'VERIFIED',externalPaymentAt:'2026-11-14T12:00:01Z'},now)).toThrow(OfflineCaseError);
 expect(offlineEventFacts({...base,waitExternal:true,nextStep:'联系承运人',nextFollowAt:'2026-11-15T12:00:00Z'},now).nextFollowAt?.toISOString()).toBe('2026-11-15T12:00:00.000Z');
 expect(()=>offlineEventFacts({...base,waitExternal:true,nextStep:'尚无跟进时刻'},now)).toThrow(OfflineCaseError);
});
it('更正必须显式引用，运单成对，管理员请求与决定使用明确语义',()=>{
 expect(()=>offlineEventFacts({...base,kind:'CORRECTION'},now)).toThrow(OfflineCaseError);
 expect(()=>offlineEventFacts({...base,correctsEventId:'existing'},now)).toThrow(OfflineCaseError);
 expect(()=>offlineEventFacts({...base,carrier:'承运人'},now)).toThrow(OfflineCaseError);
 expect(()=>offlineEventFacts({...base,adminDecision:'REQUEST'},now)).toThrow(OfflineCaseError);
 expect(()=>offlineEventFacts({...base,adminDecision:'APPROVED'},now)).toThrow(OfflineCaseError);
 expect(offlineEventFacts({...base,adminDecision:'APPROVED',basedAdminRequestEventId:'existing'},now).occurredAt).toEqual(new Date(base.occurredAt));
});
