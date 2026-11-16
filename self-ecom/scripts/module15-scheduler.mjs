// Build the genuine DTO metadata before starting two independent test-only Nest API processes.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const build = spawnSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', 'apps/api/tsconfig.build.json'], { cwd: root, env: process.env, stdio: 'inherit', windowsHide: true });
if (build.status !== 0) process.exit(build.status ?? 1);
const run = spawnSync(process.execPath, [resolve(root, 'apps/api/node_modules/tsx/dist/cli.mjs'), 'scripts/integration.ts', 'test/module15-scheduler.integration.ts'], { cwd: resolve(root, 'apps/api'), env: process.env, stdio: 'inherit', windowsHide: true });
process.exitCode = run.status ?? 1;
