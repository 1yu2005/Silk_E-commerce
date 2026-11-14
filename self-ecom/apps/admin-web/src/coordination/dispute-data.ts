// 作用：争议和物品义务使用生成契约及会话隔离查询，不缓存跨身份资料。
import {settings,session} from '../services/api';
import {EmployeeQueryController} from '../employees/query-controller';
export type Disputes=Awaited<ReturnType<typeof settings.getAfterSaleDisputes>>['data'];
export type Custody=Awaited<ReturnType<typeof settings.getCustodyArrangement>>['data'];
export type CloseBody=Parameters<typeof settings.decideAfterSaleClose>[0]['body'];
export type CustodyPlan=CloseBody['custodyItems'][number];
export const disputeQueries={
 detail:new EmployeeQueryController<string,Disputes>(session,(id,signal)=>settings.getAfterSaleDisputes({path:{id},signal}),'争议处理读取失败',true),
 custody:new EmployeeQueryController<string,Custody>(session,(id,signal)=>settings.getCustodyArrangement({path:{id},signal}),'物品义务读取失败',true),
};
export const dispositions:Record<string,string>={KEEP_IN_CUSTODY:'继续保管并实际交接',RETURN_TO_CUSTOMER:'安排寄还顾客',IN_TRANSIT_UNRECEIVED:'在途未收，继续跟进到仓',NO_GOODS:'经核实无待处理实物'};
export const custodyStatuses:Record<string,string>={PLANNED:'待执行',IN_PROGRESS:'执行中',COMPLETED:'实际完成',EXCEPTION:'执行异常'};
export const custodyKinds:Record<string,string>={HANDOVER:'实际保管交接',RETURN_DISPATCH:'实际寄还交运',RECEIPT_CONFIRMED:'实际收件确认',LOCATION_CHANGED:'位置变更',EXCEPTION:'实物异常',CORRECTION:'追加历史更正'};
