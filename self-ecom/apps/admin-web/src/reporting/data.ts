import {EmployeeQueryController} from '../employees/query-controller';
import {session,settings as api} from '../services/api';
import type {Overview,Trends,HotProducts,LowStock} from './model';
export const reportingQueries={
 overview:new EmployeeQueryController<undefined,Overview>(session,(_,signal)=>api.getDashboardOverview({signal}),'经营摘要读取失败'),
 trends:new EmployeeQueryController<7|30,Trends>(session,(days,signal)=>api.getDashboardTrends({query:{days},signal}),'经营趋势读取失败'),
 hot:new EmployeeQueryController<undefined,HotProducts>(session,(_,signal)=>api.getDashboardHotProducts({query:{days:30,limit:10},signal}),'热销统计读取失败'),
 stock:new EmployeeQueryController<number,LowStock>(session,(page,signal)=>api.getDashboardLowStock({query:{page,pageSize:10},signal}),'库存预警读取失败'),
};
