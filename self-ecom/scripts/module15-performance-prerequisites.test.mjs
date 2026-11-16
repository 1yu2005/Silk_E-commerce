// 作用：以独立本地证据验证跨报告绑定和篡改拒绝；不运行Docker/DB、不删除临时文件。
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {buildPerformancePrerequisites,verifyPerformancePrerequisites} from './module15-performance-prerequisites.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex'),head='a'.repeat(40),id=n=>'sha256:'+String(n).repeat(64);
const start='2026-11-15T00:01:00.000Z',end='2026-11-15T00:02:00.000Z',commands=[{exitCode:0}],prefix='self-ecom-m415-e2e-1234abcd';
async function fixture(){
 const root=await mkdtemp(path.join(tmpdir(),'m415-prerequisite-proof-'));
 const write=async(file,value)=>{const target=path.resolve(root,file);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');return target;};
 const load=async file=>JSON.parse(await readFile(path.resolve(root,file),'utf8'));
 const signature=async file=>({privatePath:path.resolve(root,file),sha256:digest(await readFile(path.resolve(root,file)))});
 const sourceFiles=new Map();for(const file of ['apps/api/src/app.ts','apps/api/test/module15-concurrency.integration.ts','apps/api/test/module15-scheduler.integration.ts','apps/api/test/example.integration.ts']){await write(file,'export const synthetic = 1;\n');sourceFiles.set(file,digest(await readFile(path.join(root,file))));}
 const migrationFiles=[];for(let n=1;n<=17;n++){const name=String(n).padStart(4,'0')+'_synthetic',file='apps/api/prisma/migrations/'+name+'/migration.sql';await write(file,'-- synthetic migration '+n+'\n');const sha256=digest(await readFile(path.join(root,file)));sourceFiles.set(file,sha256);migrationFiles.push({name,sha256});}
 const sourceState={head,digest:digest(JSON.stringify([...sourceFiles])),files:sourceFiles,changed:new Set(sourceFiles.keys())},expected={gitSha:head,imageId:id(1),sourceDigest:sourceState.digest};
 const rowSources=[...sourceFiles].map(([file,sha256])=>({file,sha256}));
 async function record(name,command,suites=[]){const log=suites.map(file=>'✓ test/'+file+' (1 test) 100ms\nTest Files 1 passed (1)\nTests 1 passed (1)\n'+JSON.stringify({suite:'test/'+file,ownedDatabaseRemoved:true})).join('\n')+'\n',logPath=await write('records/'+name+'/output.redacted.txt',log);return write('records/'+name+'/result.json',{label:name,status:'PASSED',cwd:command.includes('scripts/integration.ts')?path.join(root,'apps/api'):root,startedAt:'2026-11-15T00:00:00.000Z',endedAt:'2026-11-15T00:03:00.000Z',command,exitCode:0,signal:null,revision:{head,sourceFiles:rowSources},publicSha256:digest(await readFile(logPath))});}
 const images={api:id(1),'admin-web':id(2),'store-web':id(3)},acceptedImages=Object.entries(images).map(([service,imageId])=>({name:prefix+'-'+{api:'api','admin-web':'admin','store-web':'store'}[service]+':local',id:imageId}));
 const privateFiles=[];for(let n=1;n<=3;n++){const bytes='private-material-'+n;privateFiles.push({fileId:'file-'+n,orderId:'order-'+n,afterSaleId:'sale-'+n,size:Buffer.byteLength(bytes),sha256:digest(bytes)});await write('backup/uploads/objects/'+n+'.png',bytes);}
 const suites=[];for(const name of ['orders','after-sales','settlement','coordination','reporting']){const bytes='screenshot-'+name,folder='screenshots/'+name;await write(folder+'/screen.png',bytes);suites.push({name,status:'passed',project:'self-ecom-m415-'+name+'-1234abcd',privateBrowserEvidence:folder,browserArtifacts:[{name:'screen.png',size:Buffer.byteLength(bytes),sha256:digest(bytes)}],coldStart:{startedAt:start,endedAt:end},databaseOutage:{status:503},databaseRecovery:{status:200}});}
 const candidate={orderId:'recovery-order',skuId:'recovery-sku',quantity:1,paymentDeadline:start};
 const e2e={schemaVersion:1,status:'passed',operation:'e2e',head,imagePrefix:prefix,acceptedImages,originalResourcesPreserved:true,commands,startedAt:start,endedAt:end,suites,pageErrors:[],requests:[{status:200}],fixture:{completedRefundedOrderId:'original-refunded',completedAfterSaleId:'original-sale',recoveryPrivateFiles:privateFiles,recoveryCandidate:candidate}};
 const e2ePath=await write('e2e/result.json',e2e),buildPath=await write('build/result.json',{...e2e,operation:'build-only',suites:[]});
 const applicationRecord=async(name,output)=>record(name,['node','infra/verify-module15-compose.mjs',output]);
 const database={canonicalVersion:2,schemaSha256:'c'.repeat(64),tables:[{schema:'public',name:'order',count:'1',columns:[],sha256:'d'.repeat(64)}],migrations:migrationFiles.map(row=>({migration_name:row.name,checksum:row.sha256,finished_at:start,rolled_back_at:null,applied_steps_count:1}))};
 const uploads={files:privateFiles.map((file,n)=>({path:'objects/'+(n+1)+'.png',size:String(file.size),sha256:file.sha256})),directories:[]};
 const dump='synthetic-database-dump';await write('backup/database.dump',dump);
 const payloads=[{path:'database.dump',size:String(Buffer.byteLength(dump)),sha256:digest(dump)},...uploads.files.map(row=>({...row,path:'uploads/'+row.path}))];
 await write('backup/checksums.sha256',payloads.map(row=>row.sha256+'  '+row.path).join('\n')+'\n');
 const manifest={schemaVersion:1,status:'COMPLETE',startedAt:start,finishedAt:end,backupId:'backup-test',gitSha:head,project:suites[4].project,originalStatesRestored:true,commands,images:{...images,db:id(4)},database,imageMigrations:migrationFiles,uploads,payloads};await write('backup/manifest.json',manifest);
 const reconcile={status:'passed',readOnly:true,checks:[{passed:true,violationCount:'0'}],scope:{backupId:manifest.backupId}};
 const checked={allColumnsAndTechnicalRowsCompared:true,allTables:1,fileCount:3,databaseSha256:digest(JSON.stringify(database)),schemaSha256:database.schemaSha256,reconcile};
 const restoreProject='self-ecom-m415-restore-abcdef12',base={project:restoreProject,commands,startedAt:start,finishedAt:end,static:checked};
 const containers=Object.fromEntries(Object.entries(manifest.images).map(([service,image],index)=>[service,{id:String(index+1).repeat(64),image}]));
 const restorePath=await write('restore/restore.json',{...base,status:'RESTORED_STATIC',backupId:manifest.backupId,backup:path.join(root,'backup'),containers});
 const staticPath=await write('restore/static.json',{...base,status:'VERIFIED_STATIC'});
 const recoveryChecks=[{name:'payment-timeout',id:candidate.orderId,passed:true}];
 const dynamicPath=await write('restore/dynamic.json',{...base,status:'VERIFIED_DYNAMIC',dynamicReconcile:reconcile,recoveryChecks,pendingRecovery:{payments:[{id:candidate.orderId,unknown_damage:false}]},schedulerRuns:['order-payment-timeout','order-handover-recovery','order-auto-receipt','task-overdue-scan'].map(job_name=>({job_name,status:'SUCCEEDED'}))});
 const requests=['admin','warehouse','customer'].map(role=>({role,method:'POST',path:role==='customer'?'/store/auth/login':'/admin/auth/login',status:200,requestId:'formal-'+role}));
 const business={status:'PASSED',sourceProject:suites[4].project,accountLedgerBoundToFixture:true,httpOriginalBusinessReadable:true,browserOriginalBusinessReadable:true,pageErrors:[],formalNewLoginRoles:['admin','warehouse','customer'],originalCompletedThenRefundedOrder:{orderId:'original-refunded',status:'REFUNDED',receiptCompletedAt:start,paymentHistoryCount:1,successfulRefundAttemptCount:1},requests,files:privateFiles.map(file=>({...file,bytes:file.size,originalMaterialReferenceKept:true,customerStatus:200,anonymousStatus:404,warehouseStatus:404})),screenshots:[]};
 for(let n=0;n<4;n++){const bytes='restored-browser-'+n,file=await write('restored/screenshots/'+n+'.png',bytes);business.screenshots.push({privatePath:file,size:Buffer.byteLength(bytes),sha256:digest(bytes)});}
 const businessPath=await write('restored/business-readable.json',business);
 const close={action_type:'CLOSE',ledger_id:'close-ledger',sku_id:candidate.skuId,delta_a:1,delta_r:-1,before_a:9,after_a:10,before_r:1,after_r:0};
 const after={orderId:candidate.orderId,status:'CLOSED',closeReasonCode:'PAYMENT_TIMEOUT',paymentCount:'0',closeActionCount:'1',ledgers:[close],balance:{available:10,reserved:0}};
 const nativeEvidence={backupManifest:{...await signature('backup/manifest.json'),backupId:manifest.backupId},restore:await signature(restorePath),staticVerification:await signature(staticPath),dynamicVerification:await signature(dynamicPath),businessReadability:{path:businessPath,sha256:digest(await readFile(businessPath))}};
 const common={schemaVersion:1,status:'PASSED',startedAt:start,finishedAt:end,commands,sourceProject:suites[4].project,restoreProject,sourceReport:e2ePath,sourceReportSha256:digest(await readFile(e2ePath)),sourceFrozenImages:images,nativeEvidence,sourceBusinessAndFilesUnchanged:true,sourceOriginalRunningStatesRestored:true,recoveryCandidateNetReleaseAndReplayVerified:true,targetUploadsWriteAccess:{uid:1000,writable:true,directories:['/app/storage/uploads','/app/storage/uploads/tmp','/app/storage/uploads/objects']},recoveryChecks,recoveryCandidateFirstScan:after,recoveryCandidateSecondScan:after};
 const drill={...common,backup:{status:'COMPLETE',originalStatesRestored:true,backup:path.join(root,'backup'),backupId:manifest.backupId},restore:{status:'RESTORED_STATIC',report:restorePath},staticVerification:{status:'VERIFIED_STATIC',report:staticPath},dynamicVerification:{status:'VERIFIED_DYNAMIC',report:dynamicPath},businessReadability:business,recoveryCandidateBeforeBackup:{orderId:candidate.orderId,status:'WAIT_PAYMENT',paymentCount:'0',closeActionCount:'0'},recoveryCandidateRepeatedScanner:{status:'SUCCEEDED'}};
 const publicOps={...common,staticStatus:'RESTORED_STATIC',staticVerifyStatus:'VERIFIED_STATIC',dynamicStatus:'VERIFIED_DYNAMIC',allTablesCompared:1,filesCompared:3,businessReadabilityEvidence:businessPath,businessReadabilityStatus:'PASSED'};
 const opsPrivate=await write('ops/drill.local.json',drill),opsPublic=await write('ops/result.json',publicOps);
 const inputs={schemaVersion:1,records:{correctness:[await record('correctness',['node','apps/api/node_modules/tsx/dist/cli.mjs','scripts/integration.ts'],['example.integration.ts','module15-concurrency.integration.ts','module15-scheduler.integration.ts'])],permissionConcurrency:[await record('concurrency',['node','scripts/module15-concurrency.mjs'],['module15-concurrency.integration.ts'])],schedulerFailure:[await record('scheduler',['node','scripts/module15-scheduler.mjs'],['module15-scheduler.integration.ts'])]},engineeringImage:{report:buildPath,record:await applicationRecord('build',path.dirname(buildPath))},e2e:{report:e2ePath,record:await applicationRecord('e2e',path.dirname(e2ePath))},ops:{report:opsPublic,privateReport:opsPrivate,record:await record('ops',['node','private-run.mjs',e2ePath])}};
 const options={root,sourceState};return {root,write,load,signature,inputs,expected,options,sourceState,manifest,drill,publicOps,e2e};
}

test('完整真实文件证据生成八项前置并可在正式启动前再次核验',async()=>{
 const f=await fixture(),report=await buildPerformancePrerequisites(f.inputs,f.expected,f.options);
 assert.equal(report.status,'passed');assert.equal(Object.keys(report.checks).length,8);assert.equal(report.coverage.correctnessSuites,3);assert.ok(report.evidence.length>20);
 const file=await f.write('prerequisites.local.json',report);assert.equal((await verifyPerformancePrerequisites(file,f.expected,f.options)).proofSha256,report.proofSha256);
});
test('真实静默reporter按逐套摘要与runner checkpoint绑定，不依赖成功文件行',async()=>{
 const f=await fixture();for(const file of [f.inputs.records.correctness[0],f.inputs.records.permissionConcurrency[0],f.inputs.records.schedulerFailure[0]]){const record=await f.load(file),logFile=path.join(path.dirname(file),'output.redacted.txt'),log=(await readFile(logFile,'utf8')).replace(/^✓.*\n/gm,'');await f.write(logFile,log);record.publicSha256=digest(log);await f.write(file,record);}
 assert.equal((await buildPerformancePrerequisites(f.inputs,f.expected,f.options)).coverage.correctnessSuites,3);
});
test('拒绝手填passed、错HEAD/镜像、失败记录、缺套件及旧相关源码',async()=>{
 for(const mutation of [
  async f=>{const record=await f.load(f.inputs.records.correctness[0]);record.exitCode=1;await f.write(f.inputs.records.correctness[0],record);},
  async f=>{const record=await f.load(f.inputs.records.correctness[0]);record.revision.head='b'.repeat(40);await f.write(f.inputs.records.correctness[0],record);},
  async f=>{const record=await f.load(f.inputs.records.correctness[0]);record.revision.sourceFiles[0].sha256='b'.repeat(64);await f.write(f.inputs.records.correctness[0],record);},
  async f=>{const record=await f.load(f.inputs.records.correctness[0]);record.revision.sourceFiles[0].sha256='b'.repeat(64);f.sourceState.changed.delete(record.revision.sourceFiles[0].file);await f.write(f.inputs.records.correctness[0],record);},
  async f=>{const record=await f.load(f.inputs.records.correctness[0]);record.command=['node','invented-check.mjs'];await f.write(f.inputs.records.correctness[0],record);},
  async f=>{f.inputs.records.correctness=f.inputs.records.permissionConcurrency;},
  async f=>{f.e2e.acceptedImages[0].id=id(9);await f.write(f.inputs.e2e.report,f.e2e);},
  async f=>{f.e2e.suites[4].name='orders';await f.write(f.inputs.e2e.report,f.e2e);},
  async f=>{f.inputs.records.correctness=[];},
 ]){const f=await fixture();await mutation(f);await assert.rejects(buildPerformancePrerequisites(f.inputs,f.expected,f.options));}
 const f=await fixture(),file=await f.write('handfilled.json',{schemaVersion:1,status:'passed',...f.expected,checks:{correctness:'passed'}});await assert.rejects(verifyPerformancePrerequisites(file,f.expected,f.options));
});
test('原始日志、备份载荷和浏览器截图任一字节变更都拒绝通过',async()=>{
 for(const target of ['records/correctness/output.redacted.txt','backup/database.dump','screenshots/reporting/screen.png','restored/screenshots/0.png']){const f=await fixture();await f.write(target,'changed');await assert.rejects(buildPerformancePrerequisites(f.inputs,f.expected,f.options));}
});
test('即使exit0且套件名存在，过滤跳过或测试数量不全也不能满足前置',async()=>{
 const checkpoint=JSON.stringify({suite:'test/module15-concurrency.integration.ts',ownedDatabaseRemoved:true})+'\n';
 for(const log of ['✓ test/module15-concurrency.integration.ts (16 tests | 15 skipped) 100ms\nTest Files 1 passed (1)\nTests 1 passed | 15 skipped (16)\n'+checkpoint,'✓ test/module15-concurrency.integration.ts (16 tests) 100ms\nTest Files 1 passed (1)\nTests 1 passed (1)\n'+checkpoint,'module15-concurrency.integration.ts\nTests 16 passed (16)\n',checkpoint]){
  const f=await fixture(),file=f.inputs.records.permissionConcurrency[0],record=await f.load(file),target=path.join(path.dirname(file),'output.redacted.txt');await f.write(target,log);record.publicSha256=digest(log);await f.write(file,record);await assert.rejects(buildPerformancePrerequisites(f.inputs,f.expected,f.options),{code:/INTEGRATION_(NOT_COMPLETE|PASSED_TEST_COUNT_MISMATCH)/});
 }
});
test('恢复native引用摘要、源E2E、目标权限和原单据/私图必须绑定',async()=>{
 for(const mutation of [
  f=>{f.publicOps.nativeEvidence.restore.sha256='b'.repeat(64);},
  f=>{f.drill.sourceReportSha256='b'.repeat(64);},
  f=>{f.drill.targetUploadsWriteAccess.uid=0;},
  f=>{f.publicOps.targetUploadsWriteAccess.directories[2]='/app/storage/uploads/tmp';},
  f=>{f.drill.businessReadability.files[0].sha256='b'.repeat(64);},
  f=>{f.drill.recoveryCandidateSecondScan={...f.drill.recoveryCandidateSecondScan,closeActionCount:'2'};},
  f=>{f.publicOps.sourceFrozenImages.api=id(9);},
 ]){const f=await fixture();mutation(f);await f.write(f.inputs.ops.privateReport,f.drill);await f.write(f.inputs.ops.report,f.publicOps);await assert.rejects(buildPerformancePrerequisites(f.inputs,f.expected,f.options));}
});
test('原生恢复报告即使重算摘要，错误容器镜像或超出演练窗口仍拒绝',async()=>{
 for(const mutation of [report=>{report.containers.api.image=id(9);},report=>{report.startedAt='2026-11-14T00:00:00.000Z';}]){const f=await fixture(),file=f.drill.restore.report,report=await f.load(file);mutation(report);await f.write(file,report);f.drill.nativeEvidence.restore=await f.signature(file);await f.write(f.inputs.ops.privateReport,f.drill);await f.write(f.inputs.ops.report,f.publicOps);await assert.rejects(buildPerformancePrerequisites(f.inputs,f.expected,f.options),{code:/RESTORE_CONTAINER_IMAGE_BINDING_MISMATCH|OPS_NATIVE_OUTSIDE_DRILL_WINDOW/});}
});
test('汇总后证据或八项结果被改写，重新核验仍会失败',async()=>{
 const f=await fixture(),report=await buildPerformancePrerequisites(f.inputs,f.expected,f.options),file=await f.write('gate.json',report);
 report.checks.e2e='failed';await f.write(file,report);await assert.rejects(verifyPerformancePrerequisites(file,f.expected,f.options));
 report.checks.e2e='passed';await f.write(file,report);await f.write('restored/screenshots/1.png','changed-after-freeze');await assert.rejects(verifyPerformancePrerequisites(file,f.expected,f.options));
});
test('完整备份迁移必须逐项匹配冻结文件与镜像链，不能只满足历史固定条数',async()=>{
 for(const mutation of [
  async f=>{await f.write('apps/api/prisma/migrations/0001_synthetic/migration.sql','-- changed applied migration\n');},
  async f=>{f.manifest.imageMigrations.pop();},
  async f=>{f.manifest.imageMigrations[0].sha256='b'.repeat(64);},
  async f=>{f.manifest.database.migrations[0].checksum='b'.repeat(64);},
 ]){const f=await fixture();await mutation(f);await f.write('backup/manifest.json',f.manifest);f.drill.nativeEvidence.backupManifest={...await f.signature('backup/manifest.json'),backupId:f.manifest.backupId};await f.write(f.inputs.ops.privateReport,f.drill);await f.write(f.inputs.ops.report,f.publicOps);await assert.rejects(buildPerformancePrerequisites(f.inputs,f.expected,f.options),{code:/MIGRATION_(FILE_CHAIN_LENGTH_MISMATCH|FILE_CHAIN_MISMATCH|CHAIN_ENTRY_MISMATCH)/});}
});
