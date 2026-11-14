// 作用：保存只含摘要的当前数据保护基线；恢复缺少的公开商品图，不改数据库和Docker上传卷。
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {parseEnv} from 'node:util';
import {createHash} from 'node:crypto';
const {Client}=createRequire(resolve('apps/api/package.json'))('pg');
const env={...parseEnv(readFileSync('.env','utf8')),...process.env};
const sha=x=>createHash('sha256').update(x).digest('hex');
const output='docs/verification/evidence/M1-06';mkdirSync(output,{recursive:true});
const db=new Client({connectionString:env.DATABASE_URL});
try{
 await db.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows;
 const rows={};for(const {tablename} of tables){if(!/^[a-z_]+$/.test(tablename))throw new Error('非法表名');rows[tablename]=Object.fromEntries((await db.query(`SELECT to_jsonb(t) AS row FROM "${tablename}" t`)).rows.map(({row})=>[JSON.stringify(row.id??row.key??row),sha(JSON.stringify(row))]));}
 const migrations=(await db.query('SELECT migration_name,checksum FROM _prisma_migrations ORDER BY migration_name')).rows;
 const images=(await db.query("SELECT DISTINCT a.id,a.storage_key,a.sha256 FROM product_image p JOIN file_asset a ON a.id=p.asset_id")).rows;
 await db.query('COMMIT');
 const identities={};for(const table of ['employee','customer']){identities[table]=Object.fromEntries((await db.query(`SELECT to_jsonb(t)-'last_login_at'-'updated_at' AS row FROM ${table} t`)).rows.map(({row})=>[row.id,sha(JSON.stringify(row))]));}
 const label=process.argv[2]??'before';if(!/^[a-z0-9-]+$/.test(label))throw new Error('非法标签');
 const target=`${output}/protection-${label}.json`;if(existsSync(target))throw new Error('证据已存在');
 const files=Object.fromEntries(['.env',...migrations.map(m=>`apps/api/prisma/migrations/${m.migration_name}/migration.sql`)].map(p=>[p,sha(readFileSync(p))]));
 writeFileSync(target,JSON.stringify({at:new Date().toISOString(),files,migrations,rows,identities},null,2)+'\n');
 const restored=[];if(label==='before')for(const im of images){const dest=resolve(env.UPLOAD_DIR??'storage/uploads',im.storage_key);if(!existsSync(dest)){const r=await fetch(`http://localhost:3001/api/v1/files/${im.id}/content`);if(r.status!==200)throw new Error('原图不可读取');const data=Buffer.from(await r.arrayBuffer());if(sha(data)!==im.sha256)throw new Error('原图摘要不一致');mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,data,{flag:'wx'});restored.push(im.id);}}
 console.log(JSON.stringify({label,tables:tables.length,restoredImages:restored}));
}finally{await db.end();}
