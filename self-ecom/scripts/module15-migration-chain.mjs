// 作用：严格绑定冻结迁移文件，并仅放行板块15已核覆盖索引及其唯一成功迁移行。
import {createHash} from 'node:crypto';
import {lstat,readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {identifier,requireCondition} from './module15-ops-snapshot.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const same=(actual,expected,code)=>requireCondition(JSON.stringify(actual)===JSON.stringify(expected),code);
const hex=/^[a-f0-9]{64}$/;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const COVERING_MIGRATION_NAME='0018_reporting_hot_payment_cover';
export const COVERING_INDEX_NAME='payment_succeeded_order_paid_at_idx';
export const COVERING_MIGRATION_SQL='CREATE INDEX "payment_succeeded_order_paid_at_idx" ON "payment"("order_id") INCLUDE ("paid_at") WHERE "status"=\'SUCCEEDED\';\n';
export const COVERING_MIGRATION_SHA256=hash(COVERING_MIGRATION_SQL);
export const COVERING_INDEX_DEFINITION="CREATE INDEX payment_succeeded_order_paid_at_idx ON public.payment USING btree (order_id) INCLUDE (paid_at) WHERE ((status)::text = 'SUCCEEDED'::text)";
const schedulerTables=new Set(['scheduler_run','scheduler_failure']);

export async function readMigrationChain(root){
 const folder=path.resolve(root,'apps/api/prisma/migrations');
 requireCondition(!(await lstat(folder)).isSymbolicLink(),'MIGRATION_DIRECTORY_LINK_REFUSED');
 const names=(await readdir(folder)).filter(name=>/^\d{4}_/.test(name)).sort();
 requireCondition(names.length>0,'MIGRATION_FILES_EMPTY');
 const rows=[];
 for(const [index,name]of names.entries()){
  requireCondition(name.startsWith(String(index+1).padStart(4,'0')+'_'),'MIGRATION_FILES_NOT_CONTIGUOUS');
  const directory=path.join(folder,name),file=path.join(directory,'migration.sql');
  requireCondition(!(await lstat(directory)).isSymbolicLink()&&!(await lstat(file)).isSymbolicLink()&&(await lstat(file)).isFile(),'MIGRATION_FILE_LINK_OR_KIND_REFUSED');
  rows.push({name,sha256:hash(await readFile(file))});
 }
 return rows;
}

export function assertMigrationFiles(actual,expected){
 requireCondition(Array.isArray(actual)&&Array.isArray(expected)&&actual.length>0&&actual.length===expected.length,'MIGRATION_FILE_CHAIN_LENGTH_MISMATCH');
 for(const [index,row]of actual.entries())requireCondition(row.name===expected[index].name&&row.sha256===expected[index].sha256&&hex.test(row.sha256),'MIGRATION_FILE_CHAIN_MISMATCH');
}

function coveringChain(chain){
 requireCondition(chain.length===18&&chain.at(-1).name===COVERING_MIGRATION_NAME&&chain.at(-1).sha256===COVERING_MIGRATION_SHA256,'COVERING_MIGRATION_FILE_NOT_APPROVED');
}

export function assertMigrationChain(rows,chain,{allowCoveringIndexPending=false}={}){
 requireCondition(Array.isArray(rows)&&Array.isArray(chain)&&rows.length>0,'MIGRATION_CHAIN_REQUIRED');
 const pending=rows.length===chain.length-1;
 if(pending){requireCondition(allowCoveringIndexPending,'MIGRATION_CHAIN_INCOMPLETE');coveringChain(chain);}
 else requireCondition(rows.length===chain.length,'MIGRATION_CHAIN_LENGTH_MISMATCH');
 for(const [index,row]of rows.entries())requireCondition(row.migration_name===chain[index].name&&row.checksum===chain[index].sha256&&hex.test(row.checksum)&&typeof row.finished_at==='string'&&Number.isFinite(Date.parse(row.finished_at))&&row.rolled_back_at===null&&row.applied_steps_count===1,'MIGRATION_CHAIN_ENTRY_MISMATCH');
 return {count:rows.length,pending:pending?[COVERING_MIGRATION_NAME]:[],checksumsMatch:true};
}

function migrationTable(summary){
 const rows=summary.tables?.filter(row=>row.schema==='public'&&row.name==='_prisma_migrations');
 requireCondition(rows?.length===1&&Array.isArray(rows[0].columns),'MIGRATION_TABLE_MISSING');return rows[0];
}
function canonicalRowsDigest(rows){
 const digest=createHash('sha256');
 for(const row of rows){const bytes=Buffer.from(row,'utf8');digest.update(String(bytes.length)+':');digest.update(bytes);digest.update('\n');}
 return digest.digest('hex');
}
function verifiedMigrationRows(summary,rows){
 const table=migrationTable(summary);
 requireCondition(Array.isArray(rows)&&rows.every(row=>typeof row==='string')&&String(rows.length)===table.count,'MIGRATION_CANONICAL_ROWS_MISSING');
 requireCondition(rows.every((row,index)=>index===0||Buffer.compare(Buffer.from(rows[index-1]),Buffer.from(row))<=0),'MIGRATION_CANONICAL_ROWS_UNSORTED');
 requireCondition(canonicalRowsDigest(rows)===table.sha256,'MIGRATION_CANONICAL_ROWS_HASH_MISMATCH');
 const columns=table.columns.map(row=>row.name),required=['id','checksum','finished_at','migration_name','logs','rolled_back_at','started_at','applied_steps_count'];
 requireCondition(columns.length===required.length&&required.every(name=>columns.includes(name)),'MIGRATION_TABLE_COLUMNS_UNEXPECTED');
 const parsed=rows.map(row=>{const values=JSON.parse(row);requireCondition(Array.isArray(values)&&values.length===columns.length,'MIGRATION_CANONICAL_ROW_INVALID');return {canonical:row,value:Object.fromEntries(columns.map((name,index)=>[name,values[index]]))};});
 requireCondition(parsed.length===summary.migrations.length&&new Set(parsed.map(row=>row.value.migration_name)).size===parsed.length,'MIGRATION_CANONICAL_CHAIN_MISMATCH');
 for(const {value}of parsed){const listed=summary.migrations.find(row=>row.migration_name===value.migration_name);requireCondition(listed&&value.checksum===listed.checksum&&Date.parse(value.finished_at)===Date.parse(listed.finished_at)&&value.rolled_back_at===listed.rolled_back_at&&value.applied_steps_count===listed.applied_steps_count,'MIGRATION_CANONICAL_CHAIN_MISMATCH');}
 return parsed;
}

export async function readMigrationRows(client,summary){
 const table=migrationTable(summary),values=table.columns.map(column=>identifier(column.name)).join(',');
 const rows=(await client.query('SELECT canonical_row FROM (SELECT jsonb_build_array('+values+')::text AS canonical_row FROM ONLY public._prisma_migrations) rows ORDER BY canonical_row COLLATE "C"')).rows.map(row=>row.canonical_row);
 verifiedMigrationRows(summary,rows);return rows;
}

function schemaWithoutCover(summary,required){
 requireCondition(summary.schema&&hash(JSON.stringify(summary.schema))===summary.schemaSha256,'MIGRATION_SCHEMA_DIGEST_MISMATCH');
 const indexes=summary.schema.indexes,found=indexes?.filter(index=>index.schema==='public'&&index.name===COVERING_INDEX_NAME);
 requireCondition(found?.length===(required?1:0),'COVERING_INDEX_PRESENCE_MISMATCH');
 if(required)same(found[0],{schema:'public',relation:'payment',name:COVERING_INDEX_NAME,definition:COVERING_INDEX_DEFINITION,valid:true},'COVERING_INDEX_DEFINITION_MISMATCH');
 return {...summary.schema,indexes:indexes.filter(index=>!(index.schema==='public'&&index.name===COVERING_INDEX_NAME))};
}

export function assertCoveringIndexTransition(before,after,{chain,beforeMigrationRows,afterMigrationRows,allowSchedulerChanges=false}={}){
 coveringChain(chain);assertMigrationChain(before.migrations,chain,{allowCoveringIndexPending:true});assertMigrationChain(after.migrations,chain);
 const pending=before.migrations.length!==chain.length;
 same(after.migrations.slice(0,before.migrations.length),before.migrations,'EXISTING_MIGRATION_ROWS_CHANGED');
 same(schemaWithoutCover(after,true),schemaWithoutCover(before,!pending),'UNAPPROVED_MIGRATION_SCHEMA_CHANGE');
 const oldRows=verifiedMigrationRows(before,beforeMigrationRows),newRows=verifiedMigrationRows(after,afterMigrationRows),oldSet=new Set(oldRows.map(row=>row.canonical));
 requireCondition(oldSet.size===oldRows.length&&newRows.every(row=>oldSet.has(row.canonical)||row.value.migration_name===COVERING_MIGRATION_NAME),'EXISTING_MIGRATION_FULL_ROWS_CHANGED');
 requireCondition(oldRows.every(row=>newRows.some(next=>next.canonical===row.canonical)),'EXISTING_MIGRATION_FULL_ROWS_CHANGED');
 const added=newRows.filter(row=>!oldSet.has(row.canonical));
 requireCondition(added.length===(pending?1:0)&&newRows.length===oldRows.length+added.length,'MIGRATION_APPEND_COUNT_MISMATCH');
 if(pending){
  const row=added[0].value;
  requireCondition(uuid.test(row.id)&&!oldRows.some(old=>old.value.id===row.id)&&row.migration_name===COVERING_MIGRATION_NAME&&row.checksum===chain.at(-1).sha256&&row.logs===null&&row.rolled_back_at===null&&row.applied_steps_count===1&&Number.isFinite(Date.parse(row.started_at))&&Number.isFinite(Date.parse(row.finished_at))&&Date.parse(row.finished_at)>=Date.parse(row.started_at),'NEW_MIGRATION_ROW_INVALID');
  const listed=after.migrations.at(-1);requireCondition(Date.parse(row.finished_at)===Date.parse(listed.finished_at),'NEW_MIGRATION_FINISHED_AT_MISMATCH');
 }
 const comparable=summary=>({...summary,schema:schemaWithoutCover(summary,summary.migrations.length===chain.length),schemaSha256:null,migrations:summary.migrations.slice(0,before.migrations.length),tables:summary.tables.map(table=>{
  if(table.schema==='public'&&(table.name==='_prisma_migrations'||allowSchedulerChanges&&schedulerTables.has(table.name)))return {...table,count:null,sha256:null};
  return table;
 })});
 same(comparable(after),comparable(before),'MIGRATION_CHANGED_PROTECTED_DATABASE');
 return {migrationCountBefore:before.migrations.length,migrationCountAfter:after.migrations.length,appendedMigrations:pending?[COVERING_MIGRATION_NAME]:[],onlyApprovedIndexAdded:pending,allExistingMigrationColumnsEqual:true,allOtherTablesAllColumnsEqual:true,schemaOtherwiseEqual:true,schedulerTechnicalTablesAllowedToChange:allowSchedulerChanges?[...schedulerTables]:[]};
}
