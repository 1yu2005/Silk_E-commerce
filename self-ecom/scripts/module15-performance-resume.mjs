// 作用：仅复用已提交的本轮10万性能库做完整只读对账；成功后可显式启动现有最终API，不再造数或迁移。
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify,parseEnv} from 'node:util';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runReconcile} from './reconcile.mjs';
import {sourceManifestDigest} from './module15-performance.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(new URL('../apps/api/package.json',import.meta.url)),{Client}=require('pg'),execute=promisify(execFile),wait=ms=>new Promise(accept=>setTimeout(accept,ms));
const dockerExecutable=process.env.DOCKER_EXECUTABLE??(process.platform==='win32'?'C:/Users/20334/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe':'docker');
const save=(file,value)=>writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600}),json=async file=>JSON.parse(await readFile(file,'utf8'));
export async function resumePerformanceEnvironment(file,{startApi=false}={}){
 const configFile=resolve(file);assert.match(configFile.replaceAll('\\','/'),/\/private-delivery\/M4-15\//);await execute('git',['check-ignore','--quiet',configFile],{cwd:root,windowsHide:true});
 const config=await json(configFile),attempt=randomUUID().slice(0,8);assert.equal(config.schemaVersion,1);assert.match(config.project,/^self-ecom-m415-perf-[a-f0-9]{8}$/);assert.match(config.runId,/^[a-f0-9-]{36}$/);
 const env=parseEnv(await readFile(config.envFile,'utf8'));assert.match(new URL(env.DATABASE_URL).pathname,/^\/m415_[a-f0-9]{32}_test$/);
 const output=join(root,'output/testing/M4-15',`reconcile-${config.runId}-${attempt}`);await mkdir(output,{recursive:false});
 const rules=[...(await readFile(join(root,'scripts/reconcile.mjs'),'utf8')).matchAll(/\['([^']+)',`([\s\S]*?)`\]/g)].map(match=>({code:match[1],sql:match[2]})),steps=[];
 let phase='database-identity';const pg=new Client({connectionString:env.DATABASE_URL,application_name:'m415-performance-reconcile-resume'});await pg.connect();
 try{
  assert.equal((await pg.query('SELECT current_database() database')).rows[0].database,new URL(env.DATABASE_URL).pathname.slice(1));
  const counts={};for(const table of ['order','order_item','payment','refund','inventory_ledger','task','task_history','business_state_history','audit_log','audit_business_reference','file_asset','file_reference','shipment','handover_attempt','after_sale','after_sale_material_version','after_sale_decision','refund_attempt','communication','address_request','task_business_source'])counts[table]=Number((await pg.query('SELECT count(*)::text n FROM "'+table+'"')).rows[0].n);
  assert.equal(counts.order,100000);assert.equal(counts.order_item,140000);assert.equal(counts.payment,90000);assert.equal(counts.refund,10000);assert.equal(counts.task,110020);assert.equal(counts.file_asset,11000);
  const dataset={counts,statuses:(await pg.query('SELECT status,count(*)::int count FROM "order" GROUP BY status ORDER BY status')).rows,dates:(await pg.query(`SELECT (created_at AT TIME ZONE 'Asia/Shanghai')::date::text date,count(*)::int count FROM "order" GROUP BY 1 ORDER BY 1`)).rows,tasks:(await pg.query('SELECT stage,status,round,count(*)::int count FROM task GROUP BY stage,status,round ORDER BY stage,status,round')).rows};
  await save(join(output,'dataset.json'),{runId:config.runId,kind:'committed-fixture-counts-not-reconcile-acceptance',dataset});
  const client={query:async(...args)=>{const sql=typeof args[0]==='string'?args[0]:args[0]?.text??'',rule=rules.find(item=>sql.includes(item.sql)),started=performance.now();if(rule)phase=rule.code;else if(sql.startsWith('DECLARE m415_ledgers'))phase='inventory-reconstructable-action-chain';else if(sql.startsWith('DECLARE m415_files'))phase='file-retained-and-staged-content';const result=await pg.query(...args);if(rule){steps.push({code:rule.code,elapsedMs:performance.now()-started,violationCount:result.rows[0]?.n});console.log(JSON.stringify({reconcileProgress:steps.at(-1)}));}return result;}};
  phase='reconcile-start';const report=await runReconcile({client,uploadsRoot:config.uploadsRoot,scope:{target:'performance-fixture-resume',database:new URL(env.DATABASE_URL).pathname.slice(1)}});
  await save(join(output,'reconcile-summary.json'),{runId:config.runId,dataset,report,steps});assert.equal(report.status,'passed');assert.ok(report.checks.every(check=>check.passed&&check.violationCount==='0'));
  if(!startApi)return {status:'reconciled-not-performance-accepted',output,counts};
  phase='api-start';const docker=async args=>(await execute(dockerExecutable,args,{cwd:root,windowsHide:true,maxBuffer:16*1024*1024})).stdout.trim(),compose=['compose','--project-name',config.project,'--env-file',config.envFile,'-f',join(root,'infra/compose.yaml'),'-f',config.overrideFile];
  config.pgContainerId=await docker([...compose,'ps','-q','db']);const db=JSON.parse(await docker(['inspect',config.pgContainerId]))[0];assert.equal(db.Config.Labels['com.docker.compose.project'],config.project);assert.equal(db.State.Running,true);
  const selectedImage=JSON.parse(await docker(['image','inspect',config.image]))[0];assert.equal(selectedImage.Os,'linux');if(config.freeze.imageId)assert.equal(selectedImage.Id,config.freeze.imageId,'不得静默更换已冻结最终镜像');else config.freeze.imageId=selectedImage.Id;
  await docker([...compose,'up','-d','--no-build','--no-deps','api']);config.apiContainerId=await docker([...compose,'ps','-q','api']);
  phase='api-ready';const end=Date.now()+90000;let ready=false;while(Date.now()<end){try{if((await fetch(config.baseUrl+'/health/ready',{signal:AbortSignal.timeout(2000)})).status===200){ready=true;break;}}catch{/* 就绪探测尚未成功，继续有界等待。 */}await wait(1000);}assert.ok(ready);
  const bootstrap=await json(join(config.controlRoot,'bootstrap.json'));assert.equal(bootstrap.runId,config.runId);assert.equal(bootstrap.nodeEnv,'production');assert.notEqual(bootstrap.uid,0);
  config.freeze.gitSha=(await execute('git',['rev-parse','HEAD'],{cwd:root,windowsHide:true})).stdout.trim();config.freeze.sourceDigest=await sourceManifestDigest();if(config.imageRevision)config.imageRevision.sourceFreezePending=false;
  const readyFile=join(dirname(configFile),`ready-config-${attempt}.local.json`),diagnosticFile=join(dirname(configFile),`diagnostic-config-${attempt}.local.json`);await save(readyFile,config);await save(diagnosticFile,{...config,outputRoot:join(root,'output/testing/M4-15',`diagnostic-${config.runId}-${attempt}`)});
  const summary={status:'reconciled-and-api-ready-not-performance-accepted',runId:config.runId,counts,output,readyConfigFile:readyFile,diagnosticConfigFile:diagnosticFile};await save(join(output,'resume-summary.json'),summary);return summary;
 }catch(error){await save(join(output,'failure.json'),{status:'failed',phase,steps,code:typeof error.code==='string'&&/^[A-Z0-9_]+$/.test(error.code)?error.code:'UNCLASSIFIED',retained:true});throw error;}finally{await pg.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const args=process.argv.slice(2),at=args.indexOf('--config');assert.ok(at>=0&&args[at+1]);resumePerformanceEnvironment(args[at+1],{startApi:args.includes('--start-api')}).then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error(JSON.stringify({status:'failed',message:'本轮持久性能库对账/启动失败；原库、文件及全部证据保留。'}));process.exitCode=1;});}
