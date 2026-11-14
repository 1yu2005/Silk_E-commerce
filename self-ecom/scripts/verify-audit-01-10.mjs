// 作用：保存本轮审查的实际验证证据；独占测试库和测试文件全部保留，不执行递归清理。
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseEnv,stripVTControlCharacters} from 'node:util';

const root=process.cwd(),require=createRequire(resolve('apps/api/package.json'));
const [mode,label,...requested]=process.argv.slice(2);
assert.match(label??'',/^[a-z0-9-]+$/);
const directory=resolve('docs/verification/evidence/AUDIT-01-10-2026-11-14');
mkdirSync(directory,{recursive:true});
const target=resolve(directory,`${mode}-${label}.json`);assert.ok(!existsSync(target),'证据不可覆盖');
const env={...parseEnv(readFileSync('.env','utf8')),...process.env,NODE_ENV:'test',LOG_LEVEL:'silent'};
const temporary=resolve('output/testing/AUDIT-01-10-2026-11-14');mkdirSync(temporary,{recursive:true});
env.TMP=temporary;env.TEMP=temporary;
const guard=pathToFileURL(resolve('docs/verification/evidence/M0-04/step11/retain-artifacts.mjs')).href;
env.NODE_OPTIONS=[env.NODE_OPTIONS,`--import=${guard}`].filter(Boolean).join(' ');
const secrets=Object.entries(env).filter(([k,v])=>/SECRET|PASSWORD|TOKEN|DATABASE_URL/.test(k)&&v?.length>5).map(([,v])=>v);
const redact=value=>secrets.reduce((s,v)=>s.replaceAll(v,'[REDACTED]'),value);
const report={startedAt:new Date().toISOString(),mode,label,checks:[],retainedDatabases:[]};
const vitest=resolve(require.resolve('vitest/package.json'),'../vitest.mjs'),tsc=resolve('node_modules/typescript/bin/tsc');
async function run(name,args,cwd=root,variables=env){
  console.log(JSON.stringify({name,status:'running'}));const startedAt=new Date().toISOString();
  const result=await new Promise(done=>{let output='';const child=spawn(process.execPath,args,{cwd,env:variables,windowsHide:true,stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',d=>{output+=d;});child.stderr.on('data',d=>{output+=d;});child.on('error',e=>done({exitCode:null,error:e.code,output}));child.on('close',(exitCode,signal)=>done({exitCode,signal,output}));});
  const log=resolve(directory,`${mode}-${label}-${name}.txt`),output=redact(result.output);writeFileSync(log,output);
  const check={name,command:[process.execPath,...args],startedAt,endedAt:new Date().toISOString(),exitCode:result.exitCode,error:result.error??null,log};report.checks.push(check);
  console.log(stripVTControlCharacters(output).slice(-1800));console.log(JSON.stringify(check));return result.exitCode===0;
}
try{
  if(mode==='integration'){
    const {Client}=require('pg');const dev=new URL(env.DATABASE_URL),base=new URL(env.TEST_DATABASE_URL);
    assert.match(base.pathname,/^\/[a-z0-9_]+_test$/);assert.notEqual(dev.pathname,base.pathname);
    assert.equal(base.hostname,dev.hostname);assert.equal(base.port,dev.port);
    const all=readdirSync('apps/api/test').filter(n=>n.endsWith('.integration.ts')).map(n=>'test/'+n);
    const files=requested.filter(n=>!n.startsWith('--'));assert.ok(files.every(n=>all.includes(n)),'测试文件必须来自本项目');
    const pattern=requested.find(n=>n.startsWith('--testNamePattern='));
    const adminUrl=new URL(base);adminUrl.pathname='/postgres';const admin=new Client({connectionString:adminUrl.toString(),connectionTimeoutMillis:3000});
    await admin.connect();
    try{for(const file of files.length?files:all){
      const name=(file.includes('/fulfillment')?'m210_':file.includes('/orders')?'m108_':'m105_')+randomUUID().replaceAll('-','')+'_test';
      await admin.query(`CREATE DATABASE "${name}" ENCODING 'UTF8' TEMPLATE template0`);
      report.retainedDatabases.push({name,suite:file});const url=new URL(base);url.pathname='/'+name;
      const variables={...env,DATABASE_URL:url.toString(),DEVELOPMENT_DATABASE_URL:dev.toString(),FULL_VERIFICATION_KIND:'integration'};
      const id=file.replace('test/','').replace('.integration.ts','');
      if(await run(id+'-migrate',[require.resolve('prisma/build/index.js'),'migrate','deploy'],resolve('apps/api'),variables))
        await run(id,[vitest,'run','--config','test/verification/retained.config.mts',file,...(pattern?[pattern]:[])],resolve('apps/api'),variables);
    }}finally{await admin.end();}
  }else if(mode==='unit'){
    await run('api',[vitest,'run','--config','test/verification/retained.config.mts'],resolve('apps/api'));
    for(const folder of ['packages/shared','packages/api-client','apps/admin-web','apps/store-web'])
      await run(folder.replaceAll('/','-'),['--test',...readdirSync(folder+'/test').filter(n=>n.endsWith('.test.mjs')).map(n=>resolve(folder,'test',n))]);
  }else if(mode==='types'||mode==='build'){
    for(const folder of ['packages/shared','packages/api-client','packages/ui','apps/api','apps/admin-web','apps/store-web'])
      await run(folder.replaceAll('/','-'),[tsc,'-p',folder+(folder==='apps/api'&&mode==='build'?'/tsconfig.build.json':'/tsconfig.json'),...(mode==='types'?['--noEmit']:[])]);
    if(mode==='build')for(const app of ['admin-web','store-web'])await run(app,[resolve(`apps/${app}/node_modules/vite/bin/vite.js`),'build','--outDir',resolve(`output/build/AUDIT-01-10-2026-11-14/${label}/${app}`),'--emptyOutDir','false'],resolve('apps/'+app),{...env,NODE_ENV:'production'});
  }else if(mode==='lint')await run('all',[resolve('node_modules/eslint/bin/eslint.js'),'apps','packages','scripts','infra']);
  else if(mode==='contracts'){
    await run('consistency',[resolve('scripts/check-contracts.mjs')]);await run('drift',[resolve('scripts/test-contract-drift.mjs')]);
  }else throw new Error('未知验证组');
}catch(error){report.failure=redact(error.stack??error.message);console.error(report.failure);}
finally{report.endedAt=new Date().toISOString();report.passed=!report.failure&&report.checks.length>0&&report.checks.every(c=>c.exitCode===0);writeFileSync(target,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({mode,label,passed:report.passed,retainedDatabases:report.retainedDatabases.length}));if(!report.passed)process.exitCode=1;}
