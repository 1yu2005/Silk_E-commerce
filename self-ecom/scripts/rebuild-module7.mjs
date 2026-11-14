// 作用：有实际CSS清理后刷新独占镜像标签；不启动服务，不触及常用镜像与数据。
import assert from 'node:assert/strict';
import{spawnSync}from'node:child_process';
import{readFileSync,writeFileSync,existsSync}from'node:fs';
import{parseEnv}from'node:util';
import{resolve}from'node:path';
const output='docs/verification/evidence/M2-07/build-refresh.json';assert.ok(!existsSync(output));
const env={...parseEnv(readFileSync('.env','utf8')),...process.env};const secrets=Object.entries(env).filter(([k,v])=>/SECRET|PASSWORD|TOKEN|DATABASE_URL/.test(k)&&v?.length>4).map(([,v])=>v);const redact=s=>secrets.reduce((r,v)=>r.replaceAll(v,'[REDACTED]'),s);
const docker=env.DOCKER_EXECUTABLE??'docker',report={startedAt:new Date().toISOString(),reason:'移除已无静态或动态使用入口的purchase-coming旧样式',command:['compose','build'],images:[]};
const r=spawnSync(docker,['compose','--env-file','.env','-f','infra/compose.yaml','-f',resolve('output/playwright/M2-07/docker-first/compose.override.yaml'),'build'],{env,encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024});report.exitCode=r.status;report.endedAt=new Date().toISOString();writeFileSync('output/playwright/M2-07/build-refresh.log',redact((r.stdout??'')+(r.stderr??'')));
if(r.status===0)for(const suffix of ['api','admin','store']){const name='self-ecom-m207-acceptance-3ead21bc-'+suffix+':local';const image=spawnSync(docker,['image','inspect','--format','{{.Id}}',name],{env,encoding:'utf8',windowsHide:true});assert.equal(image.status,0);report.images.push({name,id:image.stdout.trim()});}
writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({exitCode:r.status,images:report.images,reason:report.reason}));if(r.status!==0)process.exitCode=1;
