import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// 仅读取端口配置，不输出环境变量值或凭据。
const env = { ...parseEnv(readFileSync(new URL('../.env', import.meta.url), 'utf8')), ...process.env };
const ports = [env.ADMIN_HOST_PORT ?? '8080', env.STORE_HOST_PORT ?? '8081'];
const apiPort = env.API_HOST_PORT ?? '3000';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function get(origin, path) {
  return fetch(`${origin}${path}`, { signal: AbortSignal.timeout(5000) });
}

for (const port of ports) {
  const origin = `http://localhost:${port}`;
  for (const path of ['/', '/login', '/missing-page']) {
    const response = await get(origin, path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    const html = await response.text();
    assert.match(html, /id="root"/);
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(match => match[1]);
    assert(assets.length > 0);
    for (const asset of assets) {
      const assetResponse = await get(origin, asset);
      assert.equal(assetResponse.status, 200);
      assert.match(assetResponse.headers.get('cache-control'), /immutable/);
    }
  }
  assert.equal((await get(origin, '/index.html')).headers.get('cache-control'), 'no-cache');
  for (const name of ['live', 'ready']) {
    const response = await get(origin, `/api/v1/health/${name}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.requestId, uuid);
    assert.equal(response.headers.get('x-request-id'), body.requestId);
    assert.equal(body.data.status, name === 'live' ? 'ok' : 'ready');
  }
  const missing = await get(origin, '/api/v1/not-implemented');
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, 'NOT_FOUND');
  assert.equal((await get(origin, '/assets/not-existing.js')).status, 404);
  for (const path of ['/storage/verification-probe.txt', '/uploads/verification-probe.txt']) {
    assert.equal((await get(origin, path)).status, 404);
  }
  if (env.SWAGGER_ENABLED === 'true') {
    const ui = await get(origin, '/api/docs');
    assert.equal(ui.status, 200);
    assert.match(await ui.text(), /swagger-ui/);
    const doc = await (await get(origin, '/api/docs-json')).json();
    assert(doc.openapi && !doc.data);
    assert(doc.paths['/api/v1/health/ready']);
    assert.equal((await get(origin, '/api/docs/swagger-ui-bundle.js')).status, 200);
  }
  console.log(`站点${port}：页面、资源、原路径API代理、JSON404、私有目录与Swagger检查通过`);
}
const ready = await get(`http://localhost:${apiPort}`, '/api/v1/health/ready');
assert.equal(ready.status, 200);
console.log(`容器API ${apiPort}：真实数据库就绪检查通过`);
