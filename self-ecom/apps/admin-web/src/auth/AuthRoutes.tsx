/** 文件作用：驱动员工会话到期检查，并保护登录和后台页面入口。 */
import { useEffect, useSyncExternalStore } from 'react';
import { Button, Space, Spin } from 'antd';
import { Navigate, Outlet } from 'react-router-dom';
import { employeeAuth, session } from '../services/api';
import { useEmployeeAuth } from './use-employee-auth';
import { AuthError } from './AuthError';

export function AuthRoot() {
  const { credential } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => employeeAuth.start(), []);
  useEffect(() => {
    if (!credential) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const current = session.current();
      if (current.credential) timer = setTimeout(schedule, Math.min(2_147_483_647, Math.max(1, Date.parse(current.credential.expiresAt) - Date.now())));
    };
    const refresh = () => { if (document.visibilityState === 'visible') void employeeAuth.restore(true); };
    schedule();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearTimeout(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [credential]);
  return <Outlet />;
}

function AuthPending() {
  const state = useEmployeeAuth();
  if (state.status !== 'error') return <section className="auth-status" role="status"><Spin /><p>正在确认登录状态…</p></section>;
  return <section className="login-panel"><h1>暂时无法读取账号信息</h1><AuthError error={state.error} />
    <Space className="auth-actions"><Button type="primary" onClick={() => void employeeAuth.restore(true)}>重新读取</Button>
      <Button onClick={() => void employeeAuth.logout()}>退出登录</Button></Space></section>;
}

export function LoginOnly() {
  const { status } = useEmployeeAuth();
  if (status === 'checking' || status === 'error') return <AuthPending />;
  if (status === 'ready') return <Navigate to="/" replace />;
  if (status === 'password-change') return <Navigate to="/change-password" replace />;
  return <Outlet />;
}

export function RequireEmployee({ allowPasswordChange = false }: { allowPasswordChange?: boolean }) {
  const { status } = useEmployeeAuth();
  if (status === 'checking' || status === 'error') return <AuthPending />;
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  if (status === 'password-change' && !allowPasswordChange) return <Navigate to="/change-password" replace />;
  return <Outlet />;
}
