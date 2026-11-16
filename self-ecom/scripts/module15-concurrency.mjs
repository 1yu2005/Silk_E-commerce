// Explicit correctness concurrency entry; integration runner owns only its newly-created random database.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = spawnSync(process.execPath, [resolve(root, 'apps/api/node_modules/tsx/dist/cli.mjs'), 'scripts/integration.ts', 'test/module15-concurrency.integration.ts'], { cwd: resolve(root, 'apps/api'), env: process.env, stdio: 'inherit', windowsHide: true });
process.exitCode = run.status ?? 1;
