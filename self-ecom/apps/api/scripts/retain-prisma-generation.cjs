// 构建专用预加载：保留 Prisma 生成器的既有输出，禁止其删除文件或目录。
/* global require, __dirname, URL, console, queueMicrotask */
/* eslint-disable @typescript-eslint/no-require-imports -- Node --require 在生成器启动前同步安装文件保护。 */
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { syncBuiltinESMExports } = require('node:module');

const client = require.resolve('@prisma/client/package.json', { paths: [path.resolve(__dirname, '..')] });
const outputRoot = path.resolve(path.dirname(client), '../../.prisma/client');
const targetPath = value => path.resolve(value instanceof URL ? fileURLToPath(value) : String(value));
const insideOutput = value => {
  const target = targetPath(value);
  return target === outputRoot || target.startsWith(outputRoot + path.sep);
};
const retain = value => {
  if (!insideOutput(value)) throw new Error('PRISMA_GENERATION_DELETE_OUTSIDE_OUTPUT_REFUSED');
  console.log(JSON.stringify({ prismaGenerationRetained: targetPath(value) }));
};

for (const name of ['rm', 'rmdir', 'unlink']) {
  fs[name + 'Sync'] = value => retain(value);
  fs.promises[name] = async value => retain(value);
  fs[name] = (value, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    try { retain(value); queueMicrotask(() => done(null)); }
    catch (error) { queueMicrotask(() => done(error)); }
  };
}

// 生成器原先先删除子目录再 mkdir；保留时允许复用同一个输出子目录。
const mkdirOptions = options => ({ ...(typeof options === 'number' ? { mode: options } : options), recursive: true });
const mkdirSync = fs.mkdirSync, mkdirAsync = fs.promises.mkdir, mkdirCallback = fs.mkdir;
fs.mkdirSync = (value, options) => mkdirSync(value, insideOutput(value) ? mkdirOptions(options) : options);
fs.promises.mkdir = (value, options) => mkdirAsync(value, insideOutput(value) ? mkdirOptions(options) : options);
fs.mkdir = (value, options, callback) => {
  const done = typeof options === 'function' ? options : callback;
  return insideOutput(value) ? mkdirCallback(value, mkdirOptions(typeof options === 'function' ? undefined : options), done)
    : typeof options === 'function' ? mkdirCallback(value, options) : mkdirCallback(value, options, callback);
};
syncBuiltinESMExports();
