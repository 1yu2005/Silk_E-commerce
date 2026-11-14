import {Outlet} from 'react-router-dom';
import {Alert} from 'antd';
import {useEmployeeAuth} from '../auth/use-employee-auth';
export function OrdersGuard(){const {permissions}=useEmployeeAuth();return ['order.service.read','order.fulfillment.read'].some(p=>permissions?.effectivePermissions.includes(p))?<Outlet/>:<Alert type="error" title="需要订单客服或履约查询权限"/>;}
