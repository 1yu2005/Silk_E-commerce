// 作用：为板块13本机日志生成可提交脱敏副本和SHA清单；保留原日志，不删除文件。
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFileSync,existsSync,mkdirSync,readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {env} from './module13-runtime.mjs';

const evidence='docs/verification/evidence/M3-13',privateFolder='private-delivery/M3-13',secrets=new Set();
const add=value=>{if(typeof value==='string'&&value.length>=6)secrets.add(value);};
for(const [key,value]of Object.entries(env))if(/PASSWORD|SECRET|TOKEN|DATABASE_URL/.test(key))add(value);
for(const key of ['DATABASE_URL','TEST_DATABASE_URL'])try{add(decodeURIComponent(new URL(env[key]).password));}catch{/* 未配置的可选连接不参与扫描。 */}
function collect(value){if(!value||typeof value!=='object')return;for(const [key,item]of Object.entries(value)){if(/password|secret|token|database.?url/i.test(key))add(item);if(item&&typeof item==='object')collect(item);}}
if(existsSync('private-delivery'))for(const file of readdirSync('private-delivery'))if(file.endsWith('.json'))collect(JSON.parse(readFileSync(path.join('private-delivery',file),'utf8')));
const rules=[
 ['database-url',/postgres(?:ql)?:\/\/[^\s"'`<>]+/gi,'[REDACTED_DATABASE_URL]'],
 ['jwt',/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,'[REDACTED_JWT]'],
 ['bearer',/Bearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi,'Bearer [REDACTED]'],
 ['password-hash',/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g,'[REDACTED_PASSWORD_HASH]'],
 ['generated-password',/\b(?:Init|Next|Customer)#[A-Fa-f0-9]{20,}\b/g,'[REDACTED_GENERATED_PASSWORD]'],
 ['quoted-secret',/((?:["'])(?:(?:old|new|initial)?password|passwordHash|accessToken|refreshToken|tokenHash|JWT_SECRET|POSTGRES_PASSWORD|INIT_ADMIN_PASSWORD)(?:["'])\s*:\s*)(["'])(?:\\.|(?!\2)[^\\\r\n])*?\2/gi,'$1"[REDACTED]"'],
 ['secret-assignment',/((?:\b(?:[A-Z_]*(?:PASSWORD|SECRET|TOKEN)|(?:old|new|initial)?password|passwordHash|accessToken|refreshToken|tokenHash))\s*[=:]\s*)(["'][^"'\r\n]*["']|[^\s,;\r\n]+)/gi,'$1[REDACTED]'],
];
const hash=body=>createHash('sha256').update(body).digest('hex');
function redact(body){let result=body;for(const secret of [...secrets].sort((a,b)=>b.length-a.length))result=result.replaceAll(secret,'[REDACTED]');for(const [,pattern,replacement]of rules)result=result.replace(pattern,replacement);return result;}
function normalize(body){const clean=body.replace(/\r\n?/g,'\n').replace(/[\t ]+$/gm,'').replace(/\n+$/,'');return clean?clean+'\n':'';}
function scan(body){const hits=[];if([...secrets].some(secret=>body.includes(secret)))hits.push('known-secret');for(const [kind,pattern]of rules.slice(0,5)){pattern.lastIndex=0;if(pattern.test(body))hits.push(kind);pattern.lastIndex=0;}if(/(?:["'])(?:password|passwordHash|accessToken|refreshToken|tokenHash)(?:["'])\s*:\s*["'](?!\[REDACTED)[^"']+["']/i.test(body))hits.push('secret-field');return hits;}
mkdirSync(privateFolder,{recursive:true});
// 仅这两个明确旧日志允许覆盖脱敏；私有原件各复制一次，既有原件绝不覆盖。
for(const directory of ['docker-final','docker-sequential']){
 const original=path.join(evidence,directory,'command-4.log'),backup=path.join(privateFolder,directory+'-command-4.original.log');
 if(!existsSync(original))continue;
 if(!existsSync(backup))copyFileSync(original,backup);
 const clean=redact(readFileSync(original,'utf8'));assert.deepEqual(scan(clean),[],original+'脱敏失败');writeFileSync(original,clean);
}
function logs(folder){return readdirSync(folder,{withFileTypes:true}).flatMap(entry=>{const file=path.join(folder,entry.name);return entry.isDirectory()?logs(file):entry.isFile()&&entry.name.endsWith('.log')?[file]:[];});}
const entries=[];
for(const original of logs(evidence).sort()){
 const before=statSync(original),source=readFileSync(original),clean=normalize(redact(source.toString('utf8'))),after=statSync(original);assert.equal(after.mtimeMs,before.mtimeMs,'日志正在变化，待验证进程结束后重跑');assert.equal(after.size,before.size);
 const target=original.slice(0,-4)+'.redacted.txt';assert.deepEqual(scan(clean),[],target+'敏感形态扫描失败');writeFileSync(target,clean);const saved=readFileSync(target);assert.deepEqual(scan(saved.toString('utf8')),[]);
 entries.push({sourceLog:path.relative(evidence,original).replaceAll('\\','/'),publicText:path.relative(evidence,target).replaceAll('\\','/'),sourceSha256:hash(source),publicSha256:hash(saved),publicBytes:saved.length,secretScan:'passed'});
}
const manifest={schemaVersion:1,generatedAt:new Date().toISOString(),scope:evidence,redactions:['known-config-and-private-json-secrets',...rules.map(([name])=>name)],normalization:{lineEndings:'LF',trailingSpacesAndTabs:'removed',terminalNewline:'one-for-nonempty-text',emptyFiles:'remain-empty',logFacts:'unchanged'},sourceLogsRemainLocal:true,logs:entries,logCount:entries.length,publicSecretScan:'passed'};
writeFileSync(path.join(evidence,'public-log-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({logCount:entries.length,publicBytes:entries.reduce((sum,item)=>sum+item.publicBytes,0),knownSecretHits:0,secretShapeHits:0,manifest:path.join(evidence,'public-log-manifest.json')}));
