/** 文件作用：配置后台路由及员工登录、改密和业务权限守卫。 */
import { createBrowserRouter } from 'react-router-dom';
import { AppLayout } from './AppLayout';
import { AuthRoot, LoginOnly, RequireEmployee } from '../auth/AuthRoutes';
import { EmployeeReadGuard } from '../employees/EmployeeReadGuard';
import { EmployeeCreateGuard } from '../employees/EmployeeCreateGuard';

export const router = createBrowserRouter([{ element: <AuthRoot />, children: [{ element: <AppLayout />, children: [
  { element: <LoginOnly />, children: [
    { path: '/login', lazy: async () => ({ Component: (await import('../pages/LoginPage')).LoginPage }) },
  ] },
  { element: <RequireEmployee allowPasswordChange />, children: [
    { path: '/change-password', lazy: async () => ({ Component: (await import('../pages/ChangePasswordPage')).ChangePasswordPage }) },
  ] },
  { element: <RequireEmployee />, children: [
    { path: '/', lazy: async () => ({ Component: (await import('../pages/HomePage')).HomePage }) },
    { element: <EmployeeCreateGuard />, children: [
      { path: '/employees/new', lazy: async () => ({ Component: (await import('../pages/EmployeeCreatePage')).EmployeeCreatePage }) },
    ] },
    { element: <EmployeeReadGuard />, children: [
      { path: '/employees', lazy: async () => ({ Component: (await import('../pages/EmployeeListPage')).EmployeeListPage }) },
      { path: '/employees/:id', lazy: async () => ({ Component: (await import('../pages/EmployeeDetailPage')).EmployeeDetailPage }) },
    ] },
    { path: '*', lazy: async () => ({ Component: (await import('../pages/NotFoundPage')).NotFoundPage }) },
  ] },
] }] }]);
