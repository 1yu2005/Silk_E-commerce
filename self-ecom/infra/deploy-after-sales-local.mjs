// 作用：仅将本轮独占验收通过的同一组镜像部署到原四服务；不重建数据库或数据卷。
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import path from 'node:path';
import {docker} from '../scripts/module11-runtime.mjs';
const source=process.argv[2],label=process.argv[3]??'final';assert.match(label,/^[a-z0-9-]+$/);
const accepted=JSON.parse(readFileSync(path.join(source,'result.json'),'utf8'));assert.equal(accepted.status,'passed');
const directory='docs/verification/evidence/M3-11',target=directory+'/deployment-'+label+'.json';assert.ok(!existsSync(target));mkdirSync(directory,{recursive:true});
const env={...process.env,...parseEnv(readFileSync('.env','utf8'))};
const secrets=Object.entries(env).filter(([k,v])=>/SECRET|PASSWORD|TOKEN|DATABASE_URL/.test(k)&&v).map(([,v])=>v);
const redact=s=>secrets.reduce((r,v)=>r.replaceAll(v,'[REDACTED]'),String(s));
const report={startedAt:new Date().toISOString(),source,commands:[],images:[],checks:[]};
function run(args,name){const startedAt=new Date().toISOString();const r=spawnSync(docker,args,{env,encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024});const log=directory+'/deployment-'+label+'-'+report.commands.length+'.txt';writeFileSync(log,redact((r.stdout??'')+(r.stderr??'')));report.commands.push({name,command:['docker',...args],startedAt,endedAt:new Date().toISOString(),exitCode:r.status,log});assert.equal(r.status,0,name);return r.stdout.trim();}
const compose=(args,name)=>run(['compose','--project-name','self-ecom','--env-file','.env','-f','infra/compose.yaml',...args],name);
const readState=name=>JSON.parse(run(['inspect','--format','{"Id":{{json .Id}},"Image":{{json .Image}},"State":{"StartedAt":{{json .State.StartedAt}}},"Mounts":{{json .Mounts}}}',name],'核对容器状态'));
const dbBefore=readState('self-ecom-db-1');const uploadsBefore=readState('self-ecom-api-1').Mounts.find(m=>m.Destination==='/app/storage/uploads');
try{
 compose(['config','--quiet'],'沿用原Compose配置');
 const destinations=['self-ecom-api:local','self-ecom-admin-web:local','self-ecom-store-web:local'];
 for(const [n,image]of accepted.acceptedImages.entries()){assert.match(image.name,/^self-ecom-m311-acceptance-[a-f0-9]{8}-(api|admin|store):local$/);assert.equal(run(['image','inspect','--format','{{.Id}}',image.name],'核对已验收镜像'),image.id);run(['tag',image.name,destinations[n]],'标记常用镜像');report.images.push({...image,target:destinations[n]});}
 compose(['run','--rm','--no-deps','api','pnpm','db:migrate:deploy'],'原库非破坏增量迁移');
 // 本期没有新增权限码，保留原权限目录与个人授权。
 compose(['up','-d','--no-deps','--wait','--wait-timeout','120','api','admin-web','store-web'],'更新三应用，保留原DB容器与两卷');
 const dbAfter=readState('self-ecom-db-1'),api=readState('self-ecom-api-1');assert.equal(dbAfter.Id,dbBefore.Id);assert.equal(dbAfter.State.StartedAt,dbBefore.State.StartedAt);assert.deepEqual(dbAfter.Mounts,dbBefore.Mounts);assert.equal(api.Mounts.find(m=>m.Destination==='/app/storage/uploads').Name,uploadsBefore.Name);
 const names=['self-ecom-api-1','self-ecom-admin-web-1','self-ecom-store-web-1'];for(const [i,name]of names.entries())assert.equal(readState(name).Image,accepted.acceptedImages[i].id);
 report.checks.push('原数据库容器ID/启动时间/挂载保持，上传卷名称保持，三应用等于验收镜像ID');
 const spec=JSON.parse(readFileSync('docs/openapi/openapi.json','utf8'));
 report.origins=[Number(env.API_HOST_PORT??3000),Number(env.ADMIN_HOST_PORT??8080),Number(env.STORE_HOST_PORT??8081)].map(p=>'http://localhost:'+p);
 for(const origin of report.origins){assert.equal((await fetch(origin+'/api/v1/health/ready')).status,200);assert.deepEqual(await(await fetch(origin+'/api/docs-json')).json(),spec);}
 report.checks.push('三个入口155操作完整OpenAPI一致');report.status='passed';
}catch(e){report.status='failed';report.failure=redact(e.stack??e.message);process.exitCode=1;}
finally{report.endedAt=new Date().toISOString();writeFileSync(target,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks,origins:report.origins}));}
