// 作用：只读保存原业务数据与配置摘要；不恢复、不修改业务数据或文件。
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {parseEnv} from 'node:util';
import {createHash} from 'node:crypto';
const {Client}=createRequire(resolve('apps/api/package.json'))('pg');
const env={...parseEnv(readFileSync('.env','utf8')),...process.env};
const sha=x=>createHash('sha256').update(x).digest('hex');
const label=process.argv[2]??'before';if(!/^[a-z0-9-]+$/.test(label))throw new Error('非法标签');
const output='docs/verification/evidence/M2-07';mkdirSync(output,{recursive:true});
const target=output+'/protection-'+label+'.json';if(existsSync(target))throw new Error('证据已存在');
const db=new Client({connectionString:env.DATABASE_URL,statement_timeout:10000});
try{await db.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows;
 const rows={};for(const {tablename}of tables){if(!/^[a-z_]+$/.test(tablename))throw new Error('非法表名');rows[tablename]=Object.fromEntries((await db.query('SELECT to_jsonb(t) AS row FROM "'+tablename+'" t')).rows.map(({row})=>{if(tablename==='customer')delete row.status_version;return [JSON.stringify(row.id??row.key??row),sha(JSON.stringify(row))];}));}
 const migrations=(await db.query('SELECT migration_name,checksum FROM _prisma_migrations ORDER BY migration_name')).rows;
 const images=(await db.query('SELECT id,storage_key,sha256 FROM file_asset WHERE state=\'RETAINED\'')).rows.map(r=>({id:r.id,hash:r.sha256,localMatches:existsSync(resolve(env.UPLOAD_DIR??'storage/uploads',r.storage_key))&&sha(readFileSync(resolve(env.UPLOAD_DIR??'storage/uploads',r.storage_key)))===r.sha256}));
 await db.query('ROLLBACK');
 const files=Object.fromEntries(['.env',...migrations.map(m=>'apps/api/prisma/migrations/'+m.migration_name+'/migration.sql')].map(p=>[p,sha(readFileSync(p))]));
 const snapshot={at:new Date().toISOString(),files,migrations,rows,images};writeFileSync(target,JSON.stringify(snapshot,null,2)+'\n');
 if(label!=='before'){const old=JSON.parse(readFileSync(output+'/protection-before.json','utf8'));const differences=[];for(const [table,items]of Object.entries(old.rows))for(const [id,hash]of Object.entries(items)){if(snapshot.rows[table]?.[id]!==hash)differences.push({table,id});}for(const [p,hash]of Object.entries(old.files))if(files[p]!==hash)differences.push({file:p});console.log(JSON.stringify({at:snapshot.at,originalRows:Object.values(old.rows).reduce((n,x)=>n+Object.keys(x).length,0),differences,images:snapshot.images.length}));if(differences.length)process.exitCode=1;
 }else console.log(JSON.stringify({at:snapshot.at,tables:tables.length,originalRows:Object.values(rows).reduce((n,x)=>n+Object.keys(x).length,0),migrations:migrations.length,retainedImages:images.length}));
}catch(e){console.error('保护核对失败：'+(typeof e.code==='string'?e.code:'CHECK_FAILED'));process.exitCode=1;}finally{await db.end();}
