/** 文件作用：展示商城导航、顾客昵称、全局提示和退出入口。 */
import { Alert, Button, Layout } from 'antd';
import { Link, Outlet } from 'react-router-dom';
import { useCustomerAuth } from '../auth/use-customer-auth';
import { AuthError } from '../auth/AuthError';
import { customerAuth } from '../services/api';
import { StoreContact } from '../contact/StoreContact';

export function AppLayout() {
  const state = useCustomerAuth();
  return <Layout className="app-layout">
    <header className="site-header"><Link className="brand" to="/">日常衣橱 <small>EVERYDAY</small></Link><nav aria-label="主导航"><Link to="/">首页</Link><Link to="/products">全部款式</Link>
      {state.status === 'ready' ? <><Link to="/account">我的账号</Link><span className="customer-name" title={state.customer?.nickname}>{state.customer?.nickname}</span>
        <Button onClick={() => void customerAuth.logout()}>退出登录</Button></> : null}
      {state.status === 'anonymous' ? <><Link to="/login">顾客登录</Link><Link to="/register">注册账号</Link></> : null}
      {state.status === 'checking' ? <span role="status">正在确认登录状态…</span> : null}
      {state.status === 'error' ? <Link to="/account">重新确认账号</Link> : null}
    </nav></header>
    <main className="page-content">{state.notice ? <Alert className="auth-notice" title={state.notice} type="info" showIcon /> : null}
      {state.status === 'anonymous' ? <AuthError error={state.error} /> : null}<Outlet /></main>
    <footer className="site-footer"><StoreContact /><p className="store-footer-note">模拟交易，不发生真实资金流转。</p></footer>
  </Layout>;
}
