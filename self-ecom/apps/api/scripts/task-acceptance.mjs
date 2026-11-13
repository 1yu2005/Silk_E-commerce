// 作用：一条命令编译并启动独立任务验收应用；凭证只显示本机，正常退出仅删除本轮随机库。
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
const root = fileURLToPath(new URL('../../../', import.meta.url)); const require = createRequire(import.meta.url);
if (process.env.NODE_ENV === 'production') throw new Error('生产环境禁止启动任务验收应用');
const result = spawnSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', resolve(root, 'apps/api/tsconfig.acceptance.json')], { stdio: 'inherit', windowsHide: true });
if (result.status !== 0 || result.error) process.exit(1);
const { startTaskAcceptance } = require('../dist/acceptance/test/acceptance/application.js');
const env = { ...parseEnv(readFileSync(resolve(root, '.env'), 'utf8')), ...process.env, NODE_ENV: 'test' };
let application;
try {
  application = await startTaskAcceptance({ root, env, fixtures: process.argv.includes('--fixtures') });
  if (process.argv.includes('--check')) {
    const ready = await fetch(application.base + '/health/ready');
    if (ready.status !== 200) throw new Error('隔离应用未就绪');
    await application.close(); console.log(JSON.stringify({ standaloneEntry: true, port: 3001, healthy: true, databaseRemoved: true }));
    process.exit(0);
  }
  console.log('独立任务验收应用：http://127.0.0.1:3001/api/docs');
  console.log('专属测试库：' + application.databaseName);
  console.table(application.accounts.map(account => ({ 账号: account.username, 姓名: account.displayName, 岗位: account.role })));
  console.log('本次临时登录密码（只在当前终端显示）：' + application.password);
  console.log('任务编号：' + JSON.stringify(application.taskIds));
  console.log('需重新准备夹具时退出后运行带--fixtures的命令；不覆盖正在使用的数据库。Ctrl+C正常退出删除本轮库。');
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; try { await application.close(); console.log('本轮专属测试库已删除。'); } catch { console.error('专属测试库清理失败，请检查同名库连接。'); process.exitCode = 1; } };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
} catch {
  await application?.close();
  console.error('隔离任务应用启动失败；未修改开发库，请核对端口、数据库和编译结果。'); process.exitCode = 1;
}
