/** 文件作用：固定使用openapi-typescript生成公开类型和JSON调用器；--check只比较，不改写产物。 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
let require = createRequire(new URL('../packages/contract-tools/package.json', import.meta.url));
let generator;
// createRequire命中包的CommonJS入口，直接require以取得真实default，避免动态import再包一层default对象。
try { generator = require('openapi-typescript'); }
catch (error) {
  if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) throw error;
  // 本机保留旧node_modules时的隔离工具目录；标准安装使用contract-tools工作区。
  require = createRequire(new URL('../node_modules/.contract-tools/package.json', import.meta.url));
  generator = await import(new URL('../node_modules/.contract-tools/node_modules/openapi-typescript/dist/index.mjs', import.meta.url));
}
const installed = require('openapi-typescript/package.json').version;
const toolConfig = JSON.parse(await readFile(new URL('../packages/contract-tools/package.json', import.meta.url), 'utf8')).devDependencies;
if (installed !== toolConfig['openapi-typescript'] || require('typescript/package.json').version !== toolConfig.typescript) throw new Error('契约生成器或内部TypeScript版本与固定依赖不一致');
const option = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const spec = JSON.parse(await readFile(path.resolve(root, option('schema', 'docs/openapi/openapi.json')), 'utf8'));
const header = `/** 文件作用：由OpenAPI自动生成，禁止手改；使用pnpm api-client:generate更新。生成器openapi-typescript ${installed}。 */\n`;
const types = header + generator.astToString(await generator.default(spec, { alphabetize: true }));
const entries = []; const seen = new Set();
for (const [url, item] of Object.entries(spec.paths)) {
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    const op = item[method]; if (!op) continue;
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(op.operationId) || seen.has(op.operationId)) throw new Error('operationId缺失或重复');
    seen.add(op.operationId);
    const success = Object.entries(op.responses).find(([code, value]) => /^2\d\d$/.test(code) && value.content?.['application/json']);
    if (!success) {
      if (Object.values(op.responses).some(response => Object.keys(response.content ?? {}).some(type => type.startsWith('image/')))) continue;
      throw new Error(`成功JSON响应结构缺失：${op.operationId}`);
    }
    if (op.requestBody && !op.requestBody.content?.['application/json']) {
      if (op.requestBody.content?.['multipart/form-data']) continue;
      throw new Error(`不支持的请求类型：${op.operationId}`);
    }
    if (!url.startsWith('/api/v1/')) throw new Error('API路径不属于约定前缀');
    const parameters = [...(item.parameters ?? []), ...(op.parameters ?? [])];
    const pathParameters = parameters.filter(param => param.in === 'path').map(param => ({ name: param.name, format: param.schema?.format }));
    const queryParameters = parameters.filter(param => param.in === 'query');
    const id = JSON.stringify(op.operationId); const parts = ['signal?: AbortSignal']; let required = false;
    if (pathParameters.length) { parts.push(`path: operations[${id}]['parameters']['path']`); required = true; }
    if (queryParameters.length) { const requiredQuery = queryParameters.some(param => param.required);
      parts.push(`query${requiredQuery ? '' : '?'}: operations[${id}]['parameters']['query']`); required ||= requiredQuery; }
    if (op.requestBody) { parts.push(`body${op.requestBody.required ? '' : '?'}: NonNullable<operations[${id}]['requestBody']>['content']['application/json']`); required ||= op.requestBody.required; }
    const descriptor = { method, path: url.slice('/api/v1'.length), pathParameters, queryKeys: queryParameters.map(param => param.name) };
    entries.push(`    ${op.operationId}: (input: { ${parts.join('; ')} }${required ? '' : ' = {}'}) => requestJson<operations[${id}]['responses'][${JSON.stringify(success[0])}]['content']['application/json']>(api, ${JSON.stringify(descriptor)}, input),`);
  }
}
const client = header + "import type { AxiosInstance } from 'axios';\nimport type { operations } from './schema.js';\nimport { requestJson } from '../json-transport.js';\n\nexport function createGeneratedClient(api: AxiosInstance) {\n  return {\n" + entries.sort().join('\n') + '\n  };\n}\n';
const directory = path.resolve(root, option('output', 'packages/api-client/src/generated'));
if (!process.argv.includes('--check')) await mkdir(directory, { recursive: true });
for (const [name, content] of [['schema.ts', types], ['client.ts', client]]) {
  const target = path.join(directory, name);
  if (process.argv.includes('--check')) {
    const old = await readFile(target, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
    if (old.replaceAll('\r\n', '\n') !== content.replaceAll('\r\n', '\n')) throw new Error(`生成契约有差异：${name}，请运行pnpm api-client:generate`);
  } else await writeFile(target, content);
}
console.log(JSON.stringify({ generator: installed, operations: seen.size, jsonCallers: entries.length, mode: process.argv.includes('--check') ? 'check' : 'generate' }));
