// 作用：前置四服务回归已通过后，仅定向续验库存与持久化；复用原生产镜像，新建随机专属环境，不重复整套回归。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID,randomBytes } from 'node:crypto';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { verifyCustomers } from './verify-customers-http.mjs';
import {createRequire} from 'node:module';
import { verifyRuntimeTail } from './verify-runtime-tail.mjs';
const remainingMode=process.argv.includes('--remaining');
const previousPath=process.argv[2],output=path.resolve(process.argv[3]);assert.ok(previousPath&&output);await mkdir(output,{recursive:true});
const previous=JSON.parse(await readFile(path.join(previousPath,'result.json'),'utf8'));assert.equal(previous.originalResourcesPreserved,true);assert.ok(previous.checks.some(s=>s.includes('生产后台草稿映射')));assert.ok(previous.checks.some(s=>s.includes('前台')||s.includes('自然缺货')));
const imagePrefix=previous.imagePrefix;assert.match(imagePrefix,/^self-ecom-m207-acceptance-[a-f0-9]{8}$/);const project='self-ecom-m207-acceptance-'+randomUUID().slice(0,8);
const configured=parseEnv(await readFile('.env','utf8')),secret=randomBytes(48).toString('hex'),password='Focus#'+randomBytes(24).toString('hex');const dbPassword=randomBytes(24).toString('hex');
const secrets=[secret,password,dbPassword,...Object.entries(configured).filter(([k])=>/SECRET|PASSWORD|TOKEN|DATABASE_URL/.test(k)).map(([,v])=>v)];const redact=s=>secrets.reduce((v,p)=>v.replaceAll(p,'[REDACTED]'),String(s));
const port=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(String(p)));});});
const ports=new Set();while(ports.size<4)ports.add(await port());const [apiPort,adminPort,storePort,dbPort]=[...ports];
const env={...process.env,POSTGRES_DB:'acceptance_dev',POSTGRES_USER:'acceptance',POSTGRES_PASSWORD:dbPassword,JWT_SECRET:secret,JWT_TTL_SECONDS:'7200',API_HOST_PORT:apiPort,ADMIN_HOST_PORT:adminPort,STORE_HOST_PORT:storePort,DB_HOST_PORT:dbPort,COMPOSE_CORS_ORIGINS:`http://localhost:${adminPort},http://localhost:${storePort}`,SWAGGER_ENABLED:'true',LOG_LEVEL:'info',INIT_ADMIN_USERNAME:'customers_focus',INIT_ADMIN_PASSWORD:password,FILE_UPLOADS_PER_MINUTE:'100'};
const override=path.join(output,'compose.override.yaml');await writeFile(override,`services:\n  api:\n    image: ${imagePrefix}-api:local\n  admin-web:\n    image: ${imagePrefix}-admin:local\n  store-web:\n    image: ${imagePrefix}-store:local\n`);
const docker=process.env.DOCKER_EXECUTABLE??'docker',base=['compose','--project-name',project,'--env-file','.env','-f','infra/compose.yaml','-f',override];const commands=[],checks=[],requests=[],pageErrors=[],acceptedImages=[];let browser,failure,owned=false,cleaned=false,originalResourcesPreserved=false;
function run(args,label){const r=spawnSync(docker,args,{env,encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024});commands.push({label,status:r.status});if(r.status!==0){writeFileSync(path.join(output,'command-failure.log'),redact((r.stdout??'')+(r.stderr??'')));throw new Error(label+' '+redact(r.stderr??r.error));}return r;}
const compose=(args,label)=>run([...base,...args],label);const originalVolumes=run(['volume','ls','--format','{{.Name}}'],'原有卷清单').stdout.trim().split(/\s+/);const original=run(['ps','-aq'],'原有容器清单').stdout.trim().split(/\s+/).filter(Boolean);
const states=()=>original.length?run(['inspect','--format','{{.Id}} {{.State.StartedAt}} {{.State.Running}}',...original],'原有容器状态').stdout.trim():'';const before=states();
const origin='http://localhost:'+adminPort,storeOrigin='http://localhost:'+storePort;const passed=name=>{checks.push(name);console.log(JSON.stringify({passed:true,check:name}));};
async function call(site,url,method='GET',body,token,status=200,code){const r=await fetch(site+'/api/v1'+url,{method,signal:AbortSignal.timeout(15000),headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json();requests.push({method,path:url,status:r.status,requestId:j.requestId});assert.equal(r.status,status,url+' '+j.code);assert.equal(j.requestId,r.headers.get('x-request-id'));if(code)assert.equal(j.code,code);if(j.data?.accessToken)secrets.push(j.data.accessToken);return j.data??j;}
try{
 for(const suffix of ['api','admin','store']){const name=imagePrefix+'-'+suffix+':local';acceptedImages.push({name,id:run(['image','inspect','--format','{{.Id}}',name],'冻结本轮生产镜像ID').stdout.trim()});}
 compose(['config','--quiet'],'校验独占四服务');owned=true;compose(['up','-d','--wait','--wait-timeout','90','db'],'仅启动随机专属数据库');compose(['run','--rm','--no-deps','api','pnpm','db:migrate:deploy'],'空库七迁移');compose(['run','--rm','--no-deps','api','pnpm','db:seed:permissions'],'权限初始化');compose(['run','--rm','--no-deps','-e','INIT_ADMIN_USERNAME','-e','INIT_ADMIN_PASSWORD','api','pnpm','db:seed:admin'],'专属管理员初始化');compose(['up','-d','--wait','--wait-timeout','120'],'启动四服务');
 const login=await call(origin,'/admin/auth/login','POST',{username:env.INIT_ADMIN_USERNAME,password});const adminToken=login.accessToken;
 const {chromium}=await import(pathToFileURL(env.PLAYWRIGHT_MODULE_PATH).href);browser=await chromium.launch({headless:true,executablePath:env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 const context={origin,storeOrigin,adminToken,browser,call,passed,requests,output,compose,env,pageErrors,secrets,redact,run,imagePrefix,adminUsername:env.INIT_ADMIN_USERNAME,adminPassword:password};
 const imageBytes=await createRequire(new URL('../apps/api/package.json',import.meta.url))('sharp')({create:{width:320,height:420,channels:3,background:'#2b414b'}}).png().toBuffer();
 const inventory=remainingMode?await verifyRuntimeTail(context):await verifyCustomers({...context,imageBytes});
 await browser.close();browser=undefined;compose(['restart','db','api'],'专属数据库和API重启');compose(['up','-d','--wait','--wait-timeout','90'],'等待恢复');compose(['up','-d','--no-deps','--force-recreate','--wait','--wait-timeout','90','api'],'仅重建专属API');
 let ready=false;for(let i=0;i<50&&!ready;i++){try{ready=(await fetch(origin+'/api/v1/health/ready')).status===200;}catch{/* 代理更新DNS */}if(!ready)await new Promise(r=>setTimeout(r,300));}assert.ok(ready);await inventory.verifyPersistence();assert.deepEqual(pageErrors,[]);
 for(const site of [origin,storeOrigin,'http://localhost:'+apiPort]){const doc=await(await fetch(site+'/api/docs-json')).json();assert.deepEqual(doc,JSON.parse(await readFile('docs/openapi/openapi.json','utf8')));}
 if(remainingMode)await inventory.verifyLimitsAndRuntime();
 passed('定向续验：四服务健康/代理/105操作契约一致，浏览器无未捕获错误');
}catch(e){failure=redact(e.stack??e.message);console.error(failure);}
finally{
 await browser?.close();try{if(owned){const names=run(['volume','ls','--filter','label=com.docker.compose.project='+project,'--format','{{.Name}}'],'仅核对专属卷').stdout.trim().split(/\s+/).filter(Boolean);assert.ok(names.every(n=>n.startsWith(project+'_')&&!originalVolumes.includes(n)));compose(['down','--volumes','--remove-orphans'],'仅清理本次独占容器与卷');cleaned=true;}assert.equal(states(),before);const remaining=run(['volume','ls','--format','{{.Name}}'],'复核原有卷').stdout.trim().split(/\s+/);assert.ok(originalVolumes.every(n=>remaining.includes(n)));originalResourcesPreserved=true;}catch(e){failure??=redact(e.stack??e.message);}
 const report={timestamp:new Date().toISOString(),status:failure?'failed':'passed',mode:remainingMode?'runtime-tail':'customers',project,imagePrefix,acceptedImages,previousEvidence:previousPath,previousChecks:previous.checks,checks,requests,commands,pageErrors,cleaned,originalResourcesPreserved,...(failure?{failure}:{})};await writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:checks.length,httpRequests:requests.length,cleaned,originalResourcesPreserved}));if(failure)process.exitCode=1;
}
