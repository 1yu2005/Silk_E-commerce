// 作用：先生成私有计划；root授予DB窗口后再建立本轮专属Linux性能环境，全程保留资源。
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify,parseEnv} from 'node:util';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:net';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceManifestDigest} from './module15-performance.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),execute=promisify(execFile),sleep=ms=>new Promise(accept=>setTimeout(accept,ms));
const dockerExecutable=process.env.DOCKER_EXECUTABLE??(process.platform==='win32'?'C:/Users/20334/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe':'docker');
const json=async file=>JSON.parse(await readFile(file,'utf8')),write=async(file,data)=>writeFile(file,typeof data==='string'?data:JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});
async function freePort(){const server=createServer();await new Promise(accept=>server.listen(0,'127.0.0.1',accept));const port=server.address().port;await new Promise(accept=>server.close(accept));return port;}
export async function preparePerformanceEnvironment(image){
 assert.match(image,/^self-ecom-m415-[a-z0-9-]+-api:local$/);
 const runId=randomUUID(),folder=join(root,'private-delivery/M4-15','performance-'+runId),project='self-ecom-m415-perf-'+runId.slice(0,8);await mkdir(folder,{recursive:false});
 await execute('git',['check-ignore','--quiet',join(folder,'config.local.json')],{cwd:root,windowsHide:true});
 const dbPort=await freePort(),apiPort=await freePort();assert.notEqual(dbPort,apiPort);
 const database='m415_'+randomUUID().replaceAll('-','')+'_test',password=randomBytes(24).toString('hex'),jwt=randomBytes(48).toString('hex'),username='m415_perf_admin';
 const envFile=join(folder,'environment.local.env'),uploadsRoot=join(folder,'uploads'),controlRoot=join(folder,'control');await mkdir(uploadsRoot);await mkdir(controlRoot);
 const values={POSTGRES_DB:database,POSTGRES_USER:'m415_perf',POSTGRES_PASSWORD:password,DB_HOST_PORT:String(dbPort),API_HOST_PORT:String(apiPort),DATABASE_URL:`postgresql://m415_perf:${password}@127.0.0.1:${dbPort}/${database}`,CORS_ORIGINS:'http://localhost:8080,http://localhost:8081',COMPOSE_CORS_ORIGINS:'http://localhost:8080,http://localhost:8081',JWT_SECRET:jwt,JWT_TTL_SECONDS:'7200',LOG_LEVEL:'error',SWAGGER_ENABLED:'false',NODE_ENV:'test'};
 await write(envFile,Object.entries(values).map(([key,value])=>key+'='+value).join('\n')+'\n');
 const slash=file=>file.replaceAll('\\','/'),bootstrap=join(root,'apps/api/test/fixtures/module15-performance-bootstrap.mjs'),probe=join(root,'apps/api/test/fixtures/module15-performance-probe.mjs'),control=join(root,'apps/api/test/fixtures/module15-performance-control.mjs');
 const override={services:{api:{image,command:['node','test/fixtures/module15-performance-bootstrap.mjs'],environment:{M415_RUN_ID:runId,M415_PROBE_DIRECTORY:'/m415-control'},volumes:[{type:'bind',source:slash(uploadsRoot),target:'/app/storage/uploads'},{type:'bind',source:slash(controlRoot),target:'/m415-control'},{type:'bind',source:slash(bootstrap),target:'/app/test/fixtures/module15-performance-bootstrap.mjs',read_only:true},{type:'bind',source:slash(probe),target:'/app/test/fixtures/module15-performance-probe.mjs',read_only:true},{type:'bind',source:slash(control),target:'/app/test/fixtures/module15-performance-control.mjs',read_only:true}]}}};
 const overrideFile=join(folder,'compose.override.local.json');await write(overrideFile,override);
 const config={schemaVersion:1,runId,project,image,envFile,uploadsRoot,controlRoot,outputRoot:join(root,'output/testing/M4-15','performance-'+runId),fixtureOutputRoot:join(root,'output/testing/M4-15','fixture-'+runId),overrideFile,credentials:{username,password:'Perf#'+randomBytes(20).toString('hex')},freeze:{gitSha:(await execute('git',['rev-parse','HEAD'],{cwd:root,windowsHide:true})).stdout.trim()},prerequisitesFile:join(folder,'prerequisites.local.json'),baseUrl:`http://127.0.0.1:${apiPort}/api/v1`,diagnostic:{concurrency:100,warmupSeconds:2,measurementSeconds:10}};
 const file=join(folder,'config.local.json');await write(file,config);await writeFile(join(root,'private-delivery/M4-15','current-performance.local.json'),JSON.stringify({configFile:file},null,2)+'\n',{mode:0o600});return {status:'prepared-only',configFile:file,project};
}
export async function provisionPerformanceEnvironment(configFile,{resumeAfterMigrate=false,failureFile}={}){
 assert.match(resolve(configFile).replaceAll('\\','/'),/\/private-delivery\/M4-15\//);const config=await json(configFile);assert.equal(config.schemaVersion,1);assert.match(config.project,/^self-ecom-m415-perf-[a-f0-9]{8}$/);
 const folder=dirname(configFile),attempt=randomUUID().slice(0,8),events=[],values=parseEnv(await readFile(config.envFile,'utf8'));assert.match(new URL(values.DATABASE_URL).pathname,/^\/m415_[a-f0-9]{32}_test$/);
 const compose=['compose','--project-name',config.project,'--env-file',config.envFile,'-f',join(root,'infra/compose.yaml'),'-f',config.overrideFile];
 let phase='initial';
 async function command(label,program,args,options={}){phase=label;const startedAt=new Date().toISOString();try{const result=await execute(program,args,{cwd:root,windowsHide:true,maxBuffer:32*1024*1024,...options});await write(join(folder,`provision-${attempt}-${events.length}-${label}.local.log`),result.stdout+result.stderr);events.push({phase:label,startedAt,endedAt:new Date().toISOString(),exitCode:0});return result.stdout.trim();}catch(error){await write(join(folder,`provision-${attempt}-${events.length}-${label}.local.log`),(error.stdout??'')+(error.stderr??''));events.push({phase:label,startedAt,endedAt:new Date().toISOString(),exitCode:typeof error.code==='number'?error.code:1});throw error;}}
 const docker=(label,args)=>command(label,dockerExecutable,args);
 try{
  if(resumeAfterMigrate){const priorFile=failureFile??(await json(join(folder,'provision-last-failure.local.json'))).failureFile;assert.equal(dirname(resolve(priorFile)),resolve(folder));const prior=await json(priorFile);assert.equal(prior.phase,'seed-100000');assert.ok(prior.events.some(event=>event.phase==='migrate'&&event.exitCode===0));assert.notEqual(await docker('resume-migrated-project',['ps','-aq','--filter','label=com.docker.compose.project='+config.project]),'');}
  else assert.equal(await docker('reject-existing-project',['ps','-aq','--filter','label=com.docker.compose.project='+config.project]),'');
  await docker('validate-compose',[...compose,'config','--quiet']);
  config.freeze.imageId=JSON.parse(await docker('image-identity',['image','inspect',config.image]))[0].Id;
  await docker('postgres-start',[...compose,'up','-d','--no-build','db']);config.pgContainerId=await docker('postgres-identity',[...compose,'ps','-q','db']);
  phase='postgres-health';const healthEnd=Date.now()+90000;let healthy=false;while(Date.now()<healthEnd){const state=JSON.parse((await execute(dockerExecutable,['inspect',config.pgContainerId],{windowsHide:true})).stdout)[0].State;if(state.Health?.Status==='healthy'){healthy=true;break;}await sleep(1000);}assert.ok(healthy,'独占PG须healthy');
  const env={...process.env,...values,NODE_ENV:'test',UPLOAD_DIR:config.uploadsRoot,LOG_LEVEL:'silent'};
  await command('migrate',process.execPath,[join(root,'apps/api/node_modules/tsx/dist/cli.mjs'),'scripts/database.ts','migrate-deploy'],{cwd:join(root,'apps/api'),env});
  const seedFile=join(folder,'seed-config-'+attempt+'.local.json');await write(seedFile,{...config,outputRoot:config.fixtureOutputRoot,orderCount:100000});
  await command('seed-100000',process.execPath,[join(root,'apps/api/node_modules/tsx/dist/cli.mjs'),join(root,'apps/api/scripts/module15-performance-seed.ts'),'--config',seedFile],{cwd:join(root,'apps/api'),env});
  await docker('api-start',[...compose,'up','-d','--no-build','api']);config.apiContainerId=await docker('api-identity',[...compose,'ps','-q','api']);
  phase='api-ready';const readyEnd=Date.now()+90000;let ready=false;while(Date.now()<readyEnd){try{const response=await fetch(config.baseUrl+'/health/ready',{signal:AbortSignal.timeout(2000)});if(response.status===200){ready=true;break;}}catch{/* 就绪探测尚未成功，继续有界等待。 */}await sleep(1000);}assert.ok(ready,'生产API须ready');
  const bootstrap=await json(join(config.controlRoot,'bootstrap.json'));assert.equal(bootstrap.runId,config.runId);assert.equal(bootstrap.nodeEnv,'production');assert.notEqual(bootstrap.uid,0);
  config.freeze.sourceDigest=await sourceManifestDigest();await write(join(folder,'ready-config.local.json'),config);
  await write(join(folder,'diagnostic-config.local.json'),{...config,outputRoot:join(root,'output/testing/M4-15','diagnostic-'+config.runId)});
  const result={status:'provisioned-not-performance-accepted',runId:config.runId,project:config.project,imageId:config.freeze.imageId,events,apiContainerId:config.apiContainerId,pgContainerId:config.pgContainerId,retained:true};await write(join(folder,'provision-summary-'+attempt+'.local.json'),result);return {status:result.status,configFile:join(folder,'ready-config.local.json'),diagnosticConfigFile:join(folder,'diagnostic-config.local.json')};
 }catch(error){const failureFile=join(folder,'provision-failure-'+attempt+'.local.json');await write(failureFile,{status:'failed',phase,events,retained:true,errorCode:typeof error.code==='string'&&/^[A-Z0-9_]+$/.test(error.code)?error.code:'UNCLASSIFIED'});await writeFile(join(folder,'provision-last-failure.local.json'),JSON.stringify({failureFile},null,2)+'\n',{mode:0o600});throw new Error('PERFORMANCE_PROVISION_FAILED',{cause:error});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const args=process.argv.slice(2),prepare=args.indexOf('--prepare'),provision=args.indexOf('--provision');const operation=prepare>=0?preparePerformanceEnvironment(args[prepare+1]):provision>=0?provisionPerformanceEnvironment(resolve(args[provision+1]),{resumeAfterMigrate:args.includes('--resume-after-migrate'),failureFile:args.includes('--failure-file')?resolve(args[args.indexOf('--failure-file')+1]):undefined}):Promise.reject(new Error('INVALID_ARGUMENT'));operation.then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error(JSON.stringify({status:'failed',message:'性能环境准备失败；仅保留本轮独占现场，详情见私有provision证据。'}));process.exitCode=1;});}
