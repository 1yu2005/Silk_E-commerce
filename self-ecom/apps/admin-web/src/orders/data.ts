// 作用：沿用员工查询缓存及会话隔离；所有类型取自生成契约。
import {settings,session} from '../services/api';
import {EmployeeQueryController} from '../employees/query-controller';
export type Orders=Awaited<ReturnType<typeof settings.listAdminOrders>>['data'];
export type OrderDetail=Awaited<ReturnType<typeof settings.getAdminOrder>>['data'];
export type Fulfillment=Awaited<ReturnType<typeof settings.getOrderFulfillment>>['data'];
export type Incident=Awaited<ReturnType<typeof settings.getStockIncident>>['data'];
export type OrderQuery=NonNullable<Parameters<typeof settings.listAdminOrders>[0]>['query'];
export const orderQueries={
 fulfillment:new EmployeeQueryController<string,Fulfillment>(session,(id,signal)=>settings.getOrderFulfillment({path:{id},signal})),
 list:new EmployeeQueryController<OrderQuery,Orders>(session,(query,signal)=>settings.listAdminOrders({query,signal})),
 detail:new EmployeeQueryController<string,OrderDetail>(session,(id,signal)=>settings.getAdminOrder({path:{id},signal})),
 incidents:new EmployeeQueryController<{page:number},Awaited<ReturnType<typeof settings.listStockIncidents>>['data']>(session,(q,signal)=>settings.listStockIncidents({query:{...q,pageSize:20},signal})),
 incident:new EmployeeQueryController<string,Incident>(session,(id,signal)=>settings.getStockIncident({path:{id},signal})),
 candidates:new EmployeeQueryController<string,Awaited<ReturnType<typeof settings.getStockIncidentCandidates>>['data']>(session,(skuId,signal)=>settings.getStockIncidentCandidates({path:{skuId},signal})),
 communications:new EmployeeQueryController<string,Awaited<ReturnType<typeof settings.listOrderInternalCommunications>>['data']>(session,(scopeId,signal)=>settings.listOrderInternalCommunications({query:{scopeType:'ORDER',scopeId,page:1,pageSize:100},signal})),
};
export const orderStatuses:Record<string,string>={WAIT_PAYMENT:'待付款',WAIT_SHIPMENT:'待发货',SHIPPED:'已发货',COMPLETED:'已完成',CLOSED:'已关闭',REFUNDED:'已退款'};
export const cents=(n:number)=>'¥'+(n/100).toFixed(2);

export const fulfillmentStages:Record<string,string>={UNCLAIMED:'待领取',PREPARING:'拣货打包',READY:'待交运',HANDOVER_IN_PROGRESS:'交运中',HANDOVER_UNCERTAIN:'交运待核实',SHIPPED:'已实际交运'};
