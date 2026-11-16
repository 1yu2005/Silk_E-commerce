// 仅外部只读挂载到独占性能容器；使用最终生产dist/真实AppModule，仅暂停两个后台写者生命周期。
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
const directory=process.env.M415_PROBE_DIRECTORY,runId=process.env.M415_RUN_ID;
if(process.platform!=='linux'||process.env.NODE_ENV!=='production'||!/^\/m415_[a-f0-9]{32}_test$/.test(new URL(process.env.DATABASE_URL).pathname)||!isAbsolute(directory??'')||!/^[a-f0-9-]{36}$/.test(runId??''))throw new Error('只允许最终Linux生产镜像内的本轮m415隔离性能启动');
const require=createRequire(new URL('../../package.json',import.meta.url));require('reflect-metadata');
const maintenance=[
 ['tasks/task-scheduler.service.js','TaskSchedulerService'],
 ['files/file-cleanup.service.js','FileCleanupService'],
 ['orders/order-scanner.service.js','OrderScheduler'],
 ['orders/fulfillment-scanner.service.js','FulfillmentScheduler'],
 ['coordination/proxy-scanner.service.js','ProxyInputScheduler'],
];
for(const [path,name]of maintenance){const service=(await import('../../dist/'+path))[name];if(typeof service?.prototype?.onApplicationBootstrap!=='function')throw new Error('维护入口与冻结清单不一致');service.prototype.onApplicationBootstrap=function(){/* 本轮纯读冻结；维护正确性已在独立场景验收。 */};}
const files=['main.js','tasks/task-access.service.js','tasks/task-query.service.js','orders/order-task-read.js','after-sales/after-sale-task-read.js','reporting/reporting.service.js','audit-query/audit-query.service.js','timeline/business-history.service.js','prisma/prisma.service.js'];
const compiledSourceHashes=Object.fromEntries(await Promise.all(files.map(async path=>[path,createHash('sha256').update(await readFile(new URL('../../dist/'+path,import.meta.url))).digest('hex')])));
await writeFile(join(directory,'bootstrap.json'),JSON.stringify({schemaVersion:1,runId,nodeEnv:process.env.NODE_ENV,node:process.version,platform:process.platform,uid:process.getuid(),compiledSourceHashes,quiesced:maintenance.map(([,name])=>name+'.onApplicationBootstrap'),topologyDifference:'五个后台调度/清理启动钩子暂停；真实HTTP身份、权限、领域服务、reader及适配器保持生产dist',startedAt:new Date().toISOString()})+'\n',{flag:'wx'});
process.env.M415_ISOLATED_BOOTSTRAP='1';
await import('./module15-performance-probe.mjs');
await import('../../dist/main.js');
