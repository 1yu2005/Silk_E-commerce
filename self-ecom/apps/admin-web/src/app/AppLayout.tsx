import { Layout } from 'antd';
import { Link, Outlet } from 'react-router-dom';

export function AppLayout() {
  return <Layout className="app-layout">
    <header className="site-header"><Link className="brand" to="/">自营店铺管理</Link><nav aria-label="主导航"><Link to="/">首页</Link><Link to="/login">员工登录</Link></nav></header>
    <main className="page-content"><Outlet /></main>
    <footer className="site-footer">商品、库存与订单，在这里有序衔接。</footer>
  </Layout>;
}
