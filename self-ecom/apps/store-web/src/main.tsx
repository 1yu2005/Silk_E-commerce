/** 文件作用：挂载顾客商城，配置中文组件和全站主题。 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { RouterProvider } from 'react-router-dom';
import { router } from './app/router';
import 'antd/dist/reset.css';
import '@shop/ui/styles.css';
import './styles.css';
import './desktop.css';

const root = document.getElementById('root');
if (!root) throw new Error('缺少应用挂载节点');
createRoot(root).render(
  <StrictMode><ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#344d41', colorText: '#293b32', colorBorder: '#d7ddd5', borderRadius: 6, controlHeight: 40, fontFamily: '"Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif' } }}><RouterProvider router={router} /></ConfigProvider></StrictMode>,
);
