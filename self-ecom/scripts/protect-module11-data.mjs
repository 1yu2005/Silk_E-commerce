// 作用：部署前后只读核对原业务表逐行摘要及Docker上传字节；不改变数据或秘密。
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {env,docker,requireApi} from './module11-runtime.mjs';
const phase=process.argv[2];assert.ok(['predeploy','postdeploy'].includes(phase));const target='docs/verification/evidence/M3-11/data-'+phase+'.json';assert.ok(!existsSync(target));
const {Client}=requireApi('pg'),db=new Client({connectionString:env.DATABASE_URL}),hash=s=>createHash('sha256').update(s).digest('hex');
const report={at:new Date().toISOString(),phase,tables:{}};
const before=phase==='postdeploy'?JSON.parse(readFileSync('docs/verification/evidence/M3-11/data-predeploy.json','utf8')):null;
try{await db.connect();await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const tables=before?Object.keys(before.tables):(await db.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('_prisma_migrations','auth_session','scheduler_run','scheduler_failure') ORDER BY tablename`)).rows.map(r=>r.tablename);
 for(const table of tables){assert.match(table,/^[a-z_]+$/);const rows=(await db.query(`SELECT (to_jsonb(t)-'updated_at'-'last_login_at'-'shipment_reclaim_required')::text AS row FROM "${table}" t ORDER BY (to_jsonb(t)-'updated_at'-'last_login_at'-'shipment_reclaim_required')::text`)).rows;report.tables[table]={count:rows.length,sha256:hash(JSON.stringify(rows))};}
 await db.query('COMMIT');
 const script="const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');const scan=p=>fs.readdirSync(p).flatMap(n=>{const f=path.join(p,n);return fs.statSync(f).isDirectory()?scan(f):[{path:f,sha256:crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')}];});console.log(JSON.stringify(scan('/app/storage/uploads')));";
 report.uploads=JSON.parse(execFileSync(docker,['exec','self-ecom-api-1','node','-e',script],{encoding:'utf8',windowsHide:true}));
 if(before){assert.deepEqual(report.tables,before.tables);assert.deepEqual(report.uploads,before.uploads);report.originalBusinessAndUploadsPreserved=true;}
 writeFileSync(target,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({phase,tables:Object.keys(report.tables).length,rows:Object.values(report.tables).reduce((a,t)=>a+t.count,0),images:report.uploads.length,preserved:report.originalBusinessAndUploadsPreserved??null}));
}finally{await db.end();}
