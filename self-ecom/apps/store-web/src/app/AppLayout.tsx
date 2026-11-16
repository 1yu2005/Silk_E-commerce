/** 文件作用：展示商城导航、顾客昵称、全局提示和退出入口。 */
import { Alert, Button, Layout } from 'antd';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useCustomerAuth } from '../auth/use-customer-auth';
import { AuthError } from '../auth/AuthError';
import { customerAuth } from '../services/api';
import { StoreContact } from '../contact/StoreContact';

export function AppLayout() {
  const state = useCustomerAuth();
  return <Layout className="app-layout">
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    <header className="site-header"><Link className="brand" to="/"><span className="store-brand-mark" aria-hidden="true">衣</span><span>日常衣橱 <small>Everyday wardrobe</small></span></Link><nav aria-label="主导航"><NavLink to="/" end>首页</NavLink><NavLink to="/products">全部款式</NavLink>
      {state.status === 'ready' ? <><Link to="/cart">购物车</Link><Link to="/orders">我的订单</Link><Link to="/after-sales">我的售后</Link><Link to="/addresses">收货地址</Link><Link to="/account">我的账号</Link><span className="customer-name" title={state.customer?.nickname}>{state.customer?.nickname}</span>
        <Button onClick={() => void customerAuth.logout()}>退出登录</Button></> : null}
      {state.status === 'anonymous' ? <><Link to="/login">顾客登录</Link><Link to="/register">注册账号</Link></> : null}
      {state.status === 'checking' ? <span role="status">正在确认登录状态…</span> : null}
      {state.status === 'error' ? <Link to="/account">重新确认账号</Link> : null}
    </nav></header>
    <main id="main-content" className="page-content">{state.notice ? <Alert className="auth-notice" title={state.notice} type="info" showIcon /> : null}
      {state.status==='ready'&&state.customer?.status==='TRADE_RESTRICTED'?<Alert className="auth-notice" type="warning" showIcon title="账号暂时限制新建订单" description="你仍可管理资料、地址和购物车。如需帮助，请联系页面底部的店铺客服。"/>:null}
      {state.status === 'anonymous' ? <AuthError error={state.error} /> : null}<Outlet /></main>
    <footer className="site-footer"><StoreContact /><p className="store-footer-note">模拟交易，不发生真实资金流转。</p></footer>
  </Layout>;
}
