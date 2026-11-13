// 作用：在独立5175端口展示同一套后台页面，代理隔离3001应用，不改真实.env或原5173服务。
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root, configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
  define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api/v1') },
  server: { host: '127.0.0.1', port: 5175, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true } } } });
await server.listen(); console.log('隔离任务后台：http://127.0.0.1:5175；仅代理本机3001测试应用。');
if (process.argv.includes('--check')) {
  try {
    const response = await fetch('http://127.0.0.1:5175/');
    if (response.status !== 200) throw new Error('隔离页面入口未就绪');
    console.log(JSON.stringify({ standalonePageEntry: true, port: 5175, status: response.status }));
  } finally { await server.close(); }
  process.exit(0);
}
let closing = false;
const close = async () => { if (closing) return; closing = true; await server.close(); };
process.once('SIGINT', close); process.once('SIGTERM', close);
