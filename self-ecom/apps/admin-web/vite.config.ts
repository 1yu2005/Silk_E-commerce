// 文件作用：配置后台开发端口、React 构建及本机 API 的同源代理。
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 保留已有构建输出，遵守禁止批量删除文件的工作区约定。
  build: { emptyOutDir: false },
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true } },
  },
});
