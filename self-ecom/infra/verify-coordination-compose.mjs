// 作用：板块13独占四服务真实构建和业务验收；保留本轮容器、卷及文件供复核，不操作旧资源。
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {env as configured,docker} from '../scripts/module13-runtime.mjs';
import {verifyCoordination} from './verify-coordination-http.mjs';
import {launchCoordinationBrowser} from './coordination-browser.mjs';
const output=path.resolve(process.argv[2]??'');assert.ok(process.argv[2]&&!existsSync(path.join(output,'result.json')));mkdirSync(output,{recursive:true});
const project='self-ecom-m313-acceptance-'+randomUUID().slice(0,8),reuse=process.argv.find(a=>a.startsWith('--reuse='))?.slice(8),imagePrefix=reuse??project;assert.match(imagePrefix,/^self-ecom-m313-acceptance-[a-f0-9]{8}$/);
const adminPassword='Isolated#'+randomBytes(24).toString('hex'),secret=randomBytes(48).toString('hex'),dbPassword=randomBytes(24).toString('hex');
const secrets=[adminPassword,secret,dbPassword,...Object.entries(configured).filter(([k])=>/SECRET|PASSWORD|TOKEN|DATABASE_URL/.test(k)).map(([,v])=>v).filter(Boolean)];
const redact=s=>secrets.reduce((value,secret)=>value.replaceAll(secret,'[REDACTED]'),String(s)).replace(/postgres(?:ql)?:\/\/[^\s"'`]+/g,'[REDACTED_DATABASE_URL]');
const freePort=()=>new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(error=>error?reject(error):resolve(String(port)));});});
const ports=new Set();while(ports.size<4)ports.add(await freePort());const [apiPort,adminPort,storePort,dbPort]=[...ports];
const env={...process.env,COMPOSE_BAKE:'false',COMPOSE_PARALLEL_LIMIT:'1',POSTGRES_DB:'acceptance_dev',POSTGRES_USER:'acceptance',POSTGRES_PASSWORD:dbPassword,JWT_SECRET:secret,JWT_TTL_SECONDS:'7200',API_HOST_PORT:apiPort,ADMIN_HOST_PORT:adminPort,STORE_HOST_PORT:storePort,DB_HOST_PORT:dbPort,COMPOSE_CORS_ORIGINS:`http://localhost:${adminPort},http://localhost:${storePort}`,SWAGGER_ENABLED:'true',LOG_LEVEL:'info',INIT_ADMIN_USERNAME:'coordination_acceptance',INIT_ADMIN_PASSWORD:adminPassword,FILE_UPLOADS_PER_MINUTE:'100',HANDOVER_TIMEOUT_MINUTES:'1'};
const override=path.join(output,'compose.override.yaml');writeFileSync(override,`services:\n  api:\n    image: ${imagePrefix}-api:local\n  admin-web:\n    image: ${imagePrefix}-admin:local\n  store-web:\n    image: ${imagePrefix}-store:local\n`);
const base=['compose','--project-name',project,'--env-file','.env','-f','infra/compose.yaml','-f',override];
const report={startedAt:new Date().toISOString(),project,imagePrefix,checks:[],requests:[],commands:[],acceptedImages:[],pageErrors:[]};let browser,owned=false;
function run(args,label){console.log(JSON.stringify({started:label}));const startedAt=new Date().toISOString(),result=spawnSync(docker,args,{env,encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024});const log=path.join(output,'command-'+report.commands.length+'.log');writeFileSync(log,redact((result.stdout??'')+(result.stderr??'')+(result.error??'')));report.commands.push({label,command:['docker',...args],startedAt,endedAt:new Date().toISOString(),exitCode:result.status,log});assert.equal(result.status,0,label+' '+redact((result.stderr??'').slice(-500)));return result.stdout??'';}
const compose=(args,label)=>run([...base,...args],label),passed=label=>{report.checks.push(label);console.log(JSON.stringify({passed:label}));};
const originals=run(['ps','-aq'],'原容器清单').trim().split(/\s+/).filter(Boolean),originalVolumes=run(['volume','ls','--format','{{.Name}}'],'原卷清单').trim().split(/\s+/).filter(Boolean);
const originalState=()=>originals.length?run(['inspect','--format','{{.Id}} {{.State.StartedAt}} {{.State.Running}}',...originals],'原容器状态').trim():'';
const before=originalState();
async function call(site,url,method='GET',body,token,status=200,code,headers={}){const response=await fetch(site+'/api/v1'+url,{method,signal:AbortSignal.timeout(15000),headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});const json=await response.json();report.requests.push({method,path:url,status:response.status,requestId:json.requestId});assert.equal(response.status,status,url+' '+json.code);assert.equal(json.requestId,response.headers.get('x-request-id'));if(code)assert.equal(json.code,code);if(json.data?.accessToken)secrets.push(json.data.accessToken);return json.data??json;}
try{
 compose(['config','--quiet'],'本轮独占Compose配置');if(!reuse)for(const service of ['api','admin-web','store-web'])compose(['build',service],'顺序真实构建 '+service);else for(const [flag,service]of [['--rebuild-api','api'],['--rebuild-admin','admin-web'],['--rebuild-store','store-web']])if(process.argv.includes(flag))compose(['build',service],'最新生产镜像真实构建 '+service);
 for(const suffix of ['api','admin','store']){const name=imagePrefix+'-'+suffix+':local';report.acceptedImages.push({name,id:run(['image','inspect','--format','{{.Id}}',name],'冻结生产镜像ID').trim()});}
 owned=true;compose(['up','-d','--wait','--wait-timeout','90','db'],'启动本轮独占数据库');
 compose(['run','--rm','--no-deps','api','pnpm','db:migrate:deploy'],'空库应用全部增量迁移');compose(['run','--rm','--no-deps','api','pnpm','db:seed:permissions'],'独占权限目录初始化');compose(['run','--rm','--no-deps','-e','INIT_ADMIN_USERNAME','-e','INIT_ADMIN_PASSWORD','api','pnpm','db:seed:admin'],'独占管理员初始化');compose(['up','-d','--wait','--wait-timeout','120'],'启动独占四服务');
 const origin='http://localhost:'+adminPort,storeOrigin='http://localhost:'+storePort,adminToken=(await call(origin,'/admin/auth/login','POST',{username:env.INIT_ADMIN_USERNAME,password:adminPassword})).accessToken;
 const module=process.env.PLAYWRIGHT_MODULE_PATH??path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'),{chromium}=await import(pathToFileURL(module).href);browser=await launchCoordinationBrowser(chromium,output,env);
 const result=await verifyCoordination({origin,storeOrigin,adminToken,adminUsername:env.INIT_ADMIN_USERNAME,adminPassword,browser,call,passed,output,compose,env,secrets,report});await browser.close();browser=undefined;
 compose(['restart','db','api'],'重启本轮独占数据库和API');compose(['up','-d','--wait','--wait-timeout','120'],'等待独占服务重启');compose(['up','-d','--no-deps','--force-recreate','--wait','--wait-timeout','120','api'],'重建本轮独占API');await result.verifyPersistence();
 report.origins=[origin,storeOrigin,'http://localhost:'+apiPort];const spec=JSON.parse(readFileSync('docs/openapi/openapi.json','utf8'));for(const site of report.origins){assert.equal((await fetch(site+'/api/v1/health/ready')).status,200);assert.deepEqual(await(await fetch(site+'/api/docs-json')).json(),spec);}assert.deepEqual(report.pageErrors,[]);passed('同组生产镜像、三入口完整契约一致；重启/API重建保持真实协作事实');report.status='passed';
}catch(error){report.status='failed';report.failure=redact(error.stack??error.message);console.error(report.failure);process.exitCode=1;if(browser)for(const [index,page]of browser.contexts().flatMap(context=>context.pages()).entries())try{writeFileSync(path.join(output,'failure-page-'+index+'.txt'),redact(await page.locator('body').innerText()));await page.screenshot({path:path.join(output,'failure-page-'+index+'.png'),fullPage:true});}catch{/* 失败页面可能已关闭 */}if(owned)try{compose(['logs','--no-color','--tail','100','api'],'失败API诊断');}catch{/* 保留首个失败 */}
}finally{
 await browser?.close();try{assert.equal(originalState(),before);const volumes=run(['volume','ls','--format','{{.Name}}'],'复核原卷').trim().split(/\s+/);assert.ok(originalVolumes.every(volume=>volumes.includes(volume)));report.originalResourcesPreserved=true;if(owned)report.retainedResources={project,volumes:volumes.filter(volume=>volume.startsWith(project+'_'))};}catch(error){report.status='failed';report.protectionFailure=redact(error.message);process.exitCode=1;}
 report.cleaned=false;report.endedAt=new Date().toISOString();writeFileSync(path.join(output,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,requests:report.requests.length,project,imagePrefix,originalResourcesPreserved:report.originalResourcesPreserved,retainedResources:true}));
}
