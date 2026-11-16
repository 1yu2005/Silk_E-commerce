// 作用：无需Docker或.env，验证功能部署仍拒绝缺失E2E、源码指纹、错镜像和不完整恢复证据。
import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import { deployModule15, parseDeploymentArguments, validateDeploymentEvidence } from '../../infra/deploy-module15-local.mjs';
import {assertCoveringIndexTransition,assertMigrationChain,assertMigrationFiles,COVERING_INDEX_DEFINITION,COVERING_INDEX_NAME,COVERING_MIGRATION_NAME,COVERING_MIGRATION_SHA256,readMigrationChain} from '../module15-migration-chain.mjs';

const applications = ['api', 'admin-web', 'store-web'];
const image = index => 'sha256:' + String(index).repeat(64);

function evidence() {
  return {
    e2e: {
      status: 'passed', originalResourcesPreserved: true, head: 'a'.repeat(40), sourceDigest: 'd'.repeat(64), imagePrefix: 'self-ecom-m415-e2e-1234abcd',
      suites: ['orders', 'after-sales', 'settlement', 'coordination', 'reporting'].map(name => ({ name, status: 'passed' })),
      acceptedImages: ['api', 'admin', 'store'].map((name, index) => ({ name: 'self-ecom-m415-e2e-1234abcd-' + name + ':local', id: image(index + 1) })),
    },
    restored: {
      status: 'PASSED', staticStatus: 'RESTORED_STATIC', staticVerifyStatus: 'VERIFIED_STATIC', dynamicStatus: 'VERIFIED_DYNAMIC',
      businessReadabilityStatus: 'PASSED', recoveryCandidateNetReleaseAndReplayVerified: true,
      targetUploadsWriteAccess: { uid: 1000, writable: true, directories: ['/app/storage/uploads', '/app/storage/uploads/tmp', '/app/storage/uploads/objects'] },
      sourceBusinessAndFilesUnchanged: true, sourceOriginalRunningStatesRestored: true, allTablesCompared: 77, filesCompared: 4,
      sourceFrozenImages: Object.fromEntries(applications.map((service, index) => [service, image(index + 1)])),
    },
  };
}

test('complete final evidence resolves the three accepted image digests without Docker or root .env', () => {
  assert.deepEqual(validateDeploymentEvidence(evidence()), Object.fromEntries(applications.map((service, index) => [service, image(index + 1)])));
});

test('all five distinct E2E suites, preserved resources and a concrete revision are required', () => {
  for (const change of [
    input => { input.e2e.status = 'failed'; },
    input => { input.e2e.originalResourcesPreserved = false; },
    input => { input.e2e.suites[4] = { name: 'orders', status: 'passed' }; },
    input => { input.e2e.suites[1].status = 'failed'; },
    input => { delete input.e2e.head; },
    input => { delete input.e2e.sourceDigest; },
    input => { input.e2e.sourceDigest = 'short'; },
  ]) { const input = evidence(); change(input); assert.throws(() => validateDeploymentEvidence(input)); }
});

test('restored services must use the exact same final E2E image IDs', () => {
  for (const change of [
    input => { input.e2e.acceptedImages[0].id = 'self-ecom-api:local'; },
    input => { input.e2e.acceptedImages[1].name = 'self-ecom-other-admin:local'; },
    input => { input.restored.sourceFrozenImages['store-web'] = image(9); },
  ]) { const input = evidence(); change(input); assert.throws(() => validateDeploymentEvidence(input)); }
});

test('readiness alone or missing static, dynamic or source protection evidence cannot authorize deployment', () => {
  for (const change of [
    input => { input.restored.status = 'FAILED'; },
    input => { input.restored.staticStatus = 'READY'; },
    input => { delete input.restored.staticVerifyStatus; },
    input => { delete input.restored.dynamicStatus; },
    input => { delete input.restored.businessReadabilityStatus; },
    input => { input.restored.businessReadabilityStatus = 'FAILED'; },
    input => { delete input.restored.recoveryCandidateNetReleaseAndReplayVerified; },
    input => { input.restored.recoveryCandidateNetReleaseAndReplayVerified = false; },
    input => { delete input.restored.targetUploadsWriteAccess; },
    input => { input.restored.targetUploadsWriteAccess.uid = 0; },
    input => { input.restored.targetUploadsWriteAccess.writable = false; },
    input => { input.restored.targetUploadsWriteAccess.directories[2] = '/app/storage/uploads/tmp'; },
    input => { input.restored.sourceBusinessAndFilesUnchanged = false; },
    input => { input.restored.sourceOriginalRunningStatesRestored = false; },
    input => { input.restored.allTablesCompared = 0; },
    input => { input.restored.filesCompared = 0; },
  ]) { const input = evidence(); change(input); assert.throws(() => validateDeploymentEvidence(input)); }
});

test('CLI requires every concrete evidence path and the fixed explicit target, refusing ambiguous flags', async () => {
  const args = ['--e2e-result', 'e2e.json', '--restore-result', 'restore.json', '--output', 'new-output', '--confirm-project', 'self-ecom'];
  assert.equal(parseDeploymentArguments(['--', ...args])['--confirm-project'], 'self-ecom');
  assert.throws(() => parseDeploymentArguments(args.slice(0, -2)), /EXPLICIT_SELF_ECOM_TARGET_REQUIRED/);
  assert.throws(() => parseDeploymentArguments([...args.slice(0, -1), 'other']), /EXPLICIT_SELF_ECOM_TARGET_REQUIRED/);
  assert.throws(() => parseDeploymentArguments([...args, '--output', 'duplicate']), /DEPLOY_ARGUMENT_INVALID/);
  assert.throws(() => parseDeploymentArguments([...args, '--force', 'yes']), /DEPLOY_ARGUMENT_INVALID/);
  await assert.rejects(deployModule15({}), /EXPLICIT_SELF_ECOM_TARGET_REQUIRED/);
});

const digest=value=>createHash('sha256').update(value).digest('hex');
const migrationColumns=['id','checksum','finished_at','migration_name','logs','rolled_back_at','started_at','applied_steps_count'].map(name=>({name,type:'synthetic-column',not_null:false}));
function rawMigrations(chain){return chain.map((row,index)=>JSON.stringify(['00000000-0000-4000-8000-'+String(index+1).padStart(12,'0'),row.sha256,'2026-11-15T00:01:00.000+00:00',row.name,null,null,'2026-11-15T00:00:00.000+00:00',1])).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));}
function rawDigest(rows){const hash=createHash('sha256');for(const row of rows){const bytes=Buffer.from(row);hash.update(String(bytes.length)+':');hash.update(bytes);hash.update('\n');}return hash.digest('hex');}
function refreshMigrations(summary,rows){const table=summary.tables.find(row=>row.name==='_prisma_migrations');table.count=String(rows.length);table.sha256=rawDigest(rows);}
function transitionFixture(chain,beforeCount=17){
 const snapshot=count=>{
  const applied=chain.slice(0,count),raw=rawMigrations(applied),schema={schemas:[{name:'public'}],indexes:[{schema:'public',relation:'payment',name:'payment_pkey',definition:'CREATE UNIQUE INDEX payment_pkey ON public.payment USING btree (id)',valid:true}],constraints:[],triggers:[],functions:[],enums:[],views:[],extensions:[]};
  if(count===18)schema.indexes.push({schema:'public',relation:'payment',name:COVERING_INDEX_NAME,definition:COVERING_INDEX_DEFINITION,valid:true});
  return {raw,summary:{canonicalVersion:2,postgresVersion:'160006',database:{encoding:'UTF8',collate:'C'},schema,schemaSha256:digest(JSON.stringify(schema)),sequences:[],tables:[
   {schema:'public',name:'_prisma_migrations',kind:'r',persistence:'p',columns:structuredClone(migrationColumns),count:String(raw.length),sha256:rawDigest(raw)},
   ...['employee','employee_extra_permission','order','file_asset','scheduler_run','scheduler_failure'].map(name=>({schema:'public',name,kind:'r',persistence:'p',columns:[{name:'id',type:'uuid'}],count:'1',sha256:'a'.repeat(64)})),
  ],migrations:applied.map(row=>({migration_name:row.name,checksum:row.sha256,finished_at:'2026-11-15 00:01:00+00',rolled_back_at:null,applied_steps_count:1}))}};
 };
 const before=snapshot(beforeCount),after=snapshot(18);
 return {before:before.summary,after:after.summary,options:{chain,beforeMigrationRows:before.raw,afterMigrationRows:after.raw}};
}
const sourceMigrationChain=()=>readMigrationChain(fileURLToPath(new URL('../../',import.meta.url)));

test('frozen directory and image require the complete ordered migration chain and every checksum',async()=>{
 const chain=await sourceMigrationChain();assert.equal(chain.at(-1).name,COVERING_MIGRATION_NAME);assert.equal(chain.at(-1).sha256,COVERING_MIGRATION_SHA256);
 assert.doesNotThrow(()=>assertMigrationFiles(structuredClone(chain),chain));
 for(const change of [rows=>rows.pop(),rows=>rows.push({...rows.at(-1)}),rows=>rows.reverse(),rows=>{rows[0].sha256='f'.repeat(64);}]){const rows=structuredClone(chain);change(rows);assert.throws(()=>assertMigrationFiles(rows,chain));}
 const f=transitionFixture(chain);assert.deepEqual(assertMigrationChain(f.before.migrations,chain,{allowCoveringIndexPending:true}).pending,[COVERING_MIGRATION_NAME]);
 assert.throws(()=>assertMigrationChain(f.before.migrations,chain));assert.doesNotThrow(()=>assertMigrationChain(f.after.migrations,chain));
 const earlier=f.before.migrations.slice(0,-1);assert.throws(()=>assertMigrationChain(earlier,chain,{allowCoveringIndexPending:true}));
});

test('17 to 18 permits only the approved index and one successful appended migration, preserving all old columns',async()=>{
 const f=transitionFixture(await sourceMigrationChain()),result=assertCoveringIndexTransition(f.before,f.after,f.options);
 assert.deepEqual(result.appendedMigrations,[COVERING_MIGRATION_NAME]);assert.equal(result.schemaOtherwiseEqual,true);assert.equal(result.allExistingMigrationColumnsEqual,true);
 assert.equal(result.allOtherTablesAllColumnsEqual,true);assert.equal(result.migrationCountBefore,17);assert.equal(result.migrationCountAfter,18);
});

test('already applied 18 migration deployment is strictly idempotent and needs the same approved index',async()=>{
 const f=transitionFixture(await sourceMigrationChain(),18),result=assertCoveringIndexTransition(f.before,f.after,f.options);assert.deepEqual(result.appendedMigrations,[]);assert.equal(result.onlyApprovedIndexAdded,false);
 f.after.schema.indexes.pop();f.after.schemaSha256=digest(JSON.stringify(f.after.schema));assert.throws(()=>assertCoveringIndexTransition(f.before,f.after,f.options),/COVERING_INDEX_PRESENCE_MISMATCH/);
});

test('changed historical checksum, migration log, new-row status or arbitrary migration SQL cannot be accepted',async()=>{
 const chain=await sourceMigrationChain();
 for(const change of [
  f=>{f.after.migrations[0].checksum='e'.repeat(64);},
  f=>{const rows=f.options.afterMigrationRows,values=JSON.parse(rows[0]);values[4]='changed old log';rows[0]=JSON.stringify(values);rows.sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));refreshMigrations(f.after,rows);},
  f=>{f.after.migrations.at(-1).rolled_back_at='2026-11-15 00:02:00+00';},
  f=>{const rows=f.options.afterMigrationRows,at=rows.findIndex(row=>JSON.parse(row)[3]===COVERING_MIGRATION_NAME),values=JSON.parse(rows[at]);values[4]='migration warning';rows[at]=JSON.stringify(values);rows.sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));refreshMigrations(f.after,rows);},
  f=>{f.options.chain.at(-1).sha256='e'.repeat(64);},
 ]){const f=transitionFixture(structuredClone(chain));change(f);assert.throws(()=>assertCoveringIndexTransition(f.before,f.after,f.options));}
});

test('business, accounts, permission, file columns and any additional schema change remain forbidden',async()=>{
 const chain=await sourceMigrationChain();
 for(const change of [
  ...['employee','employee_extra_permission','order','file_asset'].map(name=>f=>{f.after.tables.find(row=>row.name===name).sha256='b'.repeat(64);}),
  f=>{f.after.schema.indexes.push({schema:'public',relation:'payment',name:'extra_index',definition:'CREATE INDEX extra_index ON public.payment USING btree (paid_at)',valid:true});},
  f=>{f.after.schema.indexes.at(-1).definition=COVERING_INDEX_DEFINITION.replace('(paid_at)','(amount_cents)');},
  f=>{f.after.schema.indexes.at(-1).valid=false;},
  f=>{f.after.schema.triggers.push({schema:'public',relation:'order',name:'unexpected',definition:'CREATE TRIGGER unexpected'});},
  f=>{f.after.tables[0].columns[0]={...f.after.tables[0].columns[0],type:'text'};},
 ]){const f=transitionFixture(structuredClone(chain));change(f);f.after.schemaSha256=digest(JSON.stringify(f.after.schema));assert.throws(()=>assertCoveringIndexTransition(f.before,f.after,f.options));}
});

test('scheduler allowance changes only the two known technical tables count/hash after startup',async()=>{
 const chain=await sourceMigrationChain(),f=transitionFixture(chain);f.after.tables.find(row=>row.name==='scheduler_run').sha256='c'.repeat(64);
 assert.throws(()=>assertCoveringIndexTransition(f.before,f.after,f.options));
 assert.doesNotThrow(()=>assertCoveringIndexTransition(f.before,f.after,{...f.options,allowSchedulerChanges:true}));
 f.after.tables.find(row=>row.name==='scheduler_run').columns.push({name:'unexpected',type:'text'});
 assert.throws(()=>assertCoveringIndexTransition(f.before,f.after,{...f.options,allowSchedulerChanges:true}));
});
