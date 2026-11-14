// 作用：复用生成调用器和已有内存查询控制器，切换登录即清除审计结果并中止旧请求。
import {session,settings} from '../services/api';
import {EmployeeQueryController} from '../employees/query-controller';
import type {AuditSearch} from './query';
export type AuditList=Awaited<ReturnType<typeof settings.listAuditLogs>>['data'];
export type AuditItem=AuditList['items'][number];
export type AuditDetail=Awaited<ReturnType<typeof settings.getAuditLog>>['data'];
export type AuditOptions=Awaited<ReturnType<typeof settings.getAuditFilterOptions>>['data'];
export const auditQueries={
  list:new EmployeeQueryController<AuditSearch,AuditList>(session,(query,signal)=>settings.listAuditLogs({query,signal}),'审计查询失败，请重试'),
  detail:new EmployeeQueryController<string,AuditDetail>(session,(id,signal)=>settings.getAuditLog({path:{id},signal}),'审计详情读取失败，请重试'),
  options:new EmployeeQueryController<{actorKeyword?:string;limit:number},AuditOptions>(session,(query,signal)=>settings.getAuditFilterOptions({query,signal}),'筛选选项读取失败，请重试'),
};
