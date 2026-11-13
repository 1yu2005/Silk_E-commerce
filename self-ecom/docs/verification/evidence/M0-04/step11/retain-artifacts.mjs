// 作用：本轮验证专用预加载，保留历史测试afterAll中的临时目录；不拦截业务单文件清理或改变功能断言。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, resolve, sep } from 'node:path';
const keep = target => {
  const path = resolve(String(target));
  assert.ok(path.startsWith(resolve(tmpdir()) + sep), '拒绝递归删除非临时目录');
  assert.match(basename(path), /^(shop-config-|self-ecom-(files-unit|files-db|avatar|avatar-browser|contract-drift)-)/);
  console.log(JSON.stringify({ retainedTemporaryArtifact: path, reason: '用户禁止批量/递归删除，本轮保留测试临时目录' }));
};
export function installArtifactRetention() {
  const originalSync = fs.rmSync; const originalAsync = fs.promises.rm; const originalCallback = fs.rm;
  fs.rmSync = (path, options) => options?.recursive ? keep(path) : originalSync(path, options);
  fs.promises.rm = async (path, options) => options?.recursive ? keep(path) : originalAsync(path, options);
  fs.rm = (path, options, callback) => {
    if (!options?.recursive) return originalCallback(path, options, callback);
    try { keep(path); queueMicrotask(() => callback(null)); } catch (error) { queueMicrotask(() => callback(error)); }
  };
  syncBuiltinESMExports();
}
installArtifactRetention();
