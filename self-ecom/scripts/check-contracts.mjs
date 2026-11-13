/** 文件作用：只读重建并检查源码→OpenAPI→生成类型/调用器；任一环节漂移即退出非零，供本机与CI复用。 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
for (const file of ['export-openapi.mjs', 'generate-api-client.mjs']) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(file, import.meta.url)), '--check'], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0 || result.error) process.exit(result.status ?? 1);
}
