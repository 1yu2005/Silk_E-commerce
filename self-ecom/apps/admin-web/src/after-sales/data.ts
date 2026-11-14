// 作用：售后查询沿用员工身份版本与请求取消，数据结构完全来自生成客户端。
import {settings,session} from '../services/api';
import {EmployeeQueryController} from '../employees/query-controller';
export type Sale=Awaited<ReturnType<typeof settings.getAdminAfterSale>>['data'];
export type Query=NonNullable<Parameters<typeof settings.listAdminAfterSales>[0]>['query'];
export const saleQueries={
 list:new EmployeeQueryController<Query,Awaited<ReturnType<typeof settings.listAdminAfterSales>>['data']>(session,(query,signal)=>settings.listAdminAfterSales({query,signal})),
 detail:new EmployeeQueryController<string,Sale>(session,(id,signal)=>settings.getAdminAfterSale({path:{id},signal}),'售后详情读取失败',true),
 communications:new EmployeeQueryController<string,Awaited<ReturnType<typeof settings.listOrderInternalCommunications>>['data']>(session,(id,signal)=>settings.listOrderInternalCommunications({query:{scopeType:'AFTER_SALE',scopeId:id,page:1,pageSize:100},signal})),
 history:new EmployeeQueryController<string,Awaited<ReturnType<typeof settings.getAdminAfterSaleHistory>>['data']>(session,(id,signal)=>settings.getAdminAfterSaleHistory({path:{id},query:{page:1,pageSize:100},signal})),
};
