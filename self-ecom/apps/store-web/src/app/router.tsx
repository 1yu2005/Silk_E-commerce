/** 文件作用：配置商城公开页面、匿名页面和顾客本人页面路由。 */
import { createBrowserRouter } from 'react-router-dom';
import { AppLayout } from './AppLayout';
import { AnonymousOnly, AuthRoot, RequireCustomer } from '../auth/AuthRoutes';

export const router = createBrowserRouter([{ element: <AuthRoot />, children: [{ element: <AppLayout />, children: [
  { path: '/', lazy: async () => ({ Component: (await import('../pages/HomePage')).HomePage }) },
  { path: '/products', lazy: async () => ({ Component: (await import('../pages/HomePage')).HomePage }) },
  { path: '/products/:id', lazy: async () => ({ Component: (await import('../pages/ProductDetailPage')).ProductDetailPage }) },
  { element: <AnonymousOnly />, children: [
    { path: '/login', lazy: async () => ({ Component: (await import('../pages/LoginPage')).LoginPage }) },
    { path: '/register', lazy: async () => ({ Component: (await import('../pages/RegisterPage')).RegisterPage }) },
  ] },
  { element: <RequireCustomer />, children: [
    { path: '/addresses', lazy: async () => ({ Component: (await import('../pages/AddressPage')).AddressPage }) },
    { path: '/cart', lazy: async () => ({ Component: (await import('../pages/CartPage')).CartPage }) },
    { path: '/account', lazy: async () => ({ Component: (await import('../pages/AccountPage')).AccountPage }) },
    { path: '/change-password', lazy: async () => ({ Component: (await import('../pages/ChangePasswordPage')).ChangePasswordPage }) },
  ] },
  { path: '*', lazy: async () => ({ Component: (await import('../pages/NotFoundPage')).NotFoundPage }) },
] }] }]);
