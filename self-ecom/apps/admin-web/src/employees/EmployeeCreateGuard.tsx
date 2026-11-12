/** 文件作用：根据有效权限控制员工创建页面的入口。 */
import { Link, Outlet } from 'react-router-dom';
import { useEmployeeAuth } from '../auth/use-employee-auth';
import { canCreateEmployees } from './create';

export function EmployeeCreateGuard() {
  const { permissions } = useEmployeeAuth();
  if (!canCreateEmployees(permissions)) return <section className="employee-panel"><h1>没有创建员工的权限</h1>
    <p>当前账号无法创建员工，请联系店铺管理员。</p><Link to="/">返回首页</Link></section>;
  return <Outlet />;
}
