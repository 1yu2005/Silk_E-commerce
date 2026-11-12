/** 文件作用：展示后台导航、员工身份、全局提示和退出入口。 */
import { Alert, Button, Layout } from 'antd';
import { Link, Outlet } from 'react-router-dom';
import { useEmployeeAuth } from '../auth/use-employee-auth';
import { employeeAuth } from '../services/api';
import { canReadEmployees } from '../employees/query';

export function AppLayout() {
  const state = useEmployeeAuth();
  const signedIn = state.status === 'ready' || state.status === 'password-change';
  return <Layout className="app-layout">
    <header className="site-header"><span className="brand">自营店铺管理</span><nav aria-label="主导航">
      {state.status === 'ready' ? <><Link to="/">首页</Link><Link to="/change-password">修改密码</Link></> : null}
      {state.status === 'ready' && canReadEmployees(state.permissions) ? <Link to="/employees">员工管理</Link> : null}
      {signedIn ? <><span>{state.employee?.displayName ?? '当前员工'}</span><Button onClick={() => void employeeAuth.logout()}>退出登录</Button></> : null}
    </nav></header>
    <main className="page-content">{state.notice ? <Alert className="auth-notice" title={state.notice} type="info" showIcon /> : null}<Outlet /></main>
    <footer className="site-footer">商品、库存与订单，在这里有序衔接。</footer>
  </Layout>;
}
