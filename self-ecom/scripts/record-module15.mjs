// 作用：记录板块15真实命令、源码状态、时间及退出码；原始日志只保留在忽略目录。
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {appendFileSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
const argv=process.argv.slice(2),envIndex=argv.indexOf('--env-file');let selected={};
if(envIndex>=0){assert.ok(argv[envIndex+1]);selected=parseEnv(readFileSync(path.resolve(argv[envIndex+1]),'utf8'));argv.splice(envIndex,2);}
const [label,cwd,script,...args]=argv;assert.match(label??'',/^[a-z0-9-]+$/);assert.ok(cwd&&script);
const id=new Date().toISOString().replace(/[:.]/g,'-')+'-'+label;
const publicFolder=path.resolve('docs/verification/M4-15/engineering',id),privateFolder=path.resolve('output/testing/M4-15/commands',id),temporary=path.resolve('output/testing/M4-15/workspace-temp');
for(const folder of [publicFolder,privateFolder,temporary])mkdirSync(folder,{recursive:true});
const git=args=>execFileSync('git',args,{encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']});
const sources=[...new Set([...git(['diff','HEAD','--relative','--name-only','-z']).split('\0'),...git(['ls-files','--others','--exclude-standard','-z']).split('\0')])].filter(file=>/^(apps|packages|scripts|infra)\//.test(file)||/^(package\.json|pnpm-lock\.yaml)$/.test(file)).sort().map(file=>{try{return {file,sha256:createHash('sha256').update(readFileSync(file)).digest('hex')};}catch{return {file,missing:true};}});
const revision={head:git(['rev-parse','HEAD']).trim(),branch:git(['branch','--show-current']).trim(),trackedDiffSha256:createHash('sha256').update(git(['diff','HEAD','--','.'])).digest('hex'),sourceFiles:sources,sourceManifestSha256:createHash('sha256').update(JSON.stringify(sources)).digest('hex')};
const secrets=Object.entries(selected).filter(([key,value])=>/PASSWORD|SECRET|TOKEN|DATABASE_URL/.test(key)&&value?.length>=6).map(([,value])=>value);
for(const [key,value]of Object.entries(selected))if(/DATABASE_URL/.test(key))try{secrets.push(decodeURIComponent(new URL(value).password));}catch{/* 不显示无效连接。 */}
const redact=input=>{let result=String(input);for(const value of secrets.filter(Boolean).sort((a,b)=>b.length-a.length))result=result.replaceAll(value,'[REDACTED]');return result.replace(/postgres(?:ql)?:\/\/[^\s"'`<>]+/g,'[REDACTED_DATABASE_URL]').replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,'[REDACTED_JWT]').replace(/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g,'[REDACTED_PASSWORD_HASH]').replace(/\b(?:Isolated|Next|Customer|Init)#[A-Fa-f0-9]{20,}/g,'[REDACTED_PASSWORD]');};
const startedAt=new Date().toISOString(),runEnv={...process.env,...selected,TEMP:temporary,TMP:temporary,PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH};
const rawFile=path.join(privateFolder,'output.log');
const startReport={label,startedAt,revision,cwd:path.resolve(cwd),command:['node',script,...args],status:'RUNNING',rawLogRetained:true};
writeFileSync(path.join(publicFolder,'started.json'),JSON.stringify(startReport,null,2)+'\n');
writeFileSync(rawFile,'');
// 长回归边执行边保留原始输出；工具会话中断时也可定位最后执行的套件，不能把中断算通过。
const child=spawn(process.execPath,[script.startsWith('-')?script:path.resolve(script),...args],{cwd:path.resolve(cwd),env:runEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});
const result=await new Promise(resolve=>{
 child.stdout.on('data',chunk=>appendFileSync(rawFile,chunk));
 child.stderr.on('data',chunk=>appendFileSync(rawFile,chunk));
 child.on('error',error=>{appendFileSync(rawFile,error.code??'COMMAND_FAILED');resolve({status:1,signal:null});});
 child.on('close',(status,signal)=>resolve({status,signal}));
});
const raw=readFileSync(rawFile,'utf8'),safe=redact(raw).replace(/\r\n?/g,'\n').replace(/[\t ]+$/gm,'').replace(/\n+$/,'')+'\n';
writeFileSync(path.join(publicFolder,'output.redacted.txt'),safe);
const report={...startReport,status:result.status===0?'PASSED':'FAILED',endedAt:new Date().toISOString(),exitCode:result.status??1,signal:result.signal,publicSha256:createHash('sha256').update(safe).digest('hex')};
writeFileSync(path.join(publicFolder,'result.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({label,exitCode:report.exitCode,evidence:publicFolder}));console.log(safe.slice(-3500));process.exitCode=report.exitCode;
