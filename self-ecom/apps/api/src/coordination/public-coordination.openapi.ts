// 作用：订单和售后共享顾客公开投影；独立于领域schema，避免循环依赖。
import {object,array,text,uuid,nullable} from '../customers/customer.openapi.js';
const date={type:'string' as const,format:'date-time'};
export const publicOfflineCases=array(object({id:uuid,caseNo:text(64),type:text(40),status:text(30),subject:text(100),publicSummary:text(1000),createdAt:date,resolvedAt:nullable(date),closedAt:nullable(date),events:array(object({id:uuid,kind:text(30),occurredAt:date,publicText:nullable(text(2000)),correctsEventId:nullable(uuid)}))}));
