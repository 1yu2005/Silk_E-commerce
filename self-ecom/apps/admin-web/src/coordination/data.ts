// 作用：独立缓存异常协作事实；订单商品与协作查询并行，身份切换清空。
import {settings,session} from '../services/api';
import {EmployeeQueryController} from '../employees/query-controller';
export type Coordination=Awaited<ReturnType<typeof settings.getOrderCoordination>>['data'];
export const coordinationQuery=new EmployeeQueryController(session,async(id:string,signal:AbortSignal)=>{
 const [facts,order]=await Promise.all([settings.getOrderCoordination({path:{id},signal}),settings.getAdminOrder({path:{id},signal})]);
 return {data:{facts:facts.data,order:order.data},requestId:facts.requestId};
},'异常协作读取失败',true);
