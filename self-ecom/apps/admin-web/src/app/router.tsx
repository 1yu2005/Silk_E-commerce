import { createBrowserRouter } from 'react-router-dom';
import { AppLayout } from './AppLayout';

export const router = createBrowserRouter([{ element: <AppLayout />, children: [
  { path: '/', lazy: async () => ({ Component: (await import('../pages/HomePage')).HomePage }) },
  { path: '/login', lazy: async () => ({ Component: (await import('../pages/LoginPage')).LoginPage }) },
  { path: '*', lazy: async () => ({ Component: (await import('../pages/NotFoundPage')).NotFoundPage }) },
] }]);
