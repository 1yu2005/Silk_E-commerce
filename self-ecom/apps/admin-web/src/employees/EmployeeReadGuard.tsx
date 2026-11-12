/** 文件作用：根据有效权限控制员工列表和详情的页面入口。 */
import { Link, Outlet } from 'react-router-dom';
import { useEmployeeAuth } from '../auth/use-employee-auth';
import { canReadEmployees } from './query';

export function EmployeeReadGuard() {
  const { permissions } = useEmployeeAuth();
  if (!canReadEmployees(permissions)) return <section className="employee-panel"><h1>没有查看员工的权限</h1>
    <p>当前账号无法访问员工列表或详情。</p><Link to="/">返回首页</Link></section>;
  return <Outlet />;
}
