// 作用：线下工单使用生成契约和现有员工查询缓存，切换身份清理敏感结果。
import {settings,session} from '../services/api';
import {EmployeeQueryController} from '../employees/query-controller';
export type OfflineCase=Awaited<ReturnType<typeof settings.getOfflineCase>>['data'];
export type OfflineQuery=NonNullable<Parameters<typeof settings.listOfflineCases>[0]>['query'];
export type OfflineEventBody=Parameters<typeof settings.appendOfflineCaseEvent>[0]['body'];
export const offlineQueries={
 list:new EmployeeQueryController<OfflineQuery,Awaited<ReturnType<typeof settings.listOfflineCases>>['data']>(session,(query,signal)=>settings.listOfflineCases({query,signal}),'线下工单读取失败'),
 detail:new EmployeeQueryController<string,OfflineCase>(session,(id,signal)=>settings.getOfflineCase({path:{id},signal}),'线下工单详情读取失败',true),
 order:new EmployeeQueryController<string,Awaited<ReturnType<typeof settings.getAdminOrder>>['data']>(session,(id,signal)=>settings.getAdminOrder({path:{id},signal}),'关联订单读取失败',true),
};
export const offlineTypes:Record<string,string>={EXPIRED_AFTER_SALE:'超期售后诉求',FORWARDING:'线下转寄',EXTRA_RESHIPMENT:'额外补发',EXTERNAL_COMPENSATION:'线下费用或赔付',CUSTODY_FOLLOW:'保管或寄还跟进',OTHER_SERVICE:'其他服务'};
export const offlineStatuses:Record<string,string>={OPEN:'待处理',IN_PROGRESS:'处理中',WAIT_EXTERNAL:'等待外部',RESOLVED:'已解决',CLOSED:'已结束'};
export const offlineKinds:Record<string,string>={CONTACT:'联系沟通',PROGRESS:'处理进展',EXTERNAL_RESULT:'线下实际结果',CORRECTION:'追加更正',RESOLUTION:'实际解决',CLOSURE:'结束说明'};
export const offlineTime=(value:string|null|undefined)=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'未设置';
export const localOfflineTime=()=>new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
