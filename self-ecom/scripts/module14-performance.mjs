// 本轮14短基线入口。集成runner创建/迁移/移除归属明确的随机m414数据库；文件目录保留。
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const build=spawnSync(process.execPath,[resolve(root,'scripts/record-module14.mjs'),'performance-api-build','.','node_modules/typescript/bin/tsc','-p','apps/api/tsconfig.build.json'],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});
if(build.status!==0)process.exit(build.status??1);
const run=spawnSync(process.execPath,[resolve(root,'scripts/record-module14.mjs'),'performance-100k-100-http','apps/api','apps/api/node_modules/tsx/dist/cli.mjs','scripts/integration.ts','test/reporting-performance.integration.ts'],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});
process.exitCode=run.status??1;
