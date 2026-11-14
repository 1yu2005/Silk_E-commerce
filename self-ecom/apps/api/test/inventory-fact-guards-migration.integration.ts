// 作用：独占旧库升级0013逐行保留事实，数据库拒绝缺失转换链接及向已入账父单偷移明细。
import { randomUUID } from 'node:crypto';
import { copyFileSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { Client } from 'pg';
import { expect,it } from 'vitest';
import { assertSafeTestDatabase } from '../scripts/database-env.js';
import { runPrisma } from '../scripts/database.js';
const base=assertSafeTestDatabase(process.env.DEVELOPMENT_DATABASE_URL,process.env.DATABASE_URL);

it('0012旧事实无损升级0013；转换状态和明细父单保护生效且重复deploy不改旧行',async()=>{
 const name='inventory_guards_'+randomUUID().replaceAll('-','')+'_test',url=new URL(base.testUrl);url.pathname='/'+name;
 const safe=assertSafeTestDatabase(base.developmentUrl,url.toString()),adminUrl=new URL(base.testUrl);adminUrl.pathname='/postgres';
 const admin=new Client({connectionString:adminUrl.toString()}),client=new Client({connectionString:safe.testUrl});let created=false,connected=false;
 const scratch=mkdtempSync(join(tmpdir(),'self-ecom-inventory-guards-')),migrations=join(scratch,'migrations');mkdirSync(migrations);
 const root=resolve(__dirname,'../prisma/migrations');
 for(const item of readdirSync(root).filter(n=>/^\d+_/.test(n)&&n<'0013_')){mkdirSync(join(migrations,item));copyFileSync(join(root,item,'migration.sql'),join(migrations,item,'migration.sql'));}
 copyFileSync(join(root,'migration_lock.toml'),join(migrations,'migration_lock.toml'));
 const config=join(scratch,'prisma.config.ts');writeFileSync(config,`export default {schema:${JSON.stringify(resolve(__dirname,'../prisma/schema.prisma'))},migrations:{path:${JSON.stringify(migrations)}},datasource:{url:process.env.DATABASE_URL}};`);
 const env={...process.env,DATABASE_URL:safe.testUrl};
 try{
  await admin.connect();await admin.query(`CREATE DATABASE "${name}" ENCODING 'UTF8' TEMPLATE template0`);created=true;
  runPrisma(['migrate','deploy','--config',config],env);await client.connect();connected=true;
  const employee=randomUUID(),product=randomUUID(),sku=randomUUID(),source=randomUUID(),sourceLine=randomUUID(),posted=randomUUID(),pending=randomUUID(),postedLine=randomUUID(),pendingLine=randomUUID(),draft=randomUUID(),converted=randomUUID(),key=randomUUID();
  await client.query(`INSERT INTO employee(id,username,display_name,password_hash,role,must_change_password,updated_at) VALUES($1,'inventory_guards','库存升级夹具','独占旧事实夹具','MERCH_WAREHOUSE',false,now())`,[employee]);
  await client.query(`INSERT INTO product(id,product_code,name,created_by_id,updated_by_id,updated_at) VALUES($1,'GUARD-P','保留原商品',$2,$2,now())`,[product,employee]);
  await client.query(`INSERT INTO sku(id,product_id,code,combination_signature,updated_at) VALUES($1,$2,'GUARD-S','DEFAULT',now())`,[sku,product]);
  await client.query(`INSERT INTO inventory_balance(sku_id,available,updated_at) VALUES($1,4,now())`,[sku]);
  await client.query(`INSERT INTO inventory_source(id,source_type,namespace,reference,normalized_reference,note,created_by_id,updated_at) VALUES($1,'RECEIPT','GUARDS','OLD','OLD','升级保留来源',$2,now())`,[source,employee]);
  await client.query(`INSERT INTO inventory_source_line(id,source_id,line_key,sku_id,verified_quantity,updated_at) VALUES($1,$2,'1',$3,10,now())`,[sourceLine,source,sku]);
  for(const [id,number]of [[posted,'GUARD-POSTED'],[pending,'GUARD-PENDING']])await client.query(`INSERT INTO inventory_adjustment(id,number,type,reason,created_by_id,updated_at) VALUES($1,$2,'INITIALIZATION','保留原事实',$3,now())`,[id,number,employee]);
  for(const [id,parent,batch]of [[postedLine,posted,'POSTED'],[pendingLine,pending,'PENDING']])await client.query(`INSERT INTO inventory_adjustment_line(id,adjustment_id,type,sku_id,source_line_id,batch_key,quantity) VALUES($1,$2,'INITIALIZATION',$3,$4,$5,4)`,[id,parent,sku,sourceLine,batch]);
  await client.query(`UPDATE inventory_adjustment SET status='POSTED',posted_at=now(),posted_by_id=$1,conversion_key=$2,conversion_fingerprint=repeat('a',64),conversion_snapshot='{}'::jsonb WHERE id=$3`,[employee,key,posted]);
  await client.query(`INSERT INTO initial_inventory_draft(id,product_id,conversion_key,created_by_id,updated_at) VALUES($1,$2,$3,$4,now())`,[draft,product,randomUUID(),employee]);
  await client.query(`INSERT INTO initial_inventory_draft(id,product_id,conversion_key,status,adjustment_id,created_by_id,updated_at) VALUES($1,$2,$3,'CONVERTED',$4,$5,now())`,[converted,product,key,posted,employee]);
  const tables=['employee','product','sku','inventory_balance','inventory_source','inventory_source_line','inventory_adjustment','inventory_adjustment_line','initial_inventory_draft'];
  const snapshot=async()=>{const rows:Record<string,unknown[]>={};for(const table of tables){const key=table==='inventory_balance'?'sku_id':'id';rows[table]=(await client.query(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY "${key}"::text`)).rows;}return rows;};
  const before=await snapshot();runPrisma(['migrate','deploy'],env);expect(await snapshot()).toEqual(before);
  await expect(client.query(`UPDATE initial_inventory_draft SET status='CONVERTED' WHERE id=$1`,[draft])).rejects.toMatchObject({code:'23514'});
  await expect(client.query(`UPDATE initial_inventory_draft SET status='VOID' WHERE id=$1`,[converted])).rejects.toMatchObject({code:'23514'});
  await expect(client.query(`UPDATE inventory_adjustment_line SET adjustment_id=$1 WHERE id=$2`,[posted,pendingLine])).rejects.toMatchObject({code:'23514'});
  expect(await snapshot()).toEqual(before);
  await client.query('BEGIN');
  try{await client.query('UPDATE inventory_adjustment_line SET quantity=3 WHERE id=$1',[pendingLine]);expect((await client.query('SELECT quantity FROM inventory_adjustment_line WHERE id=$1',[pendingLine])).rows).toEqual([{quantity:3}]);}
  finally{await client.query('ROLLBACK');}
  // 在自建库事务里重现旧数据不符合CHECK时的增量迁移预检；失败后回滚，绝不修数据。
  await client.query('BEGIN');
  try{
   await client.query('ALTER TABLE initial_inventory_draft DROP CONSTRAINT initial_draft_conversion_link');
   await client.query("UPDATE initial_inventory_draft SET status='CONVERTED' WHERE id=$1",[draft]);
   await expect(client.query(readFileSync(join(root,'0013_inventory_fact_guards/migration.sql'),'utf8'))).rejects.toMatchObject({code:'23514'});
  }finally{await client.query('ROLLBACK');}
  expect(await snapshot()).toEqual(before);
  const migrationsBefore=(await client.query('SELECT * FROM _prisma_migrations ORDER BY migration_name')).rows;runPrisma(['migrate','deploy'],env);
  expect(await snapshot()).toEqual(before);expect((await client.query('SELECT * FROM _prisma_migrations ORDER BY migration_name')).rows).toEqual(migrationsBefore);
 }finally{if(connected)await client.end();await admin.end();if(created)console.log('保留0013升级专属数据库：'+name);console.log('保留0013升级测试目录：'+scratch);}
},60000);
