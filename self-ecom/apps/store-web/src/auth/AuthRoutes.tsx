/** 文件作用：驱动顾客会话到期检查，并保护注册和本人页面入口。 */
import { useEffect, useSyncExternalStore } from 'react';
import { Button, Space, Spin } from 'antd';
import { Navigate, Outlet } from 'react-router-dom';
import { customerAuth, session } from '../services/api';
import { useCustomerAuth } from './use-customer-auth';
import { AuthError } from './AuthError';

export function AuthRoot() {
  const { credential } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => customerAuth.start(), []);
  useEffect(() => {
    if (!credential) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const current = session.current();
      if (current.credential) timer = setTimeout(schedule, Math.min(2_147_483_647, Math.max(1, Date.parse(current.credential.expiresAt) - Date.now())));
    };
    const refresh = () => { if (document.visibilityState === 'visible') void customerAuth.restore(true); };
    schedule(); window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { clearTimeout(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [credential]);
  return <Outlet />;
}

function AuthPending() {
  const state = useCustomerAuth();
  if (state.status !== 'error') return <section className="auth-status" role="status"><Spin /><p>正在确认登录状态…</p></section>;
  return <section className="login-panel"><h1>暂时无法读取账号信息</h1><AuthError error={state.error} />
    <Space className="auth-actions"><Button type="primary" onClick={() => void customerAuth.restore(true)}>重新读取</Button>
      <Button onClick={() => void customerAuth.logout()}>退出登录</Button></Space></section>;
}

export function AnonymousOnly() {
  const { status } = useCustomerAuth();
  if (status === 'checking' || status === 'error') return <AuthPending />;
  if (status === 'ready') return <Navigate to="/account" replace />;
  return <Outlet />;
}

export function RequireCustomer() {
  const { status } = useCustomerAuth();
  if (status === 'checking' || status === 'error') return <AuthPending />;
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  return <Outlet />;
}
