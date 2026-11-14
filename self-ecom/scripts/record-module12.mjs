// 作用：记录本轮真实工程验证的时间、命令、退出码与脱敏输出；不生成任何业务替身。
import {spawnSync} from 'node:child_process';
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {env,redact} from './module12-runtime.mjs';
const [label,cwd,script,...args]=process.argv.slice(2);
if(!/^[a-z0-9-]+$/.test(label??'')||!cwd||!script)throw new Error('需要明确的验证标签、工作目录和Node脚本');
const target=resolve('docs/verification/evidence/M3-12',new Date().toISOString().replaceAll(':','-').replaceAll('.','-')+'-'+label);
mkdirSync(target,{recursive:true});const startedAt=new Date().toISOString();
const r=spawnSync(process.execPath,[resolve(script),...args],{cwd:resolve(cwd),env:{...env,PATH:resolve('D:/develop/nodejs')+';'+env.PATH},encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024});
const output=redact((r.stdout??'')+(r.stderr??'')+(r.error?.message??''));writeFileSync(target+'/output.log',output);
writeFileSync(target+'/result.json',JSON.stringify({startedAt,endedAt:new Date().toISOString(),cwd:resolve(cwd),command:['node',script,...args],exitCode:r.status},null,2)+'\n');
console.log(JSON.stringify({label,exitCode:r.status,evidence:target}));console.log(output.slice(-7000));process.exitCode=r.status??1;
