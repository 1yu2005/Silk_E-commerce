// 作用：本轮独占四服务构建与真实交易验收；随机秘密仅在内存，清理仅操作本轮归属资源。
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import net from 'node:net';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {verifyOrders} from './verify-orders-http.mjs';
const output=path.resolve(process.argv[2]);assert.ok(process.argv[2]&&!existsSync(path.join(output,'result.json')));mkdirSync(output,{recursive:true});
const configured=parseEnv(readFileSync('.env','utf8'));
const docker=process.env.DOCKER_EXECUTABLE??path.join(process.env.LOCALAPPDATA,'Programs/DockerDesktop/resources/bin/docker.exe');
const project='self-ecom-m208-acceptance-'+randomUUID().slice(0,8),reuse=process.argv.find(a=>a.startsWith('--reuse='))?.slice(8);
const imagePrefix=reuse??project;assert.match(imagePrefix,/^self-ecom-m208-acceptance-[a-f0-9]{8}$/);
const adminPassword='Isolated#'+randomBytes(24).toString('hex'),secret=randomBytes(48).toString('hex'),dbPassword=randomBytes(24).toString('hex');
const secrets=[adminPassword,secret,dbPassword,...Object.entries(configured).filter(([k])=>/SECRET|PASSWORD|TOKEN|DATABASE_URL/.test(k)).map(([,v])=>v)];
const redact=s=>secrets.reduce((s,v)=>s.replaceAll(v,'[REDACTED]'),String(s));
const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(String(p)));});});
const ports=new Set();while(ports.size<4)ports.add(await freePort());const [apiPort,adminPort,storePort,dbPort]=[...ports];
const env={...process.env,POSTGRES_DB:'acceptance_dev',POSTGRES_USER:'acceptance',POSTGRES_PASSWORD:dbPassword,JWT_SECRET:secret,JWT_TTL_SECONDS:'7200',API_HOST_PORT:apiPort,ADMIN_HOST_PORT:adminPort,STORE_HOST_PORT:storePort,DB_HOST_PORT:dbPort,COMPOSE_CORS_ORIGINS:`http://localhost:${adminPort},http://localhost:${storePort}`,SWAGGER_ENABLED:'true',LOG_LEVEL:'info',INIT_ADMIN_USERNAME:'orders_acceptance',INIT_ADMIN_PASSWORD:adminPassword,FILE_UPLOADS_PER_MINUTE:'100'};
const override=path.join(output,'compose.override.yaml');writeFileSync(override,`services:\n  api:\n    image: ${imagePrefix}-api:local\n  admin-web:\n    image: ${imagePrefix}-admin:local\n  store-web:\n    image: ${imagePrefix}-store:local\n`);
const base=['compose','--project-name',project,'--env-file','.env','-f','infra/compose.yaml','-f',override];
const report={startedAt:new Date().toISOString(),project,imagePrefix,checks:[],requests:[],commands:[],acceptedImages:[],pageErrors:[]};let browser,owned=false;
function run(args,label){const r=spawnSync(docker,args,{env,encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024});report.commands.push({label,startedAt:new Date(Date.now()-(r.wallTime??0)).toISOString(),endedAt:new Date().toISOString(),exitCode:r.status});writeFileSync(path.join(output,'command-'+report.commands.length+'.log'),redact((r.stdout??'')+(r.stderr??'')+(r.error??'')));assert.equal(r.status,0,label+' '+redact((r.stderr??'').slice(-500)));return {stdout:r.stdout??''};}
const compose=(args,label)=>run([...base,...args],label),passed=s=>{report.checks.push(s);console.log(JSON.stringify({passed:s}));};
const originals=run(['ps','-aq'],'原容器清单').stdout.trim().split(/\s+/).filter(Boolean);
const state=()=>originals.length?run(['inspect','--format','{{.Id}} {{.State.StartedAt}} {{.State.Running}}',...originals],'原容器状态').stdout.trim():'';
const before=state(),volumesBefore=run(['volume','ls','--format','{{.Name}}'],'原卷清单').stdout.trim().split(/\s+/);
async function call(site,url,method='GET',body,token,status=200,code,headers={}){
 const r=await fetch(site+'/api/v1'+url,{method,signal:AbortSignal.timeout(15000),headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});const j=await r.json();report.requests.push({method,path:url,status:r.status,requestId:j.requestId});assert.equal(r.status,status,url+' '+j.code);assert.equal(j.requestId,r.headers.get('x-request-id'));if(code)assert.equal(j.code,code);if(j.data?.accessToken)secrets.push(j.data.accessToken);return j.data??j;
}
try{
 compose(['config','--quiet'],'独占Compose配置');if(!reuse)compose(['build'],'三个生产镜像真实构建');
 for(const suffix of ['api','admin','store']){const name=imagePrefix+'-'+suffix+':local';report.acceptedImages.push({name,id:run(['image','inspect','--format','{{.Id}}',name],'冻结镜像ID').stdout.trim()});}
 owned=true;compose(['up','-d','--wait','--wait-timeout','90','db'],'启动本轮独占数据库');
 compose(['run','--rm','--no-deps','api','pnpm','db:migrate:deploy'],'空库九次迁移');compose(['run','--rm','--no-deps','api','pnpm','db:seed:permissions'],'权限初始化');compose(['run','--rm','--no-deps','-e','INIT_ADMIN_USERNAME','-e','INIT_ADMIN_PASSWORD','api','pnpm','db:seed:admin'],'独占管理员初始化');
 compose(['up','-d','--wait','--wait-timeout','120'],'启动独占四服务');
 const origin='http://localhost:'+adminPort,storeOrigin='http://localhost:'+storePort;
 const adminToken=(await call(origin,'/admin/auth/login','POST',{username:env.INIT_ADMIN_USERNAME,password:adminPassword})).accessToken;
 const module=process.env.PLAYWRIGHT_MODULE_PATH??path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
 const {chromium}=await import(pathToFileURL(module).href);browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE??path.join(process.env.LOCALAPPDATA,'ms-playwright/chromium-1208/chrome-win64/chrome.exe')});
 const result=await verifyOrders({origin,storeOrigin,adminToken,adminUsername:env.INIT_ADMIN_USERNAME,adminPassword,browser,call,passed,output,compose,env,secrets,report});
 await browser.close();browser=undefined;
 compose(['restart','db','api'],'专属数据库和API重启');compose(['up','-d','--wait','--wait-timeout','120'],'等待重启');compose(['up','-d','--no-deps','--force-recreate','--wait','--wait-timeout','120','api'],'专属API重建');
 await result.verifyPersistence();
 for(const site of [origin,storeOrigin,'http://localhost:'+apiPort]){assert.equal((await fetch(site+'/api/v1/health/ready')).status,200);assert.deepEqual(await(await fetch(site+'/api/docs-json')).json(),JSON.parse(readFileSync('docs/openapi/openapi.json','utf8')));}
 assert.deepEqual(report.pageErrors,[]);passed('同组生产镜像、三入口契约一致，重启和API重建保持交易/图片/会话');report.status='passed';
}catch(e){report.status='failed';report.failure=redact(e.stack??e.message);console.error(report.failure);process.exitCode=1;if(browser){for(const [i,page]of browser.contexts().flatMap(c=>c.pages()).entries()){try{writeFileSync(path.join(output,'failure-page-'+i+'.txt'),redact(await page.locator('body').innerText()));await page.screenshot({path:path.join(output,'failure-page-'+i+'.png'),fullPage:true});}catch{/* 页面可能已关闭 */}}}if(owned){try{compose(['logs','--no-color','--tail','100','api'],'失败API诊断');}catch{/* 保留原失败 */}}}
finally{
 await browser?.close();try{if(owned){const names=run(['volume','ls','--filter','label=com.docker.compose.project='+project,'--format','{{.Name}}'],'核对本轮专属卷').stdout.trim().split(/\s+/).filter(Boolean);assert.ok(names.every(n=>n.startsWith(project+'_')&&!volumesBefore.includes(n)));compose(['down','--remove-orphans'],'移除本轮专属容器');for(const name of names)run(['volume','rm',name],'移除本轮单个专属卷');report.cleaned=true;}
 assert.equal(state(),before);const after=run(['volume','ls','--format','{{.Name}}'],'复核原卷').stdout.trim().split(/\s+/);assert.ok(volumesBefore.every(v=>after.includes(v)));report.originalResourcesPreserved=true;
 }catch(e){report.status='failed';report.cleanupFailure=redact(e.message);process.exitCode=1;}
 report.endedAt=new Date().toISOString();writeFileSync(path.join(output,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,requests:report.requests.length,cleaned:report.cleaned,originalResourcesPreserved:report.originalResourcesPreserved,imagePrefix}));
}
