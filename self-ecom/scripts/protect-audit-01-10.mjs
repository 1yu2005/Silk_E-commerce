// 作用：仅保存旧业务行与配置摘要，检查0013前置事实；不输出秘密或修改业务数据。
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {parseEnv} from 'node:util';
const {Client}=createRequire(resolve('apps/api/package.json'))('pg');
const env={...parseEnv(readFileSync('.env','utf8')),...process.env};
const label=process.argv[2];assert.match(label??'',/^[a-z0-9-]+$/);
const directory='docs/verification/evidence/AUDIT-01-10-2026-11-14';mkdirSync(directory,{recursive:true});
const target=directory+'/protection-'+label+'.json';assert.ok(!existsSync(target));
const sha=value=>createHash('sha256').update(value).digest('hex');
const db=new Client({connectionString:env.DATABASE_URL,statement_timeout:10000});
try{
 await db.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows;
 const rows={},accounts={};for(const {tablename}of tables){assert.match(tablename,/^[a-z_]+$/);
   const values=(await db.query('SELECT to_jsonb(t) AS row FROM "'+tablename+'" t')).rows;
   rows[tablename]=Object.fromEntries(values.map(({row})=>[JSON.stringify(row.id??row.key??row),sha(JSON.stringify(row))]));
   if(['employee','customer','employee_extra_permission'].includes(tablename))accounts[tablename]=Object.fromEntries(values.map(({row})=>{const id=JSON.stringify(row.id??row.employee_id+':'+row.permission_code);delete row.last_login_at;delete row.updated_at;return [id,sha(JSON.stringify(row))];}));
 }
 const migrations=(await db.query('SELECT migration_name,checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name')).rows;
 const files=Object.fromEntries(['.env',...migrations.map(m=>'apps/api/prisma/migrations/'+m.migration_name+'/migration.sql')].map(p=>[p,sha(readFileSync(p))]));
 const preflight=(await db.query("SELECT COUNT(*)::int AS invalid_drafts FROM initial_inventory_draft WHERE (status='CONVERTED') IS DISTINCT FROM (adjustment_id IS NOT NULL)")).rows[0];
 const balances=(await db.query('SELECT SUM(available)::text AS available,SUM(reserved)::text AS reserved FROM inventory_balance')).rows[0];
 const drift=(await db.query('SELECT b.sku_id FROM inventory_balance b LEFT JOIN (SELECT sku_id,SUM(delta_a) a,SUM(delta_r) r FROM inventory_ledger GROUP BY sku_id) l USING(sku_id) WHERE b.available<>COALESCE(l.a,0) OR b.reserved<>COALESCE(l.r,0)')).rowCount;
 const images=(await db.query("SELECT id,sha256 FROM file_asset WHERE state='RETAINED' ORDER BY id")).rows;
 await db.query('ROLLBACK');const snapshot={at:new Date().toISOString(),files,migrations,rows,accounts,preflight,balances,ledgerDrift:drift,images};
 writeFileSync(target,JSON.stringify(snapshot,null,2)+'\n');assert.equal(preflight.invalid_drafts,0,'旧草稿不满足0013要求，不得自动修数据');assert.equal(drift,0,'库存余额与流水不一致');
 const summary={label,originalRows:Object.values(rows).reduce((n,r)=>n+Object.keys(r).length,0),migrations:migrations.length,images:images.length,preflight,balances,ledgerDrift:drift};
 if(label!=='before'){
   const old=JSON.parse(readFileSync(directory+'/protection-before.json','utf8')),changes=[];
   for(const [table,values]of Object.entries(old.rows))for(const [id,hash]of Object.entries(values))if(rows[table]?.[id]!==hash)changes.push({table,id});
   for(const [file,hash]of Object.entries(old.files))assert.equal(files[file],hash,'真实配置与旧迁移不得改变');
   for(const [table,values]of Object.entries(old.accounts))for(const [id,hash]of Object.entries(values))assert.equal(accounts[table]?.[id],hash,'原账号密码/权限/资料不得改变');
   assert.deepEqual(images,old.images,'原保留文件不得改变');summary.originalRowChanges=changes;summary.originalAccountsAndFilesPreserved=true;
   for(const image of old.images){
     const response=await fetch('http://localhost:'+(env.STORE_HOST_PORT??8081)+'/api/v1/files/'+image.id+'/content');
     assert.equal(response.status,200,'原公开图片应仍可读取');assert.equal(sha(Buffer.from(await response.arrayBuffer())),image.sha256,'原图片实际字节不得改变');
   }
   summary.originalImageBytesPreserved=old.images.length;
 }
 console.log(JSON.stringify(summary));
}finally{await db.end();}
