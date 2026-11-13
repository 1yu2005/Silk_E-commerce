// 作用：只读核对本机三个应用及Docker四个服务，不启动、停止或重建容器。
import assert from 'node:assert/strict';
import http from 'node:http';
import { writeFileSync } from 'node:fs';
const label = process.argv[2]; assert.match(label, /^[a-z0-9-]+$/);
const checks = await Promise.all([
  [3000, '/api/v1/health/ready'], [3000, '/api/docs-json'], [5173, '/'], [5174, '/'],
].map(async ([port, path]) => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(5000) });
    const result = { port, path, status: response.status, requestId: response.headers.get('x-request-id') };
    if (path === '/api/docs-json') {
      const body = await response.json();
      result.operations = Object.values(body.paths).reduce((total, item) => total + Object.keys(item)
        .filter(key => ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(key)).length, 0);
    }
    return result;
  } catch (error) { return { port, path, error: error.code ?? error.cause?.code ?? error.name }; }
}));
const containers = await new Promise(resolve => {
  const request = http.get({ socketPath: '\\\\.\\pipe\\docker_engine',
    path: '/v1.45/containers/json?all=true&filters=' + encodeURIComponent(JSON.stringify({ label: ['com.docker.compose.project=self-ecom'] })) }, response => {
    let text = ''; response.setEncoding('utf8'); response.on('data', part => { text += part; });
    response.on('end', () => {
      if (response.statusCode !== 200) { resolve({ status: response.statusCode }); return; }
      const rows = JSON.parse(text);
      resolve(rows.map(row => ({ name: row.Names[0], service: row.Labels['com.docker.compose.service'], state: row.State, status: row.Status })));
    });
  });
  request.setTimeout(5000, () => request.destroy(new Error('Docker状态读取超时')));
  request.on('error', error => resolve({ error: error.code ?? error.name }));
});
const result = { checkedAt: new Date().toISOString(), checks, containers };
writeFileSync(`docs/verification/evidence/M0-04/step02/services-${label}.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
assert.ok(checks.every(row => row.status === 200), '本机服务状态不符合预期');
assert.ok(Array.isArray(containers) && containers.length === 4, '未读到四个Compose服务');
for (const row of containers) {
  assert.equal(row.state, row.service === 'db' ? 'running' : 'exited');
  if (row.service === 'db') assert.match(row.status, /healthy/);
}
