// 作用：按最新员工权限保护分类和商品页面，页面只读与写入能力分别判断。
import { Link, Outlet } from 'react-router-dom';
import { useEmployeeAuth } from '../auth/use-employee-auth';
export function CatalogGuard({permission}:{permission:string}){
  const {permissions}=useEmployeeAuth();
  return permissions?.effectivePermissions.includes(permission)?<Outlet/>:<section className="employee-panel"><h1>没有访问权限</h1><p>请联系管理员授予相应商品或分类权限。</p><Link to="/">返回首页</Link></section>;
}
