/** 文件作用：配置后台路由及员工登录、改密和业务权限守卫。 */
import { createBrowserRouter } from 'react-router-dom';
import { AppLayout } from './AppLayout';
import { AuthRoot, LoginOnly, RequireEmployee } from '../auth/AuthRoutes';
import { EmployeeReadGuard } from '../employees/EmployeeReadGuard';
import { EmployeeCreateGuard } from '../employees/EmployeeCreateGuard';
import { SettingsGuard } from '../settings/SettingsGuard';
import { CatalogGuard } from '../catalog/CatalogGuard';

export const router = createBrowserRouter([{ element: <AuthRoot />, children: [{ element: <AppLayout />, children: [
  { element: <LoginOnly />, children: [
    { path: '/login', lazy: async () => ({ Component: (await import('../pages/LoginPage')).LoginPage }) },
  ] },
  { element: <RequireEmployee allowPasswordChange />, children: [
    { path: '/change-password', lazy: async () => ({ Component: (await import('../pages/ChangePasswordPage')).ChangePasswordPage }) },
  ] },
  { element: <RequireEmployee />, children: [
    { path: '/', lazy: async () => ({ Component: (await import('../pages/HomePage')).HomePage }) },
    {element:<CatalogGuard permission="category.read"/>,children:[{path:'/categories',lazy:async()=>({Component:(await import('../pages/CategoryPage')).CategoryPage})}]},
    {element:<CatalogGuard permission="product.read"/>,children:[
      {path:'/products',lazy:async()=>({Component:(await import('../pages/ProductListPage')).ProductListPage})},
      {path:'/products/:id',lazy:async()=>({Component:(await import('../pages/ProductEditPage')).ProductEditPage})},
    ]},
    {element:<CatalogGuard permission="inventory.read"/>,children:[
      {path:'/inventory',lazy:async()=>({Component:(await import('../pages/InventoryListPage')).InventoryListPage})},
      {path:'/inventory/ledger',lazy:async()=>({Component:(await import('../pages/InventoryListPage')).InventoryLedgerPage})},
      {path:'/inventory/sources',lazy:async()=>({Component:(await import('../pages/InventoryListPage')).InventorySourcesPage})},
      {path:'/inventory/sources/new',lazy:async()=>({Component:(await import('../pages/InventorySourcePage')).InventorySourceCreatePage})},
      {path:'/inventory/sources/:id',lazy:async()=>({Component:(await import('../pages/InventorySourcePage')).InventorySourcePage})},
      {path:'/inventory/adjustments',lazy:async()=>({Component:(await import('../pages/InventoryListPage')).InventoryAdjustmentsPage})},
      {path:'/inventory/adjustments/new',lazy:async()=>({Component:(await import('../pages/InventoryAdjustmentPage')).InventoryAdjustmentCreatePage})},
      {path:'/inventory/adjustments/:id',lazy:async()=>({Component:(await import('../pages/InventoryAdjustmentPage')).InventoryAdjustmentPage})},
      {path:'/inventory/skus/:id',lazy:async()=>({Component:(await import('../pages/InventoryBalancePage')).InventoryBalancePage})},
    ]},
    { path: '/tasks', lazy: async () => ({ Component: (await import('../pages/TaskListPage')).TaskListPage }) },
    { path: '/tasks/:id', lazy: async () => ({ Component: (await import('../pages/TaskDetailPage')).TaskDetailPage }) },
    { element: <SettingsGuard />, children: [
      { path: '/settings', lazy: async () => ({ Component: (await import('../pages/StoreSettingsPage')).StoreSettingsPage }) },
      { path: '/settings/versions', lazy: async () => ({ Component: (await import('../pages/SettingsHistoryPage')).SettingsHistoryPage }) },
      { path: '/settings/versions/:id', lazy: async () => ({ Component: (await import('../pages/SettingsVersionPage')).SettingsVersionPage }) },
    ] },
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
