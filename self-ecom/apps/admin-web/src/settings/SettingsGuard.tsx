/** 文件作用：按当前有效权限拦截全店设置和历史页面，普通员工不加载配置。 */
import { Link, Outlet } from 'react-router-dom';
import { useEmployeeAuth } from '../auth/use-employee-auth';
import { canManageSettings } from './model';

export function SettingsGuard() {
  const { permissions } = useEmployeeAuth();
  if (!canManageSettings(permissions)) return <section className="employee-panel"><h1>没有管理全店设置的权限</h1>
    <p>全店设置由店铺管理员维护。请联系管理员处理。</p><Link to="/">返回首页</Link></section>;
  return <Outlet />;
}
