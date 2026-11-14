// 板块14短基线：本轮随机独占库10万关联订单，100真实HTTP在途；不是板块15长稳压测。
import 'reflect-metadata';
import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {cpus,totalmem,platform,release} from 'node:os';
import {performance} from 'node:perf_hooks';
import {Client} from 'pg';
import {fork,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:net';
import type {AddressInfo} from 'node:net';
import {it,expect} from 'vitest';
import {ReportingController} from '../src/reporting/reporting.controller.js';
import {TrendQueryDto,HotProductsQueryDto} from '../src/reporting/reporting.dto.js';
import {PaginationDto} from '../src/common/http/pagination.dto.js';
import {CustomerController} from '../src/customers/customer.controller.js';
import {CustomerIdDto,CustomerQueryDto} from '../src/customers/customer.dto.js';
import {AuditQueryController} from '../src/audit-query/audit-query.controller.js';
import {AuditListQueryDto} from '../src/audit-query/audit-query.dto.js';
import {OrderHistoryController} from '../src/timeline/business-history.controller.js';
import {BusinessHistoryQueryDto} from '../src/timeline/business-history.dto.js';
import {OrderIdDto} from '../src/orders/order.dto.js';
import {fixture,setupCoordinationFixtures} from './coordination-fixtures.js';
import {seedReportingPerformance,performanceId} from './fixtures/reporting-performance.js';
import {compareReportingPlans} from './fixtures/reporting-performance-diagnostics.js';
import {APP_CONFIG} from '../src/config/environment.js';
import {DATABASE_POOL_MAX} from '../src/prisma/prisma.service.js';

Reflect.defineMetadata('design:paramtypes',[Object,Object,TrendQueryDto],ReportingController.prototype,'trends');
Reflect.defineMetadata('design:paramtypes',[Object,Object,HotProductsQueryDto],ReportingController.prototype,'hot');
Reflect.defineMetadata('design:paramtypes',[Object,Object,PaginationDto],ReportingController.prototype,'lowStock');
Reflect.defineMetadata('design:paramtypes',[Object,Object,CustomerQueryDto],CustomerController.prototype,'list');
Reflect.defineMetadata('design:paramtypes',[Object,Object,CustomerIdDto],CustomerController.prototype,'consumption');
Reflect.defineMetadata('design:paramtypes',[Object,Object,AuditListQueryDto],AuditQueryController.prototype,'list');
Reflect.defineMetadata('design:paramtypes',[Object,Object,OrderIdDto,BusinessHistoryQueryDto],OrderHistoryController.prototype,'get');
setupCoordinationFixtures({databasePrefix:'m414'});
type Statement={sql:string;values:unknown[]};
type Case={name:string;path:string;list:boolean};
const percentile=(values:number[],p:number)=>values.length?Math.round([...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1]!*100)/100:0;

it('IT08：10万订单、100并发HTTP、10秒预热/30秒测量，SQL预算与真实ANALYZE BUFFERS计划',async()=>{
  const {db,admin}=fixture,setting=await db.storeSettingHead.findUniqueOrThrow({where:{id:1}}),started=Date.now();
  const dataset=await seedReportingPerformance(admin.actor.subjectId,setting.currentVersionId!);
  const seededAt=Date.now();
  expect(await db.order.count()).toBe(100000);expect(await db.payment.count()).toBe(95000);expect(await db.refund.count()).toBe(10000);
  const evidence=resolve(__dirname,'../../../docs/verification/evidence/M4-14',new Date().toISOString().replaceAll(':','-')+'-performance-results');mkdirSync(evidence,{recursive:true});
  const pg=new Client({connectionString:process.env.DATABASE_URL});await pg.connect();
  let apiProcess:ChildProcess|undefined;
  try {
  const compiledSourceHashes=Object.fromEntries(['reporting/reporting.service.js','audit-query/audit-query.service.js','timeline/business-history.service.js','prisma/prisma.service.js'].map(path=>[path,createHash('sha256').update(readFileSync(resolve(__dirname,'../dist',path))).digest('hex')]));
  const environment={date:new Date().toISOString(),platform:platform(),release:release(),node:process.version,cpu:cpus()[0]?.model.trim(),cpuCount:cpus().length,memoryBytes:totalmem(),postgres:(await pg.query('SELECT version() version')).rows[0].version,
    databaseSettings:(await pg.query("SELECT name,setting,unit FROM pg_settings WHERE name IN('shared_buffers','work_mem','max_connections','effective_cache_size','max_parallel_workers_per_gather','jit') ORDER BY name")).rows,apiPoolMax:DATABASE_POOL_MAX,apiStatementTimeoutMs:750,compiledSourceHashes};
  const facts=async()=>(await pg.query(`SELECT (SELECT count(*)::text FROM "order") orders,(SELECT count(*)::text FROM payment) payments,(SELECT COALESCE(sum(amount_cents::bigint),0)::text FROM payment) paid_cents,(SELECT count(*)::text FROM refund) refunds,(SELECT COALESCE(sum(amount_cents::bigint),0)::text FROM refund WHERE status='SUCCEEDED') refund_cents,(SELECT count(*)::text FROM audit_log) audits,(SELECT count(*)::text FROM audit_business_reference) refs,(SELECT count(*)::text FROM task) tasks,(SELECT count(*)::text FROM inventory_ledger) ledgers`)).rows[0];
  const before=await facts();
  const cases:Case[]=[
    {name:'overview',path:'/admin/dashboard/overview',list:false},
    {name:'trends30',path:'/admin/dashboard/trends?days=30',list:false},
    {name:'hotProducts',path:'/admin/dashboard/hot-products?limit=10',list:true},
    {name:'lowStock',path:'/admin/dashboard/low-stock?page=1&pageSize=20',list:true},
    {name:'customers',path:'/admin/customers?page=1&pageSize=20',list:true},
    {name:'consumption',path:'/admin/customers/'+performanceId('customer',6)+'/consumption',list:false},
    {name:'audit',path:'/admin/audit-logs?page=1&pageSize=20',list:true},
    {name:'auditBusinessNo',path:'/admin/audit-logs?businessType=ORDER&businessNo=PERF-O-2&pageSize=20',list:true},
    {name:'history',path:'/admin/orders/'+performanceId('order',2)+'/history?page=1&pageSize=20',list:true},
  ];
  let base=fixture.base;
  const request=async(path:string)=>{const response=await fetch(base+path,{headers:{Authorization:'Bearer '+admin.token}});const body=await response.json() as {data?:unknown;code?:string};return {status:response.status,body};};
  const original=Client.prototype.query;let tracing:Statement[]|null=null;
  Client.prototype.query=function(this:Client,...args:unknown[]){const first=args[0],sql=typeof first==='string'?first:(first as {text?:string})?.text;const values=typeof first==='string'?args[1]:(first as {values?:unknown[]})?.values;if(tracing&&typeof sql==='string')tracing.push({sql,values:Array.isArray(values)?values:[]});return Reflect.apply(original,this,args);} as typeof original;
  const captures=new Map<string,Statement[]>(),budgets:Record<string,{page20:number;page100:number}>={};
  try{
    for(const item of cases){tracing=[];const response=await request(item.path);expect(response.status,item.name).toBe(200);captures.set(item.name,tracing);tracing=null;}
    for(const name of ['customers','audit','history']){
      const item=cases.find(c=>c.name===name)!;tracing=[];expect((await request(item.path)).status).toBe(200);const page20=tracing.length;tracing=[];expect((await request(item.path.replace('pageSize=20','pageSize=100'))).status).toBe(200);const page100=tracing.length;tracing=null;budgets[name]={page20,page100};expect(page100).toBeLessThanOrEqual(page20+2);
    }
  }finally{tracing=null;Client.prototype.query=original;}
  const planSpecifications=[
    {name:'audit-count',source:'audit',match:(s:string)=>/count\(/i.test(s)&&/audit_log/.test(s)},
    {name:'audit-business-number',source:'auditBusinessNo',match:(s:string)=>/audit_business_reference/.test(s)&&/count\(/i.test(s)},
    {name:'trends30',source:'trends30',match:(s:string)=>/generate_series/.test(s)},
    {name:'hot-products',source:'hotProducts',match:(s:string)=>/WITH quantities/.test(s)},
    {name:'net-consumption',source:'consumption',match:(s:string)=>/SUM\(p.amount_cents/i.test(s)},
    {name:'low-stock-count',source:'lowStock',match:(s:string)=>/count\(/i.test(s)&&/inventory_balance/.test(s)},
    {name:'low-stock-page',source:'lowStock',match:(s:string)=>/inventory_balance/.test(s)&&/LIMIT/.test(s)},
    {name:'business-history-count',source:'history',match:(s:string)=>/count\(/i.test(s)&&/visible_history/.test(s)},
  ];
  const plans:Record<string,unknown>={};
  for(const specification of planSpecifications){const statement=captures.get(specification.source)?.find(s=>specification.match(s.sql));expect(statement,specification.name).toBeDefined();const result=await pg.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+statement!.sql,statement!.values);plans[specification.name]={sql:statement!.sql,plan:result.rows[0]['QUERY PLAN']};}
  writeFileSync(resolve(evidence,'query-plans.json'),JSON.stringify(plans,null,2)+'\n');
  if(process.env.M414_PERFORMANCE_PLAN_COMPARE==='1')await compareReportingPlans(pg,captures,evidence);
  if(process.env.M414_PERFORMANCE_PLAN_ONLY==='1'){
    writeFileSync(resolve(evidence,'diagnostic-only.json'),JSON.stringify({kind:'query-plan-diagnostic-only',environment,dataset,sqlBudgets:budgets,performanceThresholdVerified:false},null,2)+'\n');
    console.log(JSON.stringify({performanceEvidence:evidence,kind:'query-plan-diagnostic-only',performanceThresholdVerified:false}));
    return;
  }
  // 真正编译API在独立进程执行；Vitest只发HTTP及采集，避免共享事件循环污染延迟。
  const reservation=createServer();await new Promise<void>(r=>reservation.listen(0,'127.0.0.1',r));const port=(reservation.address() as AddressInfo).port;await new Promise<void>(r=>reservation.close(()=>r()));
  const profileDirectory=process.env.M414_PERFORMANCE_CPU_PROFILE==='1'?resolve(__dirname,'../../../output/testing/M4-14/cpu-profiles',evidence.split(/[\\/]/).at(-1)!):undefined;if(profileDirectory)mkdirSync(profileDirectory,{recursive:true});
  apiProcess=fork(resolve(__dirname,'../dist/main.js'),[],{cwd:resolve(__dirname,'..'),env:{...process.env,PORT:String(port),NODE_ENV:'test',LOG_LEVEL:'silent',UPLOAD_DIR:fixture.app.get(APP_CONFIG).uploadDir},execArgv:[...(profileDirectory?['--cpu-prof','--cpu-prof-dir='+profileDirectory,'--cpu-prof-name=api.cpuprofile']:[]),'--import',pathToFileURL(resolve(__dirname,'fixtures/reporting-performance-probe.mjs')).href],silent:true});apiProcess.stdout?.resume();let startupCode='';apiProcess.stderr?.on('data',chunk=>{startupCode=String(chunk).match(/\b(?:ERR_[A-Z_]+|MODULE_NOT_FOUND)\b/)?.[0]??startupCode;});base='http://127.0.0.1:'+port+'/api/v1';
  let ready=false;for(let attempt=0;attempt<100&&!ready&&apiProcess.exitCode===null;attempt++){try{ready=(await request('/admin/dashboard/overview')).status===200;}catch{ /* 仅等待本次子进程监听，不输出环境。 */ }if(!ready)await new Promise(r=>setTimeout(r,100));}expect(ready,'编译API子进程启动 '+startupCode).toBe(true);
  const probe=(type:string)=>new Promise<Record<string,unknown>>((accept,reject)=>{const timer=setTimeout(()=>{apiProcess?.off('message',receive);reject(new Error('性能探针响应超时'));},5000);const receive=(message:unknown)=>{if((message as {type?:string})?.type===type.replace(/start$/,'started').replace(/stop$/,'stopped')){clearTimeout(timer);apiProcess?.off('message',receive);accept(message as Record<string,unknown>);}};apiProcess!.on('message',receive);apiProcess!.send({type});});
  let active=0,maxActive=0;const statuses:Record<string,number>={},durations=new Map(cases.map(c=>[c.name,[] as number[]])),errors:Record<string,number>={};
  const phase=async(seconds:number,measure:boolean)=>{const end=performance.now()+seconds*1000;await Promise.all(Array.from({length:100},async(_,worker)=>{let n=worker;while(performance.now()<end){const item=cases[n++%cases.length]!,start=performance.now();active++;maxActive=Math.max(maxActive,active);try{const response=await request(item.path);if(measure){durations.get(item.name)!.push(performance.now()-start);statuses[response.status]=(statuses[response.status]??0)+1;if(response.status!==200)errors[item.name+':'+response.status]=(errors[item.name+':'+response.status]??0)+1;}}catch{if(measure)errors[item.name+':transport']=(errors[item.name+':transport']??0)+1;}finally{active--;}}}));};
  const monitor=new Client({connectionString:process.env.DATABASE_URL});await monitor.connect();let monitoring=false,lockWaitMax=0,samples=0,maxActiveConnections=0,maxParallelWorkers=0;const waitSamples:Record<string,number>={};
  const timer=setInterval(()=>{if(monitoring)return;monitoring=true;void monitor.query("SELECT backend_type,state,wait_event_type,count(*)::int count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() GROUP BY backend_type,state,wait_event_type").then(r=>{let locks=0,active=0,parallel=0;for(const row of r.rows){if(row.wait_event_type==='Lock')locks+=row.count;if(row.state==='active'&&row.backend_type==='client backend')active+=row.count;if(row.backend_type==='parallel worker')parallel+=row.count;const key=row.backend_type+':'+row.state+':'+(row.wait_event_type??'CPU_OR_RUNNABLE');waitSamples[key]=(waitSamples[key]??0)+row.count;}lockWaitMax=Math.max(lockWaitMax,locks);maxActiveConnections=Math.max(maxActiveConnections,active);maxParallelWorkers=Math.max(maxParallelWorkers,parallel);samples++;}).finally(()=>{monitoring=false;});},1000);
  const measuredStart=performance.now();
  let probeResult:Record<string,unknown>={},measurementElapsedSeconds=0;try{await phase(10,false);await probe('performance-probe-start');const measurementStart=performance.now();await phase(30,true);measurementElapsedSeconds=(performance.now()-measurementStart)/1000;probeResult=await probe('performance-probe-stop');}finally{clearInterval(timer);while(monitoring)await new Promise(r=>setTimeout(r,20));await monitor.end();}
  const elapsedSeconds=(performance.now()-measuredStart)/1000,after=await facts(),metrics=cases.map(item=>{const d=durations.get(item.name)!;return {name:item.name,path:item.path,listTargetMs:item.list?500:null,samples:d.length,p50Ms:percentile(d,.5),p95Ms:percentile(d,.95),p99Ms:percentile(d,.99),maxMs:Math.round(Math.max(...d)*100)/100};});
  const summary={kind:'module14-short-baseline',apiExecution:'compiled-api-separate-node-process',environment,dataset,seedMs:seededAt-started,concurrency:100,maxActive,warmupSeconds:10,measurementSeconds:30,measurementElapsedIncludingDrainSeconds:measurementElapsedSeconds,elapsedIncludingDrainSeconds:elapsedSeconds,requestsPerSecond:Object.values(statuses).reduce((n,v)=>n+v,0)/measurementElapsedSeconds,statuses,errors,metrics,sqlBudgets:budgets,databaseProbe:probeResult,lockWait:{sampleCount:samples,maxWaitingConnections:lockWaitMax},databaseActivity:{sampleCount:samples,samplingIntervalMs:1000,maxActiveClientConnections:maxActiveConnections,maxParallelWorkers,waitSamples,limitation:'pg_stat_activity的无等待事件表示CPU执行或可运行，不等于已测得CPU使用率'},originalFacts:before,afterFacts:after,readOnlyFactsUnchanged:JSON.stringify(before)===JSON.stringify(after),allListsWithin500ms:metrics.filter(m=>m.listTargetMs!==null).every(m=>m.p95Ms<=500),limitation:'本轮14短基线；不替代15的2分钟预热、5分钟测量、三轮及完整系统写并发/恢复验收'};
  writeFileSync(resolve(evidence,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({performanceEvidence:evidence,...summary}));
  expect(after).toEqual(before);expect(maxActive).toBe(100);expect(errors).toEqual({});for(const metric of metrics)if(metric.listTargetMs!==null)expect(metric.p95Ms,metric.name+' p95').toBeLessThanOrEqual(500);
  } finally { if(apiProcess&&apiProcess.exitCode===null){const child=apiProcess,exit=new Promise<void>(r=>child.once('exit',()=>r())),force=setTimeout(()=>child.kill(),5000);if(child.connected)child.send({type:'performance-process-shutdown'});else child.kill();await exit;clearTimeout(force);}await pg.end(); }
},300000);
