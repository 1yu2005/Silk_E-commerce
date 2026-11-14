// 作用：统一历史的类型均来自生成客户端；筛选变化沿用会话隔离和请求取消。
import { settings,session } from '../services/api';
import { EmployeeQueryController } from '../employees/query-controller';
export type HistoryPage=Awaited<ReturnType<typeof settings.getAdminOrderHistory>>['data'];
export type HistoryItem=HistoryPage['items'][number];
export type HistoryKind=HistoryItem['kind'];
export type HistoryQuery=NonNullable<NonNullable<Parameters<typeof settings.getAdminOrderHistory>[0]>['query']>;
type Input={id:string;query:HistoryQuery};
export const historyQueries={
  order:new EmployeeQueryController<Input,HistoryPage>(session,({id,query},signal)=>settings.getAdminOrderHistory({path:{id},query,signal}),'订单历史读取失败，请重试'),
  afterSale:new EmployeeQueryController<Input,HistoryPage>(session,({id,query},signal)=>settings.getAdminAfterSaleHistory({path:{id},query,signal}),'售后历史读取失败，请重试'),
};
export const kindLabels:Record<HistoryKind,string>={STATE_CHANGE:'状态与暂停',TASK_CHANGE:'任务变更',DEADLINE_EVENT:'期限事件',COMMUNICATION:'客服沟通',PAYMENT:'模拟付款',REFUND_ATTEMPT:'退款尝试',INVENTORY_ACTION:'库存事实',HANDOVER:'交运核实',INSPECTION:'验收与实物',OFFLINE_EVENT:'线下处理与代录'};
