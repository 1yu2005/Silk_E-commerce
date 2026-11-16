/** 文件作用：以分组侧栏、当前位置和账号操作组织后台桌面工作区。 */
import { Alert, Button, Layout } from 'antd';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEmployeeAuth } from '../auth/use-employee-auth';
import { employeeAuth } from '../services/api';
import { canReadEmployees } from '../employees/query';
import { canManageSettings } from '../settings/model';

export function AppLayout() {
  const state = useEmployeeAuth();
  const { pathname } = useLocation();
  const ready = state.status === 'ready';
  const signedIn = ready || state.status === 'password-change';
  const has = (...permissions: string[]) => ready && permissions.some(p => state.permissions?.effectivePermissions.includes(p));
  const groups = [
    { title: '工作总览', items: [
      { to: '/', label: '首页', visible: ready },
      { to: '/tasks', label: '任务工作台', visible: ready },
      { to: '/dashboard', label: '经营看板', visible: has('dashboard.read') },
    ] },
    { title: '商品与库存', items: [
      { to: '/products', label: '商品', visible: has('product.read') },
      { to: '/categories', label: '分类', visible: has('category.read') },
      { to: '/inventory', label: '库存', visible: has('inventory.read') },
      { to: '/inventory/stock-incidents', label: '订单库存异常', visible: has('inventory.order-exception.manage') },
    ] },
    { title: '交易与服务', items: [
      { to: '/orders', label: '订单', visible: has('order.service.read', 'order.fulfillment.read') },
      { to: '/customers', label: '顾客', visible: has('customer.read') },
      { to: '/after-sales', label: '售后', visible: has('after-sale.service.read', 'after-sale.inspection.read') },
      { to: '/offline-cases', label: '线下工单', visible: has('offline-case.manage') },
    ] },
    { title: '店铺管理', items: [
      { to: '/employees', label: '员工管理', visible: ready && canReadEmployees(state.permissions) },
      { to: '/audit-logs', label: '操作审计', visible: has('audit.read') },
      { to: '/settings', label: '全店设置', visible: ready && canManageSettings(state.permissions) },
    ] },
  ].map(group => ({ ...group, items: group.items.filter(item => item.visible) })).filter(group => group.items.length);
  const current = groups.flatMap(group => group.items)
    .filter(item => item.to === '/' ? pathname === '/' : pathname === item.to || pathname.startsWith(item.to + '/'))
    .sort((a, b) => b.to.length - a.to.length)[0];
  const pageTitle = pathname === '/change-password' ? '修改密码' : current?.label ?? '店铺工作区';

  return <Layout className={`app-layout admin-layout${ready ? ' has-sidebar' : ''}`}>
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    {ready ? <aside className="admin-sidebar">
      <Link className="admin-brand" to="/"><span className="brand-symbol" aria-hidden="true">衣</span><span>自营店铺管理<small>日常衣橱 · 运营中心</small></span></Link>
      <nav aria-label="主导航">{groups.map(group => <div className="admin-nav-group" key={group.title}>
        <h2>{group.title}</h2>{group.items.map(item => <Link key={item.to} to={item.to}
          className={current?.to === item.to ? 'active' : undefined} aria-current={current?.to === item.to ? 'page' : undefined}><span className="nav-marker" aria-hidden="true" />{item.label}</Link>)}
      </div>)}</nav>
      <div className="sidebar-note">让店铺的每一天，有条不紊。</div>
    </aside> : null}
    <header className="site-header admin-topbar">
      {ready ? <div className="admin-location"><span>运营中心</span><span aria-hidden="true">/</span><strong>{pageTitle}</strong></div>
        : <Link className="brand" to="/">自营店铺管理</Link>}
      <div className="admin-account">{signedIn ? <><span className="employee-identity"><span className="employee-avatar" aria-hidden="true">{state.employee?.displayName?.slice(0, 1) ?? '员'}</span>{state.employee?.displayName ?? '当前员工'}</span>
        {ready ? <NavLink to="/change-password">修改密码</NavLink> : null}<Button onClick={() => void employeeAuth.logout()}>退出登录</Button></>
        : <span className="muted">日常衣橱 · 员工工作区</span>}</div>
    </header>
    <main id="main-content" className="page-content">{state.notice ? <Alert className="auth-notice" title={state.notice} type="info" showIcon /> : null}<Outlet /></main>
    <footer className="site-footer">商品、库存与订单，在这里有序衔接。</footer>
  </Layout>;
}
