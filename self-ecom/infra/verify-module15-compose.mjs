// 作用：板块15独占四服务生产镜像回归；分套件隔离数据，保留容器、卷、浏览器资料和失败现场。
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseEnv} from 'node:util';
import {verifyOrders} from './verify-orders-http.mjs';
import {verifyFulfillment} from './verify-fulfillment-http.mjs';
import {verifyAfterSales} from './verify-after-sales-http.mjs';
import {verifySettlement} from './verify-settlement-http.mjs';
import {verifyCoordination} from './verify-coordination-http.mjs';
import {verifyModule14Http} from './verify-module14-http.mjs';
import {originalContainerTemplate,protectOriginalContainers} from '../scripts/module15-resource-protection.mjs';
import {safeHttpEvidence} from '../scripts/module15-http-evidence.mjs';
import {module15FreeSubnet} from '../scripts/module15-docker-network.mjs';

const args=process.argv.slice(2).filter(arg=>arg!=='--');
const output=path.resolve(args.find(arg=>!arg.startsWith('--'))??'docs/verification/M4-15/e2e/'+new Date().toISOString().replaceAll(':','-'));
assert.ok(!existsSync(path.join(output,'result.json')),'输出不可覆盖');mkdirSync(output,{recursive:true});
const runId=randomUUID().slice(0,8),reuse=args.find(arg=>arg.startsWith('--reuse='))?.slice(8),imagePrefix=reuse??'self-ecom-m415-e2e-'+runId;
assert.match(imagePrefix,/^self-ecom-m415-e2e-[a-f0-9]{8}$/);
const selected=args.find(arg=>arg.startsWith('--suite='))?.slice(8)??'all',buildOnly=args.includes('--build-only');
const suites={orders:verifyOrders,'after-sales':verifyAfterSales,settlement:verifySettlement,coordination:verifyCoordination,reporting:verifyModule14Http};
assert.ok(selected==='all'||Object.hasOwn(suites,selected),'套件必须明确');
const docker=process.env.DOCKER_EXECUTABLE??(process.platform==='win32'?path.join(process.env.LOCALAPPDATA,'Programs/DockerDesktop/resources/bin/docker.exe'):'docker');
const privateRoot=path.resolve('private-delivery/M4-15/e2e-'+runId);mkdirSync(privateRoot,{recursive:true});
execFileSync('git',['check-ignore','--quiet',path.join(privateRoot,'accounts.local.json')],{windowsHide:true,stdio:'pipe'});
assert.match(readFileSync('.dockerignore','utf8'),/^private-delivery\s*$/m);
const secrets=[],tokenAccounts=new Map(),accounts=[];
const report={schemaVersion:1,operation:buildOnly?'build-only':'e2e',startedAt:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),imagePrefix,checks:[],requests:[],commands:[],acceptedImages:[],pageErrors:[],suites:[],desktopViewport:{width:1366,height:768},privateAccountLedger:path.relative(process.cwd(),path.join(privateRoot,'accounts.local.json'))};
const redact=value=>secrets.filter(Boolean).reduce((text,secret)=>text.replaceAll(secret,'[REDACTED]'),String(value)).replace(/postgres(?:ql)?:\/\/[^\s"'`]+/g,'[REDACTED_DATABASE_URL]');
const baseSystem=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP|DOCKER_CONFIG|DOCKER_HOST|DOCKER_CONTEXT|PLAYWRIGHT_MODULE_PATH|PLAYWRIGHT_CHROMIUM_EXECUTABLE)$/i.test(key)));
function run(command,label,env=baseSystem){console.log(JSON.stringify({started:label}));const startedAt=new Date().toISOString(),result=spawnSync(docker,command,{env,encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024}),log=path.join(output,'command-'+report.commands.length+'.redacted.txt');writeFileSync(log,redact((result.stdout??'')+(result.stderr??'')+(result.error?.message??'')));report.commands.push({label,command:['docker',...command],startedAt,endedAt:new Date().toISOString(),exitCode:result.status,log:path.relative(process.cwd(),log)});assert.equal(result.status,0,label+' '+redact((result.stderr??'').slice(-500)));return result.stdout??'';}
const passed=label=>{report.checks.push(label);console.log(JSON.stringify({passed:label}));};
const originals=run(['ps','-aq'],'原容器清单').trim().split(/\s+/).filter(Boolean),originalVolumes=run(['volume','ls','--format','{{.Name}}'],'原卷清单').trim().split(/\s+/).filter(Boolean);
const originalState=()=>originals.length?run(['inspect','--format',originalContainerTemplate,...originals],'原容器状态').trim().split('\n').map(row=>JSON.parse(row)):[];
const before=originalState();let browser,context,current;
const freePort=()=>new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(error=>error?reject(error):resolve(String(port)));});});
function recordAccount(key,changes){const scopedKey=current.name+':'+key;let row=accounts.find(account=>account.key===scopedKey);if(!row){row={key:scopedKey,project:current.project,purpose:'本轮独占隔离验收，非真实经营成员'};accounts.push(row);}Object.assign(row,changes,{updatedAt:new Date().toISOString()});for(const [field,value]of Object.entries(changes))if(/password/i.test(field)&&typeof value==='string')secrets.push(value);writeFileSync(path.join(privateRoot,'accounts.local.json'),JSON.stringify({schemaVersion:1,accounts},null,2)+'\n',{mode:0o600});return row;}
async function call(site,url,method='GET',body,token,status=200,code,headers={}){const started=performance.now(),response=await fetch(site+'/api/v1'+url,{method,signal:AbortSignal.timeout(20000),headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),json=await response.json(),account=tokenAccounts.get(token);report.requests.push({suite:current.name,method,path:url,actor:token?{subjectType:account?.subjectType??'AUTHENTICATED',...(account?.role?{role:account.role}:{})}:{subjectType:'ANONYMOUS'},...(body===undefined?{}:{requestBody:safeHttpEvidence(body)}),responseFacts:safeHttpEvidence(json.data??json),status:response.status,code:json.code,requestId:json.requestId,durationMs:performance.now()-started});assert.equal(response.status,status,url+' '+json.code);assert.equal(json.requestId,response.headers.get('x-request-id'));if(code)assert.equal(json.code,code);const data=json.data??json;
 if(response.ok&&method==='POST'&&url==='/admin/employees'){recordAccount('employee:'+body.username,{id:data.id,subjectType:'EMPLOYEE',role:body.role,username:body.username,initialPassword:body.initialPassword,currentPassword:body.initialPassword,loginOrigin:site,mustChangePassword:true,valid:true});}
 if(response.ok&&method==='POST'&&url==='/store/auth/register'){recordAccount('customer:'+body.phone,{subjectType:'CUSTOMER',phone:body.phone,initialPassword:body.password,currentPassword:body.password,loginOrigin:site,mustChangePassword:false,valid:true});}
 if(data.accessToken){secrets.push(data.accessToken);const account=accounts.find(row=>row.project===current.project&&(body?.username&&row.username===body.username||body?.phone&&row.phone===body.phone));if(account)tokenAccounts.set(data.accessToken,account);}
 if(response.ok&&method==='POST'&&url.endsWith('/auth/change-password')){const account=tokenAccounts.get(token);if(account){recordAccount(account.key.slice(current.name.length+1),{currentPassword:body.newPassword,mustChangePassword:false});}}
 return data;
}
async function ready(site,status){const response=await fetch(site+'/api/v1/health/ready',{signal:AbortSignal.timeout(15000)});assert.equal(response.status,status);const text=await response.text();for(const secret of secrets)assert.ok(!text.includes(secret));return {status:response.status,at:new Date().toISOString()};}
async function swaggerPage(view,c,screenshots){
 const page=await view.newPage();page.on('pageerror',error=>report.pageErrors.push(redact(error.message)));
 try{
  const origin=c.origins[2];await page.goto(origin+'/api/docs');await page.locator('.swagger-ui .info .title').waitFor();
  const operation=page.locator('.opblock.opblock-get').filter({has:page.locator('.opblock-summary-path').filter({hasText:'/api/v1/health/ready'})});
  await operation.locator('.opblock-summary-control').click();await operation.getByRole('button',{name:'Try it out',exact:true}).click();
  const pending=page.waitForResponse(response=>response.url()===origin+'/api/v1/health/ready'&&response.request().method()==='GET');
  await operation.getByRole('button',{name:'Execute',exact:true}).click();const response=await pending,json=await response.json();assert.equal(response.status(),200);assert.equal(json.requestId,response.headers()['x-request-id']);
  await operation.locator('.responses-inner').getByText(json.requestId,{exact:false}).first().waitFor();
  await operation.locator('.responses-inner').getByText(json.requestId,{exact:false}).first().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(screenshots,'swagger-ready.png'),fullPage:false});
  (report.swaggerUI??=[]).push({suite:c.name,url:origin+'/api/docs',server:'/',path:'/api/v1/health/ready',method:'GET',status:response.status(),requestId:json.requestId,screenshot:'swagger-ready.png'});
  passed(c.name+' Swagger原生页面实际Try it out命中当前API并返回requestId');
 }finally{await page.close();}
}
async function verifyCorsPreflights(c){
 const preflights=[];
 for(const [origin,allowed]of [[c.origins[0],true],[c.origins[1],true],['https://module15-disallowed.invalid',false]]){
  const response=await fetch(c.origins[2]+'/api/v1/admin/auth/login',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'},signal:AbortSignal.timeout(15000)}),headers=response.headers,requestId=headers.get('x-request-id');
  assert.equal(response.status,204);assert.equal(headers.get('access-control-allow-credentials'),null);
  const allowOrigin=headers.get('access-control-allow-origin'),methods=(headers.get('access-control-allow-methods')??'').toUpperCase().split(/\s*,\s*/),allowedHeaders=(headers.get('access-control-allow-headers')??'').toLowerCase().split(/\s*,\s*/);
  assert.equal(allowOrigin,allowed?origin:null);if(allowed){assert.ok(methods.includes('POST'));assert.ok(allowedHeaders.includes('authorization')&&allowedHeaders.includes('content-type'));assert.ok((headers.get('vary')??'').toLowerCase().split(/\s*,\s*/).includes('origin'));}
  preflights.push({origin,allowed,status:response.status,requestId,allowOrigin,allowCredentialsAbsent:true,...(allowed?{postAllowed:true,requestedHeadersAllowed:true,varyOrigin:true}:{browserCorsDenied:true})});
 }
 return preflights;
}
async function runtimeSessionSnapshot(page,c){
 for(const [site,origin,domain,key,otherKey]of [['admin',c.origins[0],'EMPLOYEE','self-ecom.employee.session','self-ecom.customer.session'],['store',c.origins[1],'CUSTOMER','self-ecom.customer.session','self-ecom.employee.session']]){
  if(!page.isClosed()&&page.url().startsWith(origin+'/')){
   const summary=await page.evaluate(({key,otherKey,domain})=>{
    const raw=sessionStorage.getItem(key);if(!raw)return null;let credential;try{credential=JSON.parse(raw);}catch{return {validJson:false};}
    const keys=Object.keys(sessionStorage).sort(),fields=Object.keys(credential).sort(),token=credential.accessToken;
    return {validJson:true,keys,credentialFields:fields,domainMatches:credential.domain===domain,tokenStructureValid:typeof token==='string'&&/^[^\s,]{1,8192}$/.test(token),expiresAtValid:typeof credential.expiresAt==='string'&&Date.parse(credential.expiresAt)>Date.now(),otherDomainAbsent:sessionStorage.getItem(otherKey)===null,noPasswordOrConfigurationKeys:keys.every(name=>!/(?:password|secret|database_url|connectionstring)/i.test(name)),credentialNotDuplicated:typeof token==='string'&&keys.filter(name=>name!==key).every(name=>!sessionStorage.getItem(name)?.includes(token)),noCredentialInLocalStorage:Object.entries(localStorage).every(([name,value])=>!/(?:password|accesstoken|authorization|jwt|secret|database_url)/i.test(name)&&!/["'](?:accessToken|password|jwtSecret|databaseUrl)["']\s*:/i.test(value)&&typeof token==='string'&&!value.includes(token))};
   },{key,otherKey,domain});
   if(summary)return {site,origin,domain,key,...summary};
  }
 }
 return null;
}
function observeRuntimePage(page,c,closedSessions){
 const close=page.close.bind(page);page.close=async options=>{const summary=await runtimeSessionSnapshot(page,c);if(summary)closedSessions.push(summary);return close(options);};return page;
}
async function verifyRuntimeSafety(activeBrowser,c,requestStart,closedSessions,preflights){
 const sessions=[...closedSessions];for(const page of activeBrowser.contexts().flatMap(value=>value.pages())){const summary=await runtimeSessionSnapshot(page,c);if(summary)sessions.push(summary);}
 for(const summary of sessions){const {site}=summary;assert.equal(summary.validJson,true);assert.deepEqual(summary.credentialFields,['accessToken','domain','expiresAt']);for(const field of ['domainMatches','tokenStructureValid','expiresAtValid','otherDomainAbsent','noPasswordOrConfigurationKeys','credentialNotDuplicated','noCredentialInLocalStorage'])assert.equal(summary[field],true,site+' '+field);
  summary.formalBrowserLoginObserved=report.requests.slice(requestStart).some(row=>row.source==='browser'&&row.method==='POST'&&row.path==='/api/v1/'+(site==='admin'?'admin':'store')+'/auth/login'&&row.status===200);
  if(c.name==='orders')assert.equal(summary.formalBrowserLoginObserved,true,site+' must use an existing successful UI login');
 }
 if(c.name==='orders')assert.deepEqual([...new Set(sessions.map(row=>row.site))].sort(),['admin','store']);
 (report.runtimeSafety??=[]).push({suite:c.name,preflights,sessions,credentialValuesRecorded:false});passed(c.name+' 两合法Origin及恶意Origin真实OPTIONS，既有登录存储仅记录安全结构摘要');
}
async function coldChecks(c){const startedAt=new Date().toISOString();for(const site of c.origins){assert.equal((await fetch(site+'/api/v1/health/live')).status,200);await ready(site,200);const spec=await(await fetch(site+'/api/docs-json')).json();assert.deepEqual(spec,JSON.parse(readFileSync('docs/openapi/openapi.json','utf8')));assert.deepEqual(spec.servers,[{url:'/'}]);assert.ok(Object.keys(spec.paths).every(key=>key.startsWith('/api/v1/')));assert.ok(!Object.keys(spec.paths).some(key=>/\/test(?:\/|$)|set-time|fail-refund|set-balance/.test(key)));}
 c.compose(['stop','db'],'仅停止本轮独占DB，触发真实依赖故障');try{c.databaseOutage=await ready(c.origins[0],503);assert.equal((await fetch(c.origins[0]+'/api/v1/health/live')).status,200);}finally{c.compose(['start','db'],'恢复本轮独占DB');}c.compose(['up','-d','--wait','--wait-timeout','120'],'等待本轮四服务恢复');c.databaseRecovery=await ready(c.origins[0],200);c.coldStart={startedAt,endedAt:new Date().toISOString()};passed(c.name+' 四服务冷启动、三入口原生契约及DB真实故障ready503→200');}
try{
 const module=process.env.PLAYWRIGHT_MODULE_PATH??path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'),{chromium}=await import(pathToFileURL(module).href);
 for(const [name,verify]of Object.entries(suites).filter(([name])=>selected==='all'||selected===name)){
  const project='self-ecom-m415-'+name+'-'+runId,folder=path.join(output,name);mkdirSync(folder,{recursive:true});current={name,project,folder,status:'running'};report.suites.push(current);
  const ports=new Set();while(ports.size<4)ports.add(await freePort());const [apiPort,adminPort,storePort,dbPort]=[...ports],adminPassword='Isolated#'+randomBytes(24).toString('hex');
  const values={COMPOSE_BAKE:'false',COMPOSE_PARALLEL_LIMIT:'1',POSTGRES_DB:'m415_'+name.replaceAll('-','_')+'_'+runId,POSTGRES_USER:'acceptance',POSTGRES_PASSWORD:randomBytes(24).toString('hex'),JWT_SECRET:randomBytes(48).toString('hex'),JWT_TTL_SECONDS:'7200',API_HOST_PORT:apiPort,ADMIN_HOST_PORT:adminPort,STORE_HOST_PORT:storePort,DB_HOST_PORT:dbPort,COMPOSE_CORS_ORIGINS:`http://localhost:${adminPort},http://localhost:${storePort}`,SWAGGER_ENABLED:'true',LOG_LEVEL:'info',INIT_ADMIN_USERNAME:'m415_acceptance',INIT_ADMIN_PASSWORD:adminPassword,FILE_UPLOADS_PER_MINUTE:'100',HANDOVER_TIMEOUT_MINUTES:'1'};
  secrets.push(adminPassword,values.POSTGRES_PASSWORD,values.JWT_SECRET);const env={...baseSystem,...values},envFile=path.join(privateRoot,name+'.env.local'),normalized=Object.fromEntries(Object.entries(values).map(([key,value])=>[key,String(value)])),encoded=Object.entries(normalized).map(([key,value])=>key+'='+JSON.stringify(value)).join('\n')+'\n';assert.deepEqual(parseEnv(encoded),normalized);writeFileSync(envFile,encoded,{flag:'wx',mode:0o600});current.envFile=path.relative(process.cwd(),envFile);
  current.subnet=await module15FreeSubnet(args=>run(args,'读取已有网络IPAM分配本轮独占子网'));const override=path.join(folder,'compose.override.yaml');writeFileSync(override,`services:\n  api:\n    image: ${imagePrefix}-api:local\n  admin-web:\n    image: ${imagePrefix}-admin:local\n  store-web:\n    image: ${imagePrefix}-store:local\nnetworks:\n  default:\n    ipam:\n      config:\n        - subnet: ${current.subnet}\n`);current.override=path.relative(process.cwd(),override);
  const base=['compose','--project-name',project,'--env-file',envFile,'-f','infra/compose.yaml','-f',override],compose=(args,label)=>({stdout:run([...base,...args],name+' '+label,env),status:0});current.compose=compose;
  assert.equal(run(['ps','-aq','--filter','label=com.docker.compose.project='+project],'拒绝复用旧project').trim(),'');compose(['config','--quiet'],'校验独占配置');
  if(!report.acceptedImages.length){if(!reuse)for(const service of ['api','admin-web','store-web'])compose(['build',service],'真实构建 '+service);for(const suffix of ['api','admin','store']){const image=imagePrefix+'-'+suffix+':local';report.acceptedImages.push({name:image,id:run(['image','inspect','--format','{{.Id}}',image],'冻结生产镜像').trim()});}}
  if(buildOnly){current.status='built';delete current.compose;break;}
  compose(['up','-d','--wait','--wait-timeout','120','db'],'空DB冷启动');compose(['run','--no-deps','api','pnpm','db:migrate:deploy'],'全部增量迁移');compose(['run','--no-deps','-e','INIT_ADMIN_USERNAME','-e','INIT_ADMIN_PASSWORD','api','pnpm','db:seed'],'幂等权限及首管理员初始化');compose(['run','--no-deps','-e','INIT_ADMIN_USERNAME','-e','INIT_ADMIN_PASSWORD','api','pnpm','db:seed'],'重复初始化保留原账号');compose(['up','-d','--wait','--wait-timeout','120'],'四服务冷启动');
  const origin='http://localhost:'+adminPort,storeOrigin='http://localhost:'+storePort;current.origins=[origin,storeOrigin,'http://localhost:'+apiPort];await coldChecks(current);
  recordAccount('admin',{subjectType:'EMPLOYEE',role:'SUPER_ADMIN',username:values.INIT_ADMIN_USERNAME,initialPassword:adminPassword,currentPassword:adminPassword,loginOrigin:origin,valid:true,mustChangePassword:false});const adminToken=(await call(origin,'/admin/auth/login','POST',{username:values.INIT_ADMIN_USERNAME,password:adminPassword})).accessToken;
  const browserRoot=path.resolve('output/playwright/M4-15',runId,name),profile=path.join(browserRoot,'profile'),artifacts=path.join(browserRoot,'artifacts'),screenshots=path.join(browserRoot,'screenshots');for(const directory of [profile,artifacts,screenshots])mkdirSync(directory,{recursive:true});current.privateBrowserEvidence=path.relative(process.cwd(),screenshots);
  context=await chromium.launchPersistentContext(profile,{headless:true,artifactsDir:artifacts,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE??(process.platform==='win32'?path.join(process.env.LOCALAPPDATA,'ms-playwright/chromium-1208/chrome-win64/chrome.exe'):undefined)});browser=context.browser();assert.ok(browser);
  const preflights=await verifyCorsPreflights(current),closedSessions=[],viewport=options=>({...options,viewport:options?.viewport?.width<=480?options.viewport:{width:1366,height:768}}),view={newPage:async options=>observeRuntimePage(await browser.newPage(viewport(options)),current,closedSessions),newContext:options=>browser.newContext(viewport(options))};
  await swaggerPage(view,current,screenshots);
  const requestStart=report.requests.length,result=await verify({origin,storeOrigin,adminToken,adminUsername:values.INIT_ADMIN_USERNAME,adminPassword,browser:view,call,passed,output:screenshots,compose,env,secrets,report,recordAccount,verifyFulfillment,module15RecoveryFiles:name==='reporting'});await verifyRuntimeSafety(browser,current,requestStart,closedSessions,preflights);await context.close();browser=undefined;context=undefined;
  current.browserArtifacts=readdirSync(screenshots,{withFileTypes:true}).filter(entry=>entry.isFile()).map(entry=>{const bytes=readFileSync(path.join(screenshots,entry.name));return {name:entry.name,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};});assert.ok(current.browserArtifacts.some(file=>file.name.endsWith('.png')),'每套须有真实浏览器截图');
  compose(['restart','db','api'],'独占DB和API真实重启');compose(['up','-d','--wait','--wait-timeout','120'],'重启后就绪');compose(['up','-d','--no-deps','--force-recreate','--wait','--wait-timeout','120','api'],'API真实重建仍复用原卷');await result.verifyPersistence();assert.deepEqual(report.pageErrors,[]);
  if(name==='reporting')await result.prepareRecoveryCandidates();
  current.status='passed';current.endedAt=new Date().toISOString();delete current.compose;writeFileSync(path.join(folder,'suite.json'),JSON.stringify(current,null,2)+'\n');compose(['stop'],'仅停本轮已验收服务并保留现场');
 }
 report.status='passed';
}catch(error){report.status='failed';if(current)current.status='failed';report.failure=redact(error.stack??error.message);console.error(report.failure);process.exitCode=1;
 if(browser)for(const [index,page]of browser.contexts().flatMap(context=>context.pages()).entries())try{const folder=path.resolve('output/playwright/M4-15',runId,'failure');mkdirSync(folder,{recursive:true});writeFileSync(path.join(folder,'page-'+index+'.txt'),redact(await page.locator('body').innerText()));await page.screenshot({path:path.join(folder,'page-'+index+'.png'),fullPage:true});}catch{/* 保留首个错误 */}
}finally{
 await context?.close();if(current)delete current.compose;
 try{report.autonomousOriginalRestarts=protectOriginalContainers(before,originalState());const volumes=run(['volume','ls','--format','{{.Name}}'],'复核原卷').trim().split(/\s+/);assert.ok(originalVolumes.every(volume=>volumes.includes(volume)));report.originalResourcesPreserved=true;}catch(error){report.status='failed';report.protectionFailure=redact(error.message);process.exitCode=1;}
 const writes=report.requests.filter(row=>row.durationMs!==undefined&&row.method!=='GET'&&row.status>=200&&row.status<300),latency=writes.map(row=>row.durationMs).sort((a,b)=>a-b),percentile=p=>latency.length?latency[Math.ceil(latency.length*p)-1]:null;
 report.writeLatency={scope:'本轮生产HTTP成功JSON写请求，包括登录及成员创建；文件上传和浏览器事件未混计',samples:writes.length,p50Ms:percentile(.5),p95Ms:percentile(.95),p99Ms:percentile(.99),maxMs:latency.at(-1)??null,overOneSecond:writes.filter(row=>row.durationMs>1000).map(({suite,method,path,durationMs,requestId})=>({suite,method,path,durationMs,requestId}))};
 report.cleaned=false;report.retainedResources=true;report.endedAt=new Date().toISOString();writeFileSync(path.join(output,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,requests:report.requests.length,imagePrefix,suites:report.suites.map(({name,status,project})=>({name,status,project})),originalResourcesPreserved:report.originalResourcesPreserved}));
}
