// 作用：使用固定依赖保存本轮真实命令证据；数据库测试仅创建和清理本次独占库，文件现场全部保留。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseEnv, stripVTControlCharacters } from 'node:util';
import { randomUUID } from 'node:crypto';
const require=createRequire(resolve('apps/api/package.json'));
const directory='docs/verification/evidence/M1-05';mkdirSync(directory,{recursive:true});
const mode=process.argv[2],label=process.argv[3]??'attempt1';assert.match(label,/^[a-z0-9-]+$/);
const reportPath=`${directory}/${mode}-${label}.json`;assert.ok(!existsSync(reportPath),'不能覆盖验证证据');
const env={...parseEnv(readFileSync('.env','utf8')),...process.env,NODE_ENV:'test',LOG_LEVEL:'silent'};
const root=process.cwd(),tsc=resolve('node_modules/typescript/bin/tsc'),vitest=resolve(require.resolve('vitest/package.json'),'../vitest.mjs');
const packages=['packages/shared','packages/api-client','packages/ui','apps/api','apps/admin-web','apps/store-web'];
const report={at:new Date().toISOString(),mode,label,checks:[]};
const redact=value=>Object.entries(env).filter(([k,v])=>/SECRET|PASSWORD|DATABASE_URL|TOKEN/.test(k)&&v?.length>5).reduce((s,[,v])=>s.replaceAll(v,'[REDACTED]'),value);
async function run(name,args,cwd=root,variables=env){
  console.log(JSON.stringify({name,status:'running'}));const startedAt=new Date().toISOString();
  const result=await new Promise(resolveResult=>{let output='';const child=spawn(process.execPath,args,{cwd,env:variables,windowsHide:true,stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',d=>{output+=d;});child.stderr.on('data',d=>{output+=d;});child.on('error',e=>resolveResult({exitCode:null,error:e.code,output}));child.on('close',(exitCode,signal)=>resolveResult({exitCode,signal,output}));});
  const log=`${directory}/${mode}-${label}-${name}.txt`;const output=redact(result.output);writeFileSync(log,output);const row={name,command:[process.execPath,...args],startedAt,endedAt:new Date().toISOString(),exitCode:result.exitCode,error:result.error??null,log};report.checks.push(row);
  console.log(stripVTControlCharacters(output).slice(-2200));console.log(JSON.stringify(row));return result.exitCode===0;
}
try{
  if(mode==='catalog'||mode==='catalog-migration'||mode==='integration'||mode==='avatar'){
    const {Client}=require('pg');const dev=new URL(env.DATABASE_URL),base=new URL(env.TEST_DATABASE_URL);
    assert.match(base.pathname,/^\/[a-z0-9_]+_test$/);assert.notEqual(base.pathname,dev.pathname);assert.equal(base.port,dev.port);
    const name=`m105_${randomUUID().replaceAll('-','')}_test`;base.pathname='/'+name;
    const adminUrl=new URL(env.DATABASE_URL);adminUrl.pathname='/postgres';const admin=new Client({connectionString:adminUrl.toString(),connectionTimeoutMillis:3000});let created=false;
    report.database={name,created:false,removed:false};
    try{
      await admin.connect();await admin.query(`CREATE DATABASE "${name}" ENCODING 'UTF8' TEMPLATE template0`);created=true;report.database.created=true;
      const variables={...env,DATABASE_URL:base.toString(),DEVELOPMENT_DATABASE_URL:dev.toString()};
      if(await run('migrate',[require.resolve('prisma/build/index.js'),'migrate','deploy'],resolve('apps/api'),variables)){
        if(mode==='avatar')await run('browser',[resolve('apps/store-web/test/verify-avatar-browser.mjs'),`--output=output/playwright/M1-05/avatar-${label}`],root,{...env,TEST_DATABASE_URL:base.toString()});
        else await run('tests',[vitest,'run','--config','vitest.integration.config.mts',...(mode==='catalog'?['test/catalog.integration.ts']:mode==='catalog-migration'?['test/catalog-migration.integration.ts']:process.argv.slice(4))],resolve('apps/api'),variables);
      }
    }finally{if(created){await admin.query(`DROP DATABASE "${name}"`);report.database.removed=true;}await admin.end();}
  }else if(mode==='types'||mode==='build'){
    for(const folder of packages)await run(folder.replaceAll('/','-'),[tsc,'-p',folder+(folder==='apps/api'&&mode==='build'?'/tsconfig.build.json':'/tsconfig.json'),...(mode==='types'?['--noEmit']:[])]);
    if(mode==='build')for(const app of ['admin-web','store-web'])await run(app,[resolve(`apps/${app}/node_modules/vite/bin/vite.js`),'build','--outDir',resolve(`output/build/M1-05/${label}/${app}`),'--emptyOutDir','false'],resolve('apps/'+app),{...env,NODE_ENV:'production'});
  }else if(mode==='lint')await run('all',[resolve('node_modules/eslint/bin/eslint.js'),'apps','packages','scripts','infra']);
  else if(mode==='unit'){
    await run('api',[vitest,'run'],resolve('apps/api'));
    for(const folder of ['packages/shared','packages/api-client','apps/admin-web','apps/store-web'])await run(folder.replaceAll('/','-'),['--test',...readdirSync(folder+'/test').filter(n=>n.endsWith('.test.mjs')).map(n=>resolve(folder,'test',n))]);
  }else if(mode==='contracts'){await run('consistency',[resolve('scripts/check-contracts.mjs')]);await run('drift',[resolve('scripts/test-contract-drift.mjs')]);}
  else throw new Error('未知检查组');
}finally{report.passed=report.checks.length>0&&report.checks.every(r=>r.exitCode===0);writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({mode,label,passed:report.passed}));if(!report.passed)process.exitCode=1;}
