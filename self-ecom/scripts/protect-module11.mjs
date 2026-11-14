// 作用：只读保存原配置、旧迁移、账号和上传字节摘要；不输出秘密或连接串。
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,statSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {env,docker,requireApi} from './module11-runtime.mjs';
const label=process.argv[2]??'before';assert.match(label,/^[a-z0-9-]+$/);
const folder='docs/verification/evidence/M3-11';mkdirSync(folder,{recursive:true});const target=join(folder,'protection-'+label+'.json');assert.ok(!existsSync(target));
const hash=x=>createHash('sha256').update(x).digest('hex');
const {Client}=requireApi('pg'),db=new Client({connectionString:env.DATABASE_URL,connectionTimeoutMillis:5000});
const files={'.env':hash(readFileSync('.env'))};for(const d of readdirSync('apps/api/prisma/migrations').filter(n=>/^00(?:0\d|1[0-3])_/.test(n))){const p=join('apps/api/prisma/migrations',d,'migration.sql');files[p]=hash(readFileSync(p));}
function walk(p){return readdirSync(p).flatMap(n=>{const f=join(p,n);return statSync(f).isDirectory()?walk(f):[{path:f,sha256:hash(readFileSync(f))}];});}
const report={at:new Date().toISOString(),label,files,uploads:existsSync('storage/uploads')?walk('storage/uploads'):[],containers:JSON.parse(execFileSync(docker,['inspect','self-ecom-db-1','self-ecom-api-1'],{encoding:'utf8',windowsHide:true})).map(c=>({name:c.Name,id:c.Id,startedAt:c.State.StartedAt,mounts:c.Mounts.map(m=>({type:m.Type,name:m.Name,destination:m.Destination}))}))};
try{await db.connect();await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');report.accounts=(await db.query(`SELECT 'employee' AS kind,id::text,md5((to_jsonb(t)-'last_login_at'-'updated_at')::text) AS protected_hash FROM employee t UNION ALL SELECT 'customer',id::text,md5((to_jsonb(t)-'last_login_at'-'updated_at')::text) FROM customer t ORDER BY kind,id`)).rows;report.orders=(await db.query('SELECT status,count(*)::int AS count FROM "order" GROUP BY status ORDER BY status')).rows;report.settings=(await db.query('SELECT version,current_version_id FROM store_setting_head')).rows;await db.query('COMMIT');}finally{await db.end();}
if(label!=='before'){const before=JSON.parse(readFileSync(join(folder,'protection-before.json'),'utf8'));assert.deepEqual(report.files,before.files);for(const account of before.accounts)assert.deepEqual(report.accounts.find(a=>a.kind===account.kind&&a.id===account.id),account);assert.deepEqual(report.containers[0],before.containers[0]);assert.deepEqual(report.containers[1].mounts,before.containers[1].mounts);for(const f of before.uploads)assert.deepEqual(report.uploads.find(x=>x.path===f.path),f);report.originalResourcesPreserved=true;}
writeFileSync(target,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({target,accounts:report.accounts.length,oldFiles:Object.keys(files).length,originalResourcesPreserved:report.originalResourcesPreserved??null}));
