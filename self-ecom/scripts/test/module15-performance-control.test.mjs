import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,appendFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {controlFileName,createControlInbox,readControlResponse,writeControlCommand} from '../../apps/api/test/fixtures/module15-performance-control.mjs';
import {performanceRunPlan,capturedPlannerSettings} from '../module15-performance-options.mjs';
import {workloadPaths} from '../module15-performance-support.mjs';

const runId='1234abcd-1234-1234-1234-123456789012',sessionId='aaaaaaaa-1234-1234-1234-123456789012',otherSession='bbbbbbbb-1234-1234-1234-123456789012';
const command=(sequence,action,session=sessionId)=>({protocol:2,runId,sessionId:session,sequence,action,capture:false});
const directory=()=>mkdtemp(join(tmpdir(),'self-ecom-m415-control-retained-'));

test('partial commands wait for their final newline; foreign runs and legacy fixed files are ignored',async()=>{
 const folder=await directory(),inbox=createControlInbox(folder,runId),start=command(1,'start'),file=join(folder,controlFileName('command',start));
 await writeFile(join(folder,'command.json'),JSON.stringify(start)+'\n',{flag:'wx'});
 await writeControlCommand(folder,{...command(1,'start',otherSession),runId:'ffffffff-1234-1234-1234-123456789012'});
 await writeFile(file,JSON.stringify(start).slice(0,-1),{flag:'wx'});
 assert.equal(await inbox.next(),null);await appendFile(file,'}');assert.equal(await inbox.next(),null);
 await appendFile(file,'\n');assert.deepEqual(await inbox.next(),start);
 assert.equal(await inbox.next(),null,'an outstanding command cannot be consumed twice');
 await inbox.reply(start,{action:'started'});assert.equal((await readControlResponse(folder,start)).action,'started');
 assert.equal(await inbox.next(),null,'completed commands are not replayed');
 assert.equal(await createControlInbox(folder,runId).next(),null,'completed commands survive probe restart');
});

test('start and stop remain ordered while new sessions safely restart at sequence one',async()=>{
 const folder=await directory(),inbox=createControlInbox(folder,runId),start=command(1,'start'),stop=command(2,'stop');
 await writeControlCommand(folder,stop);assert.equal(await inbox.next(),null,'stop cannot precede its start acknowledgement');
 await writeControlCommand(folder,start);assert.deepEqual(await inbox.next(),start);await inbox.reply(start,{action:'started'});
 assert.deepEqual(await inbox.next(),stop);await inbox.reply(stop,{action:'stopped'});
 const next=command(1,'start',otherSession);await writeControlCommand(folder,next);assert.deepEqual(await inbox.next(),next);await inbox.reply(next,{action:'started'});
 assert.equal(await inbox.next(),null);assert.equal(await readControlResponse(folder,{...next,sessionId:sessionId,sequence:3}),null);
});

test('exclusive files retain original commands and responses instead of replacing shared files',async()=>{
 const folder=await directory(),inbox=createControlInbox(folder,runId),start=command(1,'start');
 await writeControlCommand(folder,start);const original=await readFile(join(folder,controlFileName('command',start)),'utf8');
 await assert.rejects(writeControlCommand(folder,{...start,action:'stop'}),{code:'EEXIST'});
 assert.equal(await readFile(join(folder,controlFileName('command',start)),'utf8'),original);
 await inbox.next();await inbox.reply(start,{action:'started'});
 const responseFile=join(folder,controlFileName('response',start)),response=await readFile(responseFile,'utf8');
 await assert.rejects(writeFile(responseFile,'replacement',{flag:'wx'}),{code:'EEXIST'});assert.equal(await readFile(responseFile,'utf8'),response);
 const stop=command(2,'stop');await writeFile(join(folder,controlFileName('response',stop)),JSON.stringify({...stop,sessionId:otherSession,action:'stopped'})+'\n',{flag:'wx'});
 assert.equal(await readControlResponse(folder,stop),null,'a foreign session cannot acknowledge this command');
});

test('the real probe completes two isolated file-only sessions without PostgreSQL or HTTP',async t=>{
 const folder=await directory(),probe=new URL('../../apps/api/test/fixtures/module15-performance-probe.mjs',import.meta.url);
 const child=spawn(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(probe.href)});setInterval(()=>{},1000);`],{windowsHide:true,stdio:'ignore',env:{...process.env,NODE_ENV:'production',M415_ISOLATED_BOOTSTRAP:'1',M415_RUN_ID:runId,M415_PROBE_DIRECTORY:folder,DATABASE_URL:'postgresql://synthetic:synthetic@127.0.0.1:1/m415_12345678901212341234123456789012_test'}});
 const exited=new Promise(resolve=>child.once('exit',resolve));t.after(async()=>{child.kill();await exited;});
 async function send(value){await writeControlCommand(folder,value);const end=Date.now()+5000;while(Date.now()<end){const response=await readControlResponse(folder,value);if(response)return response;assert.equal(child.exitCode,null,'file-only probe must remain running');await new Promise(resolve=>setTimeout(resolve,25));}assert.fail('file-only probe response timed out');}
 const retained=[];
 for(const session of [sessionId,otherSession]){
  const start={...command(1,'start',session),capture:true};assert.equal((await send(start)).action,'started');
  const stopped=await send(command(2,'stop',session));assert.equal(stopped.action,'stopped');assert.equal(stopped.sessionId,session);assert.equal(stopped.pending,0);assert.equal(stopped.writerError,null);
  assert.equal(stopped.rawFile,controlFileName('probe',start));assert.equal(stopped.captureFile,controlFileName('capture',start));
  const raw=(await readFile(join(folder,stopped.rawFile),'utf8')).trim(),records=raw?raw.split('\n').map(line=>JSON.parse(line)):[];
  assert.ok(records.every(row=>row.kind==='api-memory'&&row.sessionId===session));assert.deepEqual(JSON.parse(await readFile(join(folder,stopped.captureFile),'utf8')),[]);retained.push(stopped.rawFile,stopped.captureFile);
 }
 assert.equal(new Set(retained).size,4,'new sessions preserve every previous raw and capture file');
});

test('formal performance always uses the complete 168 minute matrix regardless of diagnostic overrides',()=>{
 const plan=performanceRunPlan({diagnostic:{concurrency:1,warmupSeconds:1,measurementSeconds:1,workloads:['orders']}},{diagnostic:false},workloadPaths());
 assert.deepEqual(plan.workloads,['orders','products','tasks','trends30','hotProducts','customers','audit','mixed']);
 assert.deepEqual(plan.load,{concurrency:100,warmupSeconds:120,measurementSeconds:300,rounds:3});assert.equal(plan.minimumLoadSeconds,10080);assert.equal(plan.filtered,false);
});

test('only diagnostics may select known unique nonempty workloads; mixed still preflights all constituents',()=>{
 const paths=workloadPaths(),plan=performanceRunPlan({diagnostic:{workloads:['orders','hotProducts']}},{diagnostic:true},paths);
 assert.deepEqual(plan.workloads,['orders','hotProducts']);assert.deepEqual(Object.keys(plan.paths),plan.workloads);assert.equal(plan.minimumLoadSeconds,14);assert.equal(plan.filtered,true);
 const mixed=performanceRunPlan({diagnostic:{workloads:['mixed']}},{diagnostic:true},paths);assert.deepEqual(Object.keys(mixed.paths),Object.keys(paths));assert.deepEqual(mixed.workloads,['mixed']);
 for(const workloads of [[],['orders','orders'],['unknown'],'orders',null])assert.throws(()=>performanceRunPlan({diagnostic:{workloads}},{diagnostic:true},paths));
});

test('EXPLAIN replays only whitelisted transaction-local serial and hashjoin-off settings on the same connection',()=>{
 const row=(sql,connectionId=1,values=[])=>({sql,connectionId,values});
 const statements=[row('BEGIN'),row('SET TRANSACTION READ ONLY, ISOLATION LEVEL REPEATABLE READ'),row('SET LOCAL max_parallel_workers_per_gather=0'),row('SELECT 1',2),row('SET LOCAL enable_hashjoin=off'),row('SELECT 2'),row('COMMIT'),row('SELECT 3')];
 assert.deepEqual(capturedPlannerSettings(statements,3),{});assert.deepEqual(capturedPlannerSettings(statements,4),{max_parallel_workers_per_gather:'0'});assert.deepEqual(capturedPlannerSettings(statements,5),{max_parallel_workers_per_gather:'0',enable_hashjoin:'off'});assert.deepEqual(capturedPlannerSettings(statements,7),{});
 const rollback=[row('BEGIN READ ONLY'),row('SET LOCAL enable_hashjoin = OFF;'),row('SELECT 1'),row('ROLLBACK'),row('SELECT 2')];
 assert.deepEqual(capturedPlannerSettings(rollback,2),{enable_hashjoin:'off'});assert.deepEqual(capturedPlannerSettings(rollback,4),{});
 for(const sql of ["SET LOCAL work_mem='1GB'",'SET max_parallel_workers_per_gather=0','SET LOCAL max_parallel_workers_per_gather=1','SET LOCAL max_parallel_workers_per_gather=0; SELECT 1','SET enable_hashjoin=off','SET LOCAL enable_hashjoin=on','SET LOCAL enable_hashjoin=false','SET LOCAL enable_hashjoin=off; SELECT 1'])assert.throws(()=>capturedPlannerSettings([row('BEGIN'),row(sql),row('SELECT 1')],2),/UNSUPPORTED_CAPTURED_PLANNER_SETTING/);
 for(const sql of ['SET LOCAL max_parallel_workers_per_gather=0','SET LOCAL enable_hashjoin=off']){
  assert.throws(()=>capturedPlannerSettings([row(sql),row('SELECT 1')],1),/CAPTURED_PLANNER_SETTING_OUTSIDE_TRANSACTION/);
  assert.throws(()=>capturedPlannerSettings([row('BEGIN'),row(sql,1,['off']),row('SELECT 1')],2),/UNSUPPORTED_CAPTURED_PLANNER_SETTING/);
 }
});

test('settled command history is never reopened while new sessions preserve ordering and exclusive replies',async()=>{
 const helper=new URL('../../apps/api/test/fixtures/module15-performance-control.mjs',import.meta.url);
 const source=String.raw`
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {basename,join} from 'node:path';
const [helperUrl,runId,oldSession,newSession]=process.argv.slice(1);
const folder=join(process.cwd(),'memory-only-module15-control'),files=new Map(),reads=[],writes=[];
let scans=0,settledReads=0;
const failure=code=>Object.assign(new Error(code),{code});
const shimUrl='module15-control-memory:fs',shimKey=Symbol.for(shimUrl);
globalThis[shimKey]={
 async readdir(directory){assert.equal(directory,folder);scans++;return [...files.keys()].map(file=>basename(file));},
 async readFile(file,encoding){
  assert.equal(encoding,'utf8');reads.push(file);
  if(basename(file).startsWith('command-v2-')&&files.has(join(folder,basename(file).replace(/^command-v2-/,'response-v2-')))){settledReads++;throw failure('EACCES');}
  if(!files.has(file))throw failure('ENOENT');return files.get(file);
 },
 async writeFile(file,text,options){assert.equal(options.flag,'wx');if(files.has(file))throw failure('EEXIST');files.set(file,text);writes.push(file);},
};
const hooks=registerHooks({
 resolve(specifier,context,next){return specifier==='node:fs/promises'&&context.parentURL===helperUrl?{url:shimUrl,shortCircuit:true}:next(specifier,context);},
 load(url,context,next){return url===shimUrl?{format:'module',shortCircuit:true,source:'export const {readFile,writeFile,readdir}=globalThis[Symbol.for("module15-control-memory:fs")];'}:next(url,context);},
});
try{
 const {controlFileName,createControlInbox,writeControlCommand}=await import(helperUrl);
 const command=(sequence,action,sessionId)=>({protocol:2,runId,sessionId,sequence,action,capture:false});
 const file=(kind,value)=>join(folder,controlFileName(kind,value));
 const oldStart=command(1,'start',oldSession),oldStop=command(2,'stop',oldSession);
 for(const value of [oldStart,oldStop])files.set(file('command',value),JSON.stringify(value)+'\n');
 files.set(file('response',oldStart),JSON.stringify({...oldStart,action:'started'})+'\n');
 files.set(file('response',oldStop),'{"protocol":2');
 const history=new Map(files),inbox=createControlInbox(folder,runId);
 assert.equal(await inbox.next(),null,'complete and partial existing responses both prevent replay without opening commands');
 const start=command(1,'start',newSession),stop=command(2,'stop',newSession),predecessor=file('response',start);
 await writeControlCommand(folder,stop);
 assert.equal(await inbox.next(),null,'stop waits for its own session acknowledgement');
 assert.ok(reads.includes(predecessor),'a pending stop checks its preceding response');
 await writeControlCommand(folder,start);
 const originalCommand=files.get(file('command',start));
 await assert.rejects(writeControlCommand(folder,{...start,action:'stop'}),{code:'EEXIST'});
 assert.equal(files.get(file('command',start)),originalCommand);
 assert.deepEqual(await inbox.next(),start,'a later scan discovers a new session starting at sequence one');
 const beforeActive=[scans,reads.length,writes.length];
 assert.equal(await inbox.next(),null,'an active command cannot be consumed twice');
 assert.deepEqual([scans,reads.length,writes.length],beforeActive);
 const racing=createControlInbox(folder,runId);
 assert.deepEqual(await racing.next(),start);
 await inbox.reply(start,{action:'started'});
 const originalResponse=files.get(predecessor);
 await assert.rejects(racing.reply(start,{action:'error'}),{code:'EEXIST'});
 assert.equal(files.get(predecessor),originalResponse,'a competing acknowledgement cannot overwrite the exclusive response');
 const predecessorReads=reads.filter(value=>value===predecessor).length;
 assert.deepEqual(await inbox.next(),stop);
 assert.equal(reads.filter(value=>value===predecessor).length,predecessorReads+1,'stop validates the preceding response before consumption');
 await inbox.reply(stop,{action:'stopped'});
 const completed=new Map(files);
 assert.equal(await inbox.next(),null);
 assert.equal(await createControlInbox(folder,runId).next(),null,'restart does not replay completed or partially acknowledged commands');
 assert.equal(settledReads,0,'no acknowledged command is read, including after restart');
 for(const [name,text]of history)assert.equal(files.get(name),text,'original history remains byte-for-byte intact');
 assert.deepEqual([...files], [...completed],'settled scans preserve all command and response contents');
 process.stdout.write('memory-control-history-passed\n');
}finally{hooks.deregister();}
`;
 const child=spawn(process.execPath,['--input-type=module','-e',source,helper.href,runId,sessionId,otherSession],{windowsHide:true,timeout:10000,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.setEncoding('utf8').on('data',chunk=>{stdout+=chunk;});child.stderr.setEncoding('utf8').on('data',chunk=>{stderr+=chunk;});
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 assert.equal(code,0,stderr||stdout);assert.equal(stdout,'memory-control-history-passed\n');
});
