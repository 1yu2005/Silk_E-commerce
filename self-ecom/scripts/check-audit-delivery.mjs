// 作用：只读核对本轮已验收镜像、私有材料排除及待提交内容；实际口令只由调用方内存传入。
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import path from 'node:path';

export function checkAuditDelivery({docker,acceptedDirectory,buildDirectory,passwords,label}){
 assert.match(label,/^[a-z0-9-]+$/);
 const target='docs/verification/evidence/AUDIT-01-10-2026-11-14/delivery-'+label+'.json';assert.ok(!existsSync(target));
 const env=parseEnv(readFileSync('.env','utf8'));
 const secrets=[...passwords,...Object.entries(env).filter(([key,value])=>/SECRET|PASSWORD|TOKEN|DATABASE_URL/.test(key)&&value.length>=6).map(([,value])=>value)];
 const report={startedAt:new Date().toISOString(),checks:[],commands:[],findings:[],exclusions:[]};
 function run(binary,args){const startedAt=new Date().toISOString(),result=spawnSync(binary,args,{encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024});report.commands.push({command:[path.basename(binary),...args],startedAt,endedAt:new Date().toISOString(),exitCode:result.status,error:result.error?.code??null});assert.equal(result.status,0,'只读核对命令失败'+(result.error?.code?' '+result.error.code:''));return result.stdout+(args[0]==='logs'?result.stderr:'');}
 function scan(name,content,baseline=''){
  // 只排除两个完整公开常量，不能普遍忽略数字口令或UUID附近的敏感内容。
  const normalize=text=>text.replaceAll('0123456789abcdef','[HEX_ALPHABET]').replaceAll('12345678-abcd-4abc-8def-abcdefabcdef','[SKU_UUID_TEST_FIXTURE]');
  const normalized=normalize(content);
  if(content!==normalized&&secrets.some(secret=>content.includes(secret)&&!normalized.includes(secret)))report.exclusions.push({name,reason:'公开固定十六进制字符集或完整SKU测试UUID的数字子串，非认证凭据'});
  const occurrences=(text,needle)=>text.split(needle).length-1;
  if(secrets.some(secret=>occurrences(normalized,secret)>occurrences(normalize(baseline),secret)))report.findings.push(name);
  if(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(normalized))report.findings.push(name+':JWT');
 }
 const files=directory=>readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(directory,entry.name)):[path.join(directory,entry.name)]);
 try{
  const accepted=JSON.parse(readFileSync(path.join(acceptedDirectory,'result.json'),'utf8'));assert.equal(accepted.status,'passed');
  for(const [index,name]of ['self-ecom-api-1','self-ecom-admin-web-1','self-ecom-store-web-1'].entries()){
   assert.equal(run(docker,['inspect','--format','{{.Image}}',name]).trim(),accepted.acceptedImages[index].id);
   scan(name+'镜像配置',run(docker,['image','inspect','--format','{{json .Config}}',accepted.acceptedImages[index].id]));
   scan(name+'运行日志',run(docker,['logs','--tail','400',name]));
  }
  assert.equal(run(docker,['exec','self-ecom-api-1','id','-u']).trim(),'1000');
  assert.equal(run(docker,['exec','self-ecom-api-1','node','-e',"const f=require('fs');const bad=['/app/.env','/app/private-delivery','/app/output','/app/test','/app/apps/api/test','/app/scripts/task-acceptance.mjs'].filter(p=>f.existsSync(p));console.log(JSON.stringify(bad));process.exitCode=bad.length?1:0"]).trim(),'[]');
  report.checks.push('三应用使用同组验收镜像；API非root；镜像排除真实配置、私有交付和测试入口');
  const tracked=run('git',['diff','--name-only','--relative','-z','--','.']).split('\0').filter(Boolean);
  const untracked=run('git',['ls-files','--others','--exclude-standard','-z','--','.']).split('\0').filter(Boolean);
  for(const filename of tracked)if(existsSync(filename))scan(filename,readFileSync(filename,'utf8'),run('git',['show','HEAD:self-ecom/'+filename]));
  for(const filename of untracked)if(existsSync(filename))scan(filename,readFileSync(filename,'utf8'));
  for(const filename of files(buildDirectory))scan(filename,readFileSync(filename,'utf8'));
  run('git',['check-ignore','--quiet','private-delivery/板块10_开发完成说明_含账号密码.local.md']);
  assert.match(readFileSync('.dockerignore','utf8'),/^private-delivery\s*$/m);assert.equal(run('git',['ls-files','--','private-delivery']).trim(),'');
  assert.deepEqual(report.findings,[]);report.checks.push('新增可提交内容/验收证据/两端产物/镜像配置/日志未发现实际秘密，Git和Docker排除私有交付');
  report.git={branch:run('git',['branch','--show-current']).trim(),head:run('git',['rev-parse','HEAD']).trim(),staged:run('git',['diff','--cached','--name-only']).trim()};
  assert.equal(report.git.staged,'','核对时保持未暂存');report.status='passed';
 }catch(error){report.status='failed';report.failure=error instanceof assert.AssertionError?'交付断言失败：'+error.message:error.code??error.name;}
 finally{report.endedAt=new Date().toISOString();writeFileSync(target,JSON.stringify(report,null,2)+'\n');}
 return {status:report.status,checks:report.checks,findings:report.findings,failure:report.failure};
}
