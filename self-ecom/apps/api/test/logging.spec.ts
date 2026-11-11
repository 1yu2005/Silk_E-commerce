import { createServer } from 'node:http';
import { Writable } from 'node:stream';
import { pinoHttp } from 'pino-http';
import { expect, it } from 'vitest';
import { httpLogOptions } from '../src/common/logging.js';
import { requestContext, type RequestWithId } from '../src/common/http/request-context.js';

it.each(['info', 'error', 'silent'] as const)('captures safe correlated HTTP logs at %s level', async logLevel => {
  let output = '';
  const stream = new Writable({ write(chunk, _encoding, done) {
    output += String(chunk);
    done();
  } });
  const logger = pinoHttp(httpLogOptions({ logLevel }), stream);
  const server = createServer((req, res) => {
    requestContext(req as RequestWithId, res, () => {
      logger(req, res);
      res.statusCode = req.url?.startsWith('/failure') ? 500 : req.url?.startsWith('/missing') ? 404 : 200;
      if (res.statusCode === 500) res.err = new Error('private-database-password');
      res.setHeader('Set-Cookie', 'private-response-cookie');
      res.end(JSON.stringify({ requestId: (req as RequestWithId).requestId }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test port');
    const ids: string[] = [];
    for (const path of ['/ok', '/missing', '/failure']) {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}?password=private-query&address=private-address`, {
        method: 'POST',
        headers: { Authorization: 'Bearer private-jwt', Cookie: 'private-cookie',
          'X-Request-Id': 'caller-id', 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'private-body', databaseUrl: 'private-connection' }),
      });
      const body = await response.json() as { requestId: string };
      expect(body.requestId).toBe(response.headers.get('x-request-id'));
      expect(body.requestId).not.toBe('caller-id');
      ids.push(body.requestId);
    }
    const records = output.trim() ? output.trim().split('\n').map(line => JSON.parse(line) as {
      requestId: string; req: { method: string; path: string }; res: { statusCode: number }; responseTime: number;
    }) : [];
    expect(records).toHaveLength(logLevel === 'silent' ? 0 : logLevel === 'error' ? 1 : 3);
    for (const record of records) {
      expect(ids).toContain(record.requestId);
      expect(record.req.method).toBe('POST');
      expect(['/ok', '/missing', '/failure']).toContain(record.req.path);
      expect([200, 404, 500]).toContain(record.res.statusCode);
      expect(record.responseTime).toBeGreaterThanOrEqual(0);
    }
    expect(output).not.toContain('private-');
    expect(output).not.toContain('caller-id');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
