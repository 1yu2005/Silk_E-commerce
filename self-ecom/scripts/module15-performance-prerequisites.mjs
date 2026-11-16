// 作用：只读核验真实工程/集成/E2E/恢复证据，并为正式性能生成可重新验证的前置清单。
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify,stripVTControlCharacters} from 'node:util';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,writeFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertMigrationChain,assertMigrationFiles,readMigrationChain} from './module15-migration-chain.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),execute=promisify(execFile);
const hash=value=>createHash('sha256').update(value).digest('hex'),hex=/^[a-f0-9]{64}$/,image=/^sha256:[a-f0-9]{64}$/;
const names=['correctness','permissionConcurrency','schedulerFailure','e2e','engineeringImage','coldStart','backupRestoreStatic','backupRestoreDynamic'];
const applications=['api','admin-web','store-web'],suffix={api:'api','admin-web':'admin','store-web':'store'};
const normalize=value=>value.replaceAll('\\','/');
function requireProof(value,code){if(!value){const error=new Error(code);error.code=code;throw error;}}
function same(actual,expected,code){requireProof(JSON.stringify(actual)===JSON.stringify(expected),code);}
function dates(report,end='endedAt'){requireProof(Number.isFinite(Date.parse(report.startedAt))&&Date.parse(report[end])>=Date.parse(report.startedAt),'EVIDENCE_TIME_INVALID');}
function withinDrill(report,drill){dates(report,'finishedAt');requireProof(Date.parse(report.startedAt)>=Date.parse(drill.startedAt)&&Date.parse(report.finishedAt)<=Date.parse(drill.finishedAt),'OPS_NATIVE_OUTSIDE_DRILL_WINDOW');}
function successfulCommands(report){requireProof(Array.isArray(report.commands)&&report.commands.length>0&&report.commands.every(command=>command.exitCode===0),'EVIDENCE_COMMAND_FAILED_OR_EMPTY');}
function reconcile(report){requireProof(report?.status==='passed'&&report.readOnly===true&&report.checks?.length>0&&report.checks.every(check=>check.passed===true&&check.violationCount==='0'),'RECONCILE_NOT_ZERO');}

export async function readPerformanceSourceState(root=ROOT){
 const git=async args=>(await execute('git',args,{cwd:root,windowsHide:true,maxBuffer:32*1024*1024})).stdout;
 const include=file=>/^(apps|packages|scripts|infra)\//.test(file)||/^(package\.json|pnpm-lock\.yaml)$/.test(file);
 const listed=(await git(['ls-files','--cached','--others','--exclude-standard','-z','--','.'])).split('\0').filter(include).sort(),files=new Map();
 for(const file of listed)files.set(file,hash(await readFile(path.join(root,file))));
 const changed=new Set([...(await git(['diff','HEAD','--relative','--name-only','-z','--','.'])).split('\0'),...(await git(['ls-files','--others','--exclude-standard','-z','--','.'])).split('\0')].filter(include));
 return {head:(await git(['rev-parse','HEAD'])).trim(),digest:hash(JSON.stringify([...files])),files,changed};
}

// Private output contains paths and hashes only. Every referenced payload remains in its existing location.
export async function buildPerformancePrerequisites(inputs,expected,{root=ROOT,sourceState}={}){
 requireProof(inputs?.schemaVersion===1,'PREREQUISITE_INPUT_SCHEMA');
 requireProof(/^[a-f0-9]{40}$/.test(expected?.gitSha??'')&&image.test(expected?.imageId??'')&&hex.test(expected?.sourceDigest??''),'FINAL_FREEZE_REQUIRED');
 const current=sourceState??await readPerformanceSourceState(root);requireProof(current.head===expected.gitSha&&current.digest===expected.sourceDigest,'CURRENT_SOURCE_NOT_FROZEN');
 const evidence=new Map();
 async function safeFile(file){
  requireProof(typeof file==='string'&&file.length>0,'EVIDENCE_PATH_REQUIRED');const absolute=path.resolve(root,file),relative=path.relative(root,absolute);
  requireProof(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'EVIDENCE_OUTSIDE_WORKSPACE');
  let cursor=root;for(const part of relative.split(path.sep)){cursor=path.join(cursor,part);requireProof(!(await lstat(cursor)).isSymbolicLink(),'EVIDENCE_LINK_REFUSED');}
  const stat=await lstat(absolute);requireProof(stat.isFile(),'EVIDENCE_NOT_FILE');return {absolute,stat};
 }
 async function payload(file,{sha256,size}={}){
  const {absolute,stat}=await safeFile(file),digest=createHash('sha256');for await(const chunk of createReadStream(absolute))digest.update(chunk);const actual=digest.digest('hex');
  requireProof((sha256===undefined||sha256===actual)&&(size===undefined||String(size)===String(stat.size)),'EVIDENCE_PAYLOAD_HASH_MISMATCH');
  evidence.set(absolute,{path:absolute,sha256:actual,size:String(stat.size)});return absolute;
 }
 async function signed(file,claim){requireProof(hex.test(claim?.sha256??''),'EVIDENCE_HASH_REQUIRED');if(Object.hasOwn(claim,'size'))requireProof(/^\d+$/.test(String(claim.size)),'EVIDENCE_SIZE_REQUIRED');return payload(file,claim);}
 async function json(file){const absolute=await payload(file);return {file:absolute,value:JSON.parse(await readFile(absolute,'utf8'))};}
 const product=file=>/^(apps\/api\/(src|prisma|scripts)|packages\/shared\/src)\//.test(file)||/^apps\/api\/(package\.json|prisma\.config\.ts|test\/verification\/)/.test(file);
 const applicationSource=file=>/^apps\/[^/]+\/(?!test\/)/.test(file)||/^packages\/[^/]+\/(?!test\/)/.test(file)||/^(package\.json|pnpm-lock\.yaml|infra\/(api\.Dockerfile|web\.Dockerfile|compose\.yaml|nginx\.conf))$/.test(file);
 async function dependencies(entries){
  const found=new Set(),queue=[...entries];while(queue.length){const file=queue.pop();if(found.has(file)||!current.files.has(file))continue;found.add(file);
   const body=await readFile(path.join(root,file),'utf8');for(const match of body.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.[^'"]+)['"]/g)){
    const base=normalize(path.posix.normalize(path.posix.join(path.posix.dirname(file),match[1]))),choices=[base.replace(/\.js$/,'.ts'),base,base+'.ts',base+'/index.ts'];const target=choices.find(choice=>current.files.has(choice));if(target)queue.push(target);
   }
  }return found;
 }
 async function recorded(file,scope){
  const loaded=await json(file),report=loaded.value;requireProof(report.status==='PASSED'&&report.exitCode===0&&report.signal==null,'RECORDED_COMMAND_NOT_PASSED');dates(report);
  requireProof(report.revision?.head===expected.gitSha&&Array.isArray(report.command)&&report.command.length>=2&&!['-e','--eval'].includes(report.command[1]),'RECORDED_COMMAND_REVISION_OR_ENTRY');
  const logFile=path.join(path.dirname(loaded.file),'output.redacted.txt');await signed(logFile,{sha256:report.publicSha256});
  const log=stripVTControlCharacters(await readFile(logFile,'utf8'));
  const covered=new Set();
  if(scope==='api'){
   requireProof((normalize(report.command[1]).endsWith('/tsx/dist/cli.mjs')&&report.command[2]==='scripts/integration.ts'&&path.resolve(report.cwd??'')===path.join(root,'apps/api'))||(['scripts/module15-concurrency.mjs','scripts/module15-scheduler.mjs'].includes(report.command[1])&&path.resolve(report.cwd??'')===root),'INTEGRATION_RECORDED_ENTRY_MISMATCH');
   let previousEnd=0;const checkpoints=[...log.matchAll(/^\s*\{"suite":"test\/([A-Za-z0-9_-]+\.integration\.ts)","ownedDatabaseRemoved":true\}\s*$/gm)];
   requireProof(checkpoints.length>0&&!/^\s*(?:Tests|Test Files)\s+.*\b(?:skipped|failed|todo)\b/m.test(log),'INTEGRATION_NOT_COMPLETE');
   for(const checkpoint of checkpoints){const block=log.slice(previousEnd,checkpoint.index),summaries=[...block.matchAll(/^\s*Tests\s+(\d+) passed\s+\((\d+)\)\s*$/gm)],files=[...block.matchAll(/^\s*Test Files\s+1 passed\s+\(1\)\s*$/gm)],verbose=[...block.matchAll(/(?:✓|✔)\s+(?:test\/)?([A-Za-z0-9_-]+\.integration\.ts)\s+\((\d+) tests?\)(?:\s|$)/g)];
    requireProof(files.length===1&&summaries.length===1&&!covered.has('apps/api/test/'+checkpoint[1]),'INTEGRATION_NOT_COMPLETE');
    requireProof(summaries[0][1]===summaries[0][2]&&Number(summaries[0][1])>0&&(!verbose.length||(verbose.length===1&&verbose[0][1]===checkpoint[1]&&verbose[0][2]===summaries[0][1])),'INTEGRATION_PASSED_TEST_COUNT_MISMATCH');
    covered.add('apps/api/test/'+checkpoint[1]);previousEnd=checkpoint.index+checkpoint[0].length;
   }
   requireProof(!/^\s*(?:Tests|Test Files)\s+/m.test(log.slice(previousEnd)),'INTEGRATION_NOT_COMPLETE');
  }
  const dependencyFiles=await dependencies(covered),recordedFiles=new Map(report.revision.sourceFiles?.map(row=>[row.file,row.sha256])??[]);
  for(const changed of new Set([...current.changed,...recordedFiles.keys()]))if((scope==='application'?applicationSource(changed):product(changed)||dependencyFiles.has(changed))){requireProof(recordedFiles.get(changed)===current.files.get(changed),'RECORDED_RELEVANT_SOURCE_CHANGED');}
  return {report,covered,log};
 }

 const excluded=new Set(['reporting-performance.integration.ts','module15-performance.integration.ts','module15-browser.integration.ts']);
 const allSuites=[...current.files.keys()].filter(file=>/^apps\/api\/test\/[^/]+\.integration\.ts$/.test(file)&&!excluded.has(path.basename(file)));
 requireProof(allSuites.length>0,'CORRECTNESS_SUITE_CATALOG_EMPTY');
 for(const [name,required]of [['correctness',allSuites],['permissionConcurrency',['apps/api/test/module15-concurrency.integration.ts']],['schedulerFailure',['apps/api/test/module15-scheduler.integration.ts']]]){
  requireProof(Array.isArray(inputs.records?.[name])&&inputs.records[name].length>0,'INTEGRATION_RECORDS_REQUIRED');const covered=new Set();
  for(const file of inputs.records[name])for(const suite of (await recorded(file,'api')).covered)covered.add(suite);
  requireProof(required.every(suite=>covered.has(suite)),'INTEGRATION_COVERAGE_INCOMPLETE');
 }

 async function applicationReport(input,operation){
  requireProof(input?.record&&input.report,'APPLICATION_REPORT_AND_RECORD_REQUIRED');const record=await recorded(input.record,'application'),loaded=await json(input.report),report=loaded.value;
  requireProof(report.status==='passed'&&report.operation===operation&&report.head===expected.gitSha&&report.originalResourcesPreserved===true,'APPLICATION_REPORT_NOT_PASSED');dates(report);successfulCommands(report);
  requireProof(Date.parse(report.startedAt)>=Date.parse(record.report.startedAt)&&Date.parse(report.endedAt)<=Date.parse(record.report.endedAt),'APPLICATION_REPORT_NOT_IN_RECORDED_WINDOW');
  requireProof(record.report.command.some(argument=>argument==='infra/verify-module15-compose.mjs'),'APPLICATION_RECORD_ENTRY_MISMATCH');
  requireProof(record.report.command.some(argument=>path.resolve(root,argument)===path.dirname(loaded.file)),'APPLICATION_RECORD_OUTPUT_MISMATCH');
  requireProof(/^self-ecom-m415-e2e-[a-f0-9]{8}$/.test(report.imagePrefix)&&report.acceptedImages?.length===3,'ACCEPTED_IMAGE_SET_REQUIRED');
  const images=Object.fromEntries(applications.map(service=>{const rows=report.acceptedImages.filter(row=>row.name===report.imagePrefix+'-'+suffix[service]+':local');requireProof(rows.length===1&&image.test(rows[0].id),'ACCEPTED_IMAGE_DIGEST_REQUIRED');return [service,rows[0].id];}));
  requireProof(images.api===expected.imageId,'FINAL_API_IMAGE_MISMATCH');return {...loaded,images};
 }
 const built=await applicationReport(inputs.engineeringImage,'build-only'),e2e=await applicationReport(inputs.e2e,'e2e');same(built.images,e2e.images,'BUILD_E2E_IMAGES_DIFFER');
 requireProof(e2e.value.suites?.length===5&&new Set(e2e.value.suites.map(suite=>suite.name)).size===5&&['orders','after-sales','settlement','coordination','reporting'].every(name=>e2e.value.suites.some(suite=>suite.name===name&&suite.status==='passed')),'FIVE_E2E_SUITES_REQUIRED');
 requireProof(e2e.value.pageErrors?.length===0&&e2e.value.requests?.length>0,'E2E_BROWSER_OR_HTTP_MISSING');
 for(const suite of e2e.value.suites){requireProof(suite.coldStart&&suite.databaseOutage?.status===503&&suite.databaseRecovery?.status===200,'COLD_START_DEPENDENCY_FAULT_MISSING');dates(suite.coldStart);
  requireProof(suite.browserArtifacts?.some(row=>row.name.endsWith('.png')),'E2E_SCREENSHOTS_MISSING');for(const artifact of suite.browserArtifacts)await signed(path.join(suite.privateBrowserEvidence,artifact.name),{sha256:artifact.sha256,size:artifact.size});
 }

 requireProof(inputs.ops?.record&&inputs.ops.report&&inputs.ops.privateReport,'OPS_REPORTS_REQUIRED');const opsRecord=await recorded(inputs.ops.record,'application');
 const publicOps=(await json(inputs.ops.report)).value,drill=(await json(inputs.ops.privateReport)).value;
 requireProof(drill.status==='PASSED'&&publicOps.status==='PASSED'&&path.resolve(root,drill.sourceReport)===e2e.file,'OPS_SOURCE_E2E_MISMATCH');dates(drill,'finishedAt');successfulCommands(drill);
 requireProof(Date.parse(drill.startedAt)>=Date.parse(opsRecord.report.startedAt)&&Date.parse(drill.finishedAt)<=Date.parse(opsRecord.report.endedAt)&&opsRecord.report.command.some(argument=>path.resolve(root,argument)===e2e.file),'OPS_RECORDED_WINDOW_OR_SOURCE_MISMATCH');
 requireProof(publicOps.sourceReport===drill.sourceReport,'PUBLIC_OPS_SOURCE_PATH_MISMATCH');for(const report of [drill,publicOps])await signed(report.sourceReport,{sha256:report.sourceReportSha256});
 same(publicOps.nativeEvidence,drill.nativeEvidence,'OPS_NATIVE_HASH_CLAIMS_MISMATCH');requireProof(drill.nativeEvidence,'OPS_NATIVE_HASH_CLAIMS_REQUIRED');
 for(const [name,file]of [['backupManifest',path.join(drill.backup?.backup??'','manifest.json')],['restore',drill.restore?.report],['staticVerification',drill.staticVerification?.report],['dynamicVerification',drill.dynamicVerification?.report],['businessReadability',publicOps.businessReadabilityEvidence]]){const claim=drill.nativeEvidence[name];requireProof(path.resolve(root,claim?.privatePath??claim?.path??'')===path.resolve(root,file??''),'OPS_NATIVE_REFERENCE_MISMATCH');await signed(file,claim);}
 const reporting=e2e.value.suites.find(suite=>suite.name==='reporting');requireProof(drill.sourceProject===reporting.project&&drill.restoreProject!==drill.sourceProject,'OPS_PROJECT_BINDING_INVALID');
 for(const report of [drill,publicOps]){same(Object.fromEntries(applications.map(service=>[service,report.sourceFrozenImages?.[service]])),e2e.images,'OPS_FINAL_IMAGES_MISMATCH');requireProof(report.sourceBusinessAndFilesUnchanged===true&&report.sourceOriginalRunningStatesRestored===true&&report.recoveryCandidateNetReleaseAndReplayVerified===true,'OPS_SOURCE_OR_RECOVERY_NOT_PROTECTED');const access=report.targetUploadsWriteAccess;requireProof(Number.isInteger(access?.uid)&&access.uid>0&&access.writable===true&&access.directories?.length===3&&['/app/storage/uploads','/app/storage/uploads/tmp','/app/storage/uploads/objects'].every(directory=>access.directories.includes(directory)),'OPS_NONROOT_UPLOAD_ACCESS_MISSING');}
 requireProof(drill.backup?.status==='COMPLETE'&&drill.backup.originalStatesRestored===true,'BACKUP_NOT_COMPLETE');
 const manifest=(await json(path.join(drill.backup.backup,'manifest.json'))).value;requireProof(manifest.status==='COMPLETE'&&manifest.originalStatesRestored===true&&manifest.gitSha===expected.gitSha&&manifest.project===drill.sourceProject&&manifest.database?.canonicalVersion===2,'BACKUP_MANIFEST_NOT_FINAL');successfulCommands(manifest);withinDrill(manifest,drill);
 same(Object.fromEntries(applications.map(service=>[service,manifest.images?.[service]])),e2e.images,'BACKUP_FINAL_IMAGES_MISMATCH');
 requireProof(manifest.backupId===drill.backup.backupId&&manifest.backupId===drill.nativeEvidence.backupManifest.backupId&&manifest.database.tables?.length>0&&manifest.uploads?.files?.length>0&&manifest.payloads?.some(row=>row.path==='database.dump'),'BACKUP_PAYLOADS_MISSING');
 const migrationChain=await readMigrationChain(root);
 for(const row of migrationChain)await payload(path.join(root,'apps/api/prisma/migrations',row.name,'migration.sql'),{sha256:row.sha256});
 assertMigrationFiles(manifest.imageMigrations,migrationChain);assertMigrationChain(manifest.database.migrations,migrationChain);
 for(const row of manifest.payloads){requireProof(typeof row.path==='string'&&!row.path.includes('\\')&&row.path.split('/').every(part=>part&&part!=='.'&&part!=='..'),'BACKUP_PAYLOAD_PATH_UNSAFE');await signed(path.join(drill.backup.backup,row.path),{sha256:row.sha256,size:row.size});}
 const checksums=await payload(path.join(drill.backup.backup,'checksums.sha256'));same(await readFile(checksums,'utf8'),manifest.payloads.map(row=>row.sha256+'  '+row.path).join('\n')+'\n','BACKUP_CHECKSUM_LIST_MISMATCH');
 for(const file of manifest.uploads.files){const row=manifest.payloads.find(row=>row.path==='uploads/'+file.path);requireProof(row&&row.sha256===file.sha256&&String(row.size)===String(file.size),'BACKUP_UPLOAD_MANIFEST_MISMATCH');}

 const native={};for(const [name,status]of [['restore','RESTORED_STATIC'],['staticVerification','VERIFIED_STATIC'],['dynamicVerification','VERIFIED_DYNAMIC']]){
  requireProof(drill[name]?.status===status,'OPS_NATIVE_STATUS_MISSING');const report=(await json(drill[name].report)).value;native[name]=report;requireProof(report.status===status&&report.project===drill.restoreProject,'OPS_NATIVE_PROJECT_OR_STATUS');successfulCommands(report);withinDrill(report,drill);
  const checked=report.static;requireProof(checked?.allColumnsAndTechnicalRowsCompared===true&&checked.allTables===manifest.database.tables.length&&checked.fileCount===manifest.uploads.files.length&&checked.databaseSha256===hash(JSON.stringify(manifest.database))&&checked.schemaSha256===manifest.database.schemaSha256,'RESTORE_FULL_STATIC_SNAPSHOT_MISMATCH');reconcile(checked.reconcile);requireProof(checked.reconcile.scope.backupId===manifest.backupId,'RESTORE_BACKUP_ID_MISMATCH');
 }
 requireProof(native.restore.backupId===manifest.backupId&&path.resolve(root,native.restore.backup)===path.resolve(root,drill.backup.backup),'RESTORE_PACKAGE_BINDING_MISMATCH');
 for(const service of ['db',...applications])requireProof(hex.test(native.restore.containers?.[service]?.id??'')&&native.restore.containers[service].image===manifest.images[service],'RESTORE_CONTAINER_IMAGE_BINDING_MISMATCH');
 const dynamic=native.dynamicVerification;reconcile(dynamic.dynamicReconcile);requireProof(dynamic.dynamicReconcile.scope.backupId===manifest.backupId&&dynamic.recoveryChecks?.length>0&&dynamic.recoveryChecks.every(check=>check.passed===true),'DYNAMIC_RECOVERY_CHECKS_FAILED');
 requireProof(['order-payment-timeout','order-handover-recovery','order-auto-receipt','task-overdue-scan'].every(job=>dynamic.schedulerRuns?.some(run=>run.job_name===job&&(run.status==='SUCCEEDED'||job==='order-payment-timeout'&&['FAILED','PARTIAL_FAILED'].includes(run.status)&&run.unexpected_failures==='0'))),'DYNAMIC_SCHEDULER_RUNS_MISSING');
 const candidate=e2e.value.fixture?.recoveryCandidate;requireProof(candidate?.quantity===1&&dynamic.pendingRecovery?.payments?.some(row=>row.id===candidate.orderId&&!row.unknown_damage),'RECOVERY_CANDIDATE_NOT_PENDING');
 const before=drill.recoveryCandidateBeforeBackup;requireProof(before?.orderId===candidate.orderId&&before.status==='WAIT_PAYMENT'&&before.paymentCount==='0'&&before.closeActionCount==='0','RECOVERY_CANDIDATE_BASELINE_INVALID');
 for(const facts of [drill.recoveryCandidateFirstScan,drill.recoveryCandidateSecondScan]){requireProof(facts?.orderId===candidate.orderId&&facts.status==='CLOSED'&&facts.closeReasonCode==='PAYMENT_TIMEOUT'&&facts.paymentCount==='0'&&facts.closeActionCount==='1','RECOVERY_CANDIDATE_NOT_CLOSED_ONCE');const closes=facts.ledgers.filter(row=>row.action_type==='CLOSE');requireProof(closes.length===1&&closes[0].sku_id===candidate.skuId&&closes[0].delta_a===1&&closes[0].delta_r===-1&&closes[0].after_a===closes[0].before_a+1&&closes[0].after_r===closes[0].before_r-1,'RECOVERY_CANDIDATE_LEDGER_INVALID');}
 const withoutBalance=facts=>{const result={...facts};delete result.balance;return result;};same(withoutBalance(drill.recoveryCandidateFirstScan),withoutBalance(drill.recoveryCandidateSecondScan),'RECOVERY_CANDIDATE_REACCOUNTED');requireProof(drill.recoveryCandidateRepeatedScanner?.status==='SUCCEEDED','REPEATED_REAL_SCANNER_MISSING');
 requireProof(publicOps.staticStatus==='RESTORED_STATIC'&&publicOps.staticVerifyStatus==='VERIFIED_STATIC'&&publicOps.dynamicStatus==='VERIFIED_DYNAMIC'&&publicOps.allTablesCompared===manifest.database.tables.length&&publicOps.filesCompared===manifest.uploads.files.length,'PUBLIC_OPS_NATIVE_RESULT_MISMATCH');
 for(const key of ['sourceProject','restoreProject','sourceFrozenImages','targetUploadsWriteAccess','recoveryChecks','recoveryCandidateFirstScan','recoveryCandidateSecondScan'])same(publicOps[key],drill[key],'PUBLIC_PRIVATE_OPS_MISMATCH');

 const business=(await json(publicOps.businessReadabilityEvidence)).value;same(business,drill.businessReadability,'RESTORED_BUSINESS_REPORT_MISMATCH');requireProof(publicOps.businessReadabilityStatus===business.status,'PUBLIC_BUSINESS_STATUS_MISMATCH');
 requireProof(business.status==='PASSED'&&business.sourceProject===drill.sourceProject&&business.accountLedgerBoundToFixture===true&&business.httpOriginalBusinessReadable===true&&business.browserOriginalBusinessReadable===true&&business.pageErrors?.length===0,'RESTORED_BUSINESS_NOT_READABLE');
 same([...business.formalNewLoginRoles??[]].sort(),['admin','customer','warehouse'],'RESTORED_FORMAL_LOGINS_MISSING');
 const original=business.originalCompletedThenRefundedOrder;requireProof(original?.orderId===e2e.value.fixture.completedRefundedOrderId&&original.status==='REFUNDED'&&original.paymentHistoryCount===1&&original.successfulRefundAttemptCount===1&&Number.isFinite(Date.parse(original.receiptCompletedAt)),'RESTORED_ORIGINAL_HISTORY_MISMATCH');
 const privateFiles=e2e.value.fixture.recoveryPrivateFiles;requireProof(privateFiles?.length===3&&business.files?.length===3,'RESTORED_PRIVATE_FILES_MISSING');
 for(const file of privateFiles){const rows=business.files.filter(row=>row.fileId===file.fileId);requireProof(rows.length===1&&rows[0].orderId===file.orderId&&rows[0].afterSaleId===file.afterSaleId&&rows[0].sha256===file.sha256&&rows[0].bytes===file.size&&rows[0].originalMaterialReferenceKept===true&&rows[0].customerStatus===200&&rows[0].anonymousStatus===404&&rows[0].warehouseStatus===404,'RESTORED_PRIVATE_FILE_BYTES_OR_AUTH_MISMATCH');}
 for(const role of ['admin','warehouse','customer'])requireProof(business.requests?.some(row=>row.role===role&&row.method==='POST'&&row.path===(role==='customer'?'/store/auth/login':'/admin/auth/login')&&row.status===200&&row.requestId),'RESTORED_FORMAL_LOGIN_HTTP_MISSING');
 requireProof(business.screenshots?.length>=4,'RESTORED_BROWSER_SCREENSHOTS_MISSING');for(const screenshot of business.screenshots)await signed(screenshot.privatePath,{sha256:screenshot.sha256,size:screenshot.size});
 const checks=Object.fromEntries(names.map(name=>[name,'passed'])),references=[...evidence.values()].sort((a,b)=>a.path.localeCompare(b.path)),proof={schemaVersion:1,...expected,checks,evidence:references};
 return {...proof,status:'passed',checkedAt:new Date().toISOString(),inputs,proofSha256:hash(JSON.stringify(proof)),coverage:{correctnessSuites:allSuites.length,sourceBinding:'recorded relevant production and integration dependency files; final digest covers all source files',restoredTables:manifest.database.tables.length,restoredFiles:manifest.uploads.files.length}};
}

export async function verifyPerformancePrerequisites(file,freeze,options={}){
 const report=JSON.parse(await readFile(file,'utf8'));requireProof(report.status==='passed'&&report.schemaVersion===1,'PREREQUISITES_NOT_PASSED');
 for(const key of ['gitSha','imageId','sourceDigest'])requireProof(report[key]===freeze[key],'PREREQUISITE_FREEZE_MISMATCH');
 const checked=await buildPerformancePrerequisites(report.inputs,{gitSha:freeze.gitSha,imageId:freeze.imageId,sourceDigest:freeze.sourceDigest},options);
 requireProof(checked.proofSha256===report.proofSha256,'PREREQUISITE_EVIDENCE_CHANGED');same(report.checks,checked.checks,'PREREQUISITE_CHECKS_CHANGED');same(report.evidence,checked.evidence,'PREREQUISITE_REFERENCES_CHANGED');return checked;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),values={},keys=['--input','--output','--git-sha','--image-id','--source-digest'];
 for(let n=0;n<args.length;n+=2){assert.ok(keys.includes(args[n])&&args[n+1]&&!values[args[n]]);values[args[n]]=args[n+1];}assert.ok(keys.every(key=>values[key]));
 const run=async()=>{const output=path.resolve(values['--output']);requireProof(normalize(output).includes('/private-delivery/M4-15/'),'PRIVATE_PREREQUISITE_OUTPUT_REQUIRED');const inputs=JSON.parse(await readFile(values['--input'],'utf8')),report=await buildPerformancePrerequisites(inputs,{gitSha:values['--git-sha'],imageId:values['--image-id'],sourceDigest:values['--source-digest']});await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({status:report.status,output,checks:report.checks,proofSha256:report.proofSha256,coverage:report.coverage}));};
 run().catch(error=>{console.error(JSON.stringify({status:'failed',code:/^[A-Z0-9_]+$/.test(error.code??'')?error.code:'PREREQUISITE_EVIDENCE_REJECTED',message:'未生成性能前置通过清单；现存报告和数据未改动。'}));process.exitCode=1;});
}
