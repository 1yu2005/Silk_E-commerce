// 作用：只部署板块13独占验收通过的同组镜像；原数据库容器、账号、数据及上传卷保持。
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {env,docker,redact} from '../scripts/module13-runtime.mjs';
const source=process.argv[2],label=process.argv[3]??'final';assert.ok(source);assert.match(label,/^[a-z0-9-]+$/);
const accepted=JSON.parse(readFileSync(path.join(source,'result.json'),'utf8'));assert.equal(accepted.status,'passed');assert.equal(accepted.originalResourcesPreserved,true);assert.equal(accepted.acceptedImages.length,3);
const directory='docs/verification/evidence/M3-13',target=directory+'/deployment-'+label+'.json';assert.ok(!existsSync(target));mkdirSync(directory,{recursive:true});
const report={startedAt:new Date().toISOString(),source,commands:[],images:[],checks:[]};
function run(args,name){const startedAt=new Date().toISOString(),result=spawnSync(docker,args,{env,encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024});const log=directory+'/deployment-'+label+'-'+report.commands.length+'.txt';writeFileSync(log,redact((result.stdout??'')+(result.stderr??'')+(result.error??'')));report.commands.push({name,command:['docker',...args],startedAt,endedAt:new Date().toISOString(),exitCode:result.status,log});assert.equal(result.status,0,name);return result.stdout.trim();}
const compose=(args,name)=>run(['compose','--project-name','self-ecom','--env-file','.env','-f','infra/compose.yaml',...args],name),state=name=>JSON.parse(run(['inspect','--format','{"Id":{{json .Id}},"Image":{{json .Image}},"State":{"StartedAt":{{json .State.StartedAt}}},"Mounts":{{json .Mounts}}}',name],'核对容器状态'));
try{
 const dbBefore=state('self-ecom-db-1'),uploadsBefore=state('self-ecom-api-1').Mounts.find(m=>m.Destination==='/app/storage/uploads');assert.ok(uploadsBefore?.Name);compose(['config','--quiet'],'沿用常用Compose配置');
 const destinations=['self-ecom-api:local','self-ecom-admin-web:local','self-ecom-store-web:local'];for(const [index,image]of accepted.acceptedImages.entries()){assert.match(image.name,/^self-ecom-m313-acceptance-[a-f0-9]{8}-(api|admin|store):local$/);assert.ok(image.name.endsWith('-'+['api','admin','store'][index]+':local'));assert.equal(run(['image','inspect','--format','{{.Id}}',image.name],'核对已验收镜像ID'),image.id);run(['tag',image.name,destinations[index]],'标记常用镜像');report.images.push({...image,target:destinations[index]});}
 compose(['run','--rm','--no-deps','api','pnpm','db:migrate:deploy'],'原库非破坏增量迁移');
 // 增量同步权限目录，不改已有成员/个人授权；服务端运行时权限仍逐次校验。
 compose(['run','--rm','--no-deps','api','pnpm','db:seed:permissions'],'同步本板块必要权限目录');compose(['up','-d','--no-deps','--wait','--wait-timeout','120','api','admin-web','store-web'],'更新三应用，保持原DB容器与两卷');
 const dbAfter=state('self-ecom-db-1'),api=state('self-ecom-api-1');assert.equal(dbAfter.Id,dbBefore.Id);assert.equal(dbAfter.State.StartedAt,dbBefore.State.StartedAt);assert.deepEqual(dbAfter.Mounts,dbBefore.Mounts);assert.equal(api.Mounts.find(m=>m.Destination==='/app/storage/uploads').Name,uploadsBefore.Name);for(const [index,name]of ['self-ecom-api-1','self-ecom-admin-web-1','self-ecom-store-web-1'].entries())assert.equal(state(name).Image,accepted.acceptedImages[index].id);report.checks.push('原DB容器ID/启动时刻/挂载保持，上传卷保持，三应用等于验收镜像ID');
 report.origins=[Number(env.API_HOST_PORT??3000),Number(env.ADMIN_HOST_PORT??8080),Number(env.STORE_HOST_PORT??8081)].map(port=>'http://localhost:'+port);const spec=JSON.parse(readFileSync('docs/openapi/openapi.json','utf8'));for(const origin of report.origins){assert.equal((await fetch(origin+'/api/v1/health/ready')).status,200);assert.deepEqual(await(await fetch(origin+'/api/docs-json')).json(),spec);}report.checks.push('三入口就绪且完整OpenAPI与本地生成契约一致');report.status='passed';
}catch(error){report.status='failed';report.failure=redact(error.stack??error.message);process.exitCode=1;}
finally{report.endedAt=new Date().toISOString();writeFileSync(target,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks,origins:report.origins}));}
