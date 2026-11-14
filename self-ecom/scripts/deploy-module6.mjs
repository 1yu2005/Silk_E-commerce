// 作用：把已通过独立四服务验收的同一组镜像部署到常用环境，增量迁移并保护原数据库容器与卷。
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {resolve} from 'node:path';
const evidence=process.argv[2],output='docs/verification/evidence/M1-06/deployment.json';assert.ok(evidence&&!existsSync(output));
const accepted=JSON.parse(readFileSync(resolve(evidence,'result.json'),'utf8'));assert.equal(accepted.status,'passed');assert.match(accepted.imagePrefix,/^self-ecom-m106-acceptance-[a-f0-9]{8}$/);
const env={...parseEnv(readFileSync('.env','utf8')),...process.env},docker=env.DOCKER_EXECUTABLE??'docker';
const secrets=Object.entries(env).filter(([k,v])=>/SECRET|PASSWORD|DATABASE_URL|TOKEN/.test(k)&&v?.length>4).map(([,v])=>v);
const redact=s=>secrets.reduce((value,secret)=>value.replaceAll(secret,'[REDACTED]'),s);
const report={startedAt:new Date().toISOString(),acceptedEvidence:evidence,imagePrefix:accepted.imagePrefix,commands:[],images:[],checks:[]};
const run=(args,label)=>{const r=spawnSync(docker,args,{env,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});report.commands.push({label,exitCode:r.status});assert.equal(r.status,0,label+' '+redact((r.stderr??'')+(r.error??'')));return r.stdout;};
const compose=(args,label)=>run(['compose','--env-file','.env','-f','infra/compose.yaml',...args],label);
const inspect=id=>JSON.parse(run(['inspect','--format','{{json .}}',id],'核对容器').trim());
const safeState=id=>{const v=inspect(id);return {id:v.Id,startedAt:v.State.StartedAt,status:v.State.Status,health:v.State.Health?.Status,mounts:v.Mounts.map(m=>({name:m.Name,destination:m.Destination}))};};
const protect=mode=>{const r=spawnSync(process.execPath,['scripts/protect-module6.mjs',mode],{env,encoding:'utf8',windowsHide:true});report.commands.push({label:'保护快照 '+mode,exitCode:r.status});assert.equal(r.status,0,redact(r.stderr));};
try{
  protect('predeploy');
  report.beforeDatabase=safeState(compose(['ps','-q','db'],'获取原数据库容器').trim());assert.equal(report.beforeDatabase.status,'running');
  for(const [suffix,tag]of [['api','self-ecom-api:local'],['admin','self-ecom-admin-web:local'],['store','self-ecom-store-web:local']]){
    const source=accepted.imagePrefix+'-'+suffix+':local';run(['tag',source,tag],'部署已验收镜像标签 '+suffix);
    report.images.push({service:suffix,source,tag,id:run(['image','inspect','--format','{{.Id}}',tag],'读取镜像ID').trim()});
    assert.equal(report.images.at(-1).id,accepted.acceptedImages.find(i=>i.name===source).id,'只部署已验收的镜像ID');
  }
  compose(['run','--rm','--no-deps','api','pnpm','db:migrate:deploy'],'原开发库只应用增量迁移');protect('migrated');
  compose(['up','-d','--no-deps','--wait','--wait-timeout','120','api','admin-web','store-web'],'同组镜像更新三个应用');
  report.afterDatabase=safeState(compose(['ps','-q','db'],'复核数据库容器').trim());assert.deepEqual(report.afterDatabase,report.beforeDatabase);
  report.containers=compose(['ps','--format','json'],'记录最终四服务状态').trim().split('\n').filter(Boolean).map(line=>{const c=JSON.parse(line);return {service:c.Service,id:c.ID,image:c.Image,state:c.State,health:c.Health};});assert.equal(report.containers.length,4);assert.ok(report.containers.every(c=>c.state==='running'&&c.health==='healthy'));
  for(const port of [env.API_HOST_PORT??3000,env.ADMIN_HOST_PORT??8080,env.STORE_HOST_PORT??8081]){
    const origin='http://localhost:'+port;const ready=await fetch(origin+'/api/v1/health/ready');assert.equal(ready.status,200);
    const doc=await(await fetch(origin+'/api/docs-json')).json();const count=Object.values(doc.paths).reduce((n,item)=>n+Object.keys(item).filter(k=>['get','post','put','patch','delete'].includes(k)).length,0);assert.equal(count,85);assert.deepEqual(doc,JSON.parse(readFileSync('docs/openapi/openapi.json','utf8')));
    const products=await(await fetch(origin+'/api/v1/store/products')).json();assert.ok(Array.isArray(products.data.items));assert.match(products.requestId,/^[a-f0-9-]{36}$/);report.checks.push({origin,ready:ready.status,operations:count,publicProducts:products.data.total,requestId:products.requestId});
  }
  report.passed=true;console.log(JSON.stringify({passed:true,checks:report.checks,databasePreserved:true,containers:report.containers}));
}catch(error){report.failure=redact(error.message);throw error;}
finally{report.endedAt=new Date().toISOString();writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
