import { Layout } from 'antd';
import { Link, Outlet } from 'react-router-dom';

export function AppLayout() {
  return <Layout className="app-layout">
    <header className="site-header"><Link className="brand" to="/">自营好物</Link><nav aria-label="主导航"><Link to="/">首页</Link><Link to="/login">顾客登录</Link></nav></header>
    <main className="page-content"><Outlet /></main>
    <footer className="site-footer">模拟交易，不发生真实资金流转。</footer>
  </Layout>;
}
