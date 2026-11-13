// 作用：兼容旧tsx入口，委托统一的编译导出脚本，避免两套导出逻辑产生不同契约。
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const result = spawnSync(process.execPath, [resolve(__dirname, '../../../scripts/export-openapi.mjs'), ...process.argv.slice(2)],
  { stdio: 'inherit', windowsHide: true });
process.exitCode = result.status ?? 1;
