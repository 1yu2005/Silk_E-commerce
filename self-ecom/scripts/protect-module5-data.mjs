// 作用：开发库迁移前后保存逐行摘要；只读核对旧数据与文件，不输出任何原始账号、哈希或连接串。
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {parseEnv} from 'node:util';
const require=createRequire(resolve('apps/api/package.json')),{Client}=require('pg');
const env={...parseEnv(readFileSync('.env','utf8')),...process.env};
const mode=process.argv[2];assert.ok(['before','migrated','final'].includes(mode));
const output=`docs/verification/evidence/M1-05/development-${mode}.json`;assert.ok(!existsSync(output));
const baseline=JSON.parse(readFileSync('docs/verification/evidence/M1-05/baseline.json','utf8'));
const sha=value=>createHash('sha256').update(value).digest('hex');
const files={};for(const [file,digest]of Object.entries(baseline.protectedFiles)){files[file]=sha(readFileSync(file));assert.equal(files[file],digest,file);}
const client=new Client({connectionString:env.DATABASE_URL});const rows={};
try{await client.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const tables=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows;
  for(const {tablename}of tables){assert.match(tablename,/^[a-z_]+$/);const values=(await client.query(`SELECT to_jsonb(t) AS row FROM "${tablename}" t ORDER BY to_jsonb(t)::text`)).rows.map(v=>v.row);
    rows[tablename]=Object.fromEntries(values.map(row=>{const key=JSON.stringify(row.id??row.key??row);const comparable={...row};return [key,sha(JSON.stringify(comparable))];}));
  }
  const migrations=(await client.query('SELECT migration_name,checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name')).rows;
  if(mode!=='before'){
    const before=JSON.parse(readFileSync('docs/verification/evidence/M1-05/development-before.json','utf8'));
    for(const [table,oldRows]of Object.entries(before.rows))for(const [key,digest]of Object.entries(oldRows))assert.equal(rows[table]?.[key],digest,table+'旧行');
    for(const migration of before.migrations)assert.deepEqual(migrations.find(m=>m.migration_name===migration.migration_name),migration);
    assert.equal(migrations.length,5);
  }
  await client.query('COMMIT');writeFileSync(output,JSON.stringify({checkedAt:new Date().toISOString(),mode,files,migrations,rows,passed:true},null,2)+'\n');console.log(JSON.stringify({mode,passed:true,tables:tables.length,counts:Object.fromEntries(Object.entries(rows).map(([table,r])=>[table,Object.keys(r).length]))}));
}finally{await client.end();}
