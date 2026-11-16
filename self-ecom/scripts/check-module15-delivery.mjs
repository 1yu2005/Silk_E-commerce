// 作用：检查工作树和索引、文档链接、私有排除及全部已知本机秘密；从不输出命中内容。
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {createHash} from 'node:crypto';
const root=process.cwd(),git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']}),gitRoot=git(['rev-parse','--show-toplevel']).trim(),head=git(['rev-parse','HEAD']).trim();
assert.equal(head,'a47c5c09be77c7a3d867c04befb6a92698287b78','板块15交付前基线必须是板块14完成提交');
const stagedMode=process.argv.includes('--staged'),sourcesOnly=process.argv.includes('--sources-only'),staged=git(['diff','--cached','--name-only','-z']).split('\0').filter(Boolean),sensitive=new Set(),secretOrigins=new Map();
if(!stagedMode)assert.equal(staged.length,0);
for(const args of [['diff','--check'],...(stagedMode?[['diff','--cached','--check']]:[])]){const check=spawnSync('git',['-c','core.safecrlf=false',...args],{encoding:'utf8',windowsHide:true});assert.equal(check.status,0,'空白检查失败，查看git diff --check');}
function secret(value,origin='configured'){if(typeof value==='string'&&value.length>=8){sensitive.add(value);secretOrigins.set(value,origin);}}
function collect(object,origin='private'){if(!object||typeof object!=='object')return;for(const [key,value]of Object.entries(object)){if(/password|secret|token|database.?url/i.test(key)&&typeof value==='string'){secret(value,origin+':'+key);if(/database.?url/i.test(key))try{secret(decodeURIComponent(new URL(value).password),origin+':'+key+':password');}catch{/* 不输出连接。 */}}else if(value&&typeof value==='object')collect(value,origin+':'+key);}}
function privateFiles(directory){if(!existsSync(directory))return;for(const entry of readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isSymbolicLink())throw new Error('私有凭据路径不能为链接');if(entry.isDirectory())privateFiles(file);else if(entry.isFile()&&/\.json$/.test(entry.name)){try{collect(JSON.parse(readFileSync(file,'utf8')),path.relative(root,file));}catch{throw new Error('私有JSON无法解析：'+path.relative(root,file));}}else if(entry.isFile()&&/(?:^|\.)env(?:\.(?:local|restore|test))?$/.test(entry.name)){collect(parseEnv(readFileSync(file,'utf8')),path.relative(root,file));}}}
if(existsSync('.env'))collect(parseEnv(readFileSync('.env','utf8')));
for(const directory of ['private-delivery/M3-13','private-delivery/M4-14','private-delivery/M4-15'])privateFiles(directory);
if(existsSync('private-delivery/板块8＋9_演示顾客.local.json'))collect(JSON.parse(readFileSync('private-delivery/板块8＋9_演示顾客.local.json','utf8')));
const originalPath='C:/Users/20334/.codex/attachments/269e2af0-66b0-4c70-be20-eed29887d95d/已粘贴的文本.txt';
if(existsSync(originalPath)){const original=readFileSync(originalPath,'utf8');secret(original.match(/员工[：:]\s*[a-z][a-z0-9_]*\s*密码[：:]?\s*([^\s；;]+)/i)?.[1]);secret(original.match(/账号[：:]\s*`m105_warehouse`\s*密码[：:]\s*`([^`]+)`/)?.[1]);secret(original.match(/管理员[：:]\s*[a-z][a-z0-9_]*\s+([^\s；;]+)/i)?.[1]);}
const dockerIgnore=readFileSync('.dockerignore','utf8').split(/\r?\n/);for(const entry of ['private-delivery','backups','.env','output','docs','项目文档'])assert.ok(dockerIgnore.includes(entry),entry+'缺少镜像排除');
const publicDoc='项目文档/开发进度文档/开发完成说明/板块15_开发完成说明.md',privateDoc='private-delivery/板块15_开发完成说明_含账号密码.local.md';
const documents=sourcesOnly?['docs/design/M4-15.md','docs/verification/M4-15.md','docs/verification/M4-15/acceptance-matrix.md']:[publicDoc,privateDoc,'docs/design/M4-15.md','docs/verification/M4-15.md','README.md','项目文档/开发进度总览.md','项目文档/开发进度文档/M4_可验收交付/14_板块15_集成验收性能与部署交付.md'];
const broken=[];for(const file of documents){assert.ok(existsSync(file),'缺少文档：'+file);for(const [,link]of readFileSync(file,'utf8').matchAll(/\]\(([^)\s]+)\)/g)){if(/^(https?:|#|codex:)/.test(link))continue;const target=decodeURIComponent(link.split('#')[0]);if(target&&!existsSync(path.resolve(path.dirname(file),target)))broken.push({file,link});}}assert.deepEqual(broken,[]);
if(!sourcesOnly){assert.equal(spawnSync('git',['check-ignore','--quiet',privateDoc],{windowsHide:true}).status,0);for(const file of [publicDoc,privateDoc])assert.ok(readFileSync(file,'utf8').includes('无新增成员，已有账号和密码保持不变'),'常用环境成员说明缺失');}
const changed=[...git(['diff','--name-only','-z']).split('\0'),...git(['ls-files','--full-name','--others','--exclude-standard','-z']).split('\0'),...staged].filter(Boolean),files=new Map(changed.map(file=>[path.resolve(gitRoot,file),file]));
function outputs(directory){if(!existsSync(directory))return;for(const entry of readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);assert.ok(!entry.isSymbolicLink());if(entry.isDirectory())outputs(file);else if(entry.isFile()&&/\.(?:js|css|html|json|map)$/.test(file))files.set(path.resolve(file),path.relative(root,file));}}
for(const directory of ['apps/api/dist','apps/admin-web/dist','apps/store-web/dist'])outputs(directory);
const binary=/\.(?:png|jpe?g|webp|gif|ico|woff2?|ttf|pdf|zip|dump)$/i,hits=[];let scannedTextFiles=0;
const dummyHash=readFileSync('apps/api/src/auth/login-support.ts','utf8').match(/DUMMY_LOGIN_HASH\s*=\s*'([^']+)'/)?.[1];assert.ok(dummyHash);
// 板块2已确认的原首管理员默认值属于既有源码契约；仅豁免原表达式的编译副本，不豁免其它文件/日志。
const initialDefaultExpression=readFileSync('apps/api/src/auth/initial-admin-seed.ts','utf8').match(/env\.INIT_ADMIN_PASSWORD \?\? '[^']+'/)?.[0];assert.ok(initialDefaultExpression);
function containsSecret(body,value){if(value.length>12)return body.includes(value);let start=body.indexOf(value);while(start>=0){const left=body[start-1]??'',right=body[start+value.length]??'';if(!/[A-Za-z0-9_#]/.test(left)&&!/[A-Za-z0-9_#]/.test(right))return true;start=body.indexOf(value,start+1);}return false;}
function scan(file,body,index=false){scannedTextFiles++;const safeBody=file.replaceAll('\\','/').endsWith('apps/api/dist/auth/initial-admin-seed.js')?body.replace(initialDefaultExpression,'[EXISTING_INITIAL_ADMIN_DEFAULT_EXPRESSION]'):body,matches=[...sensitive].filter(value=>containsSecret(safeBody,value));if(matches.length)hits.push({file,index,kind:'known-local-secret',origins:matches.map(value=>({origin:secretOrigins.get(value),length:value.length,sha256:createHash('sha256').update(value).digest('hex')}))});if(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(body))hits.push({file,index,kind:'jwt'});if(/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/.test(body.replaceAll(dummyHash,'')))hits.push({file,index,kind:'password-hash'});}
for(const [absolute,file]of files){if(binary.test(file)||!existsSync(absolute)||!lstatSync(absolute).isFile())continue;scan(file,readFileSync(absolute,'utf8'));}
for(const file of staged)if(!binary.test(file))scan(file,git(['show',':'+file]),true);
if(hits.length)console.log(JSON.stringify({secretHits:hits}));assert.deepEqual(hits,[],'秘密命中，仅报告路径，禁止打印原始内容');
const report={schemaVersion:1,at:new Date().toISOString(),head,status:'passed',scope:sourcesOnly?'sources-only':'complete-delivery',mode:stagedMode?'working-tree-and-index':'working-tree',stagedFiles:staged.length,scannedTextFiles,secretHits:0,knownSecretCount:sensitive.size,privateIgnored:true,dockerExcluded:true,documentLinks:'passed',whitespace:'passed'};mkdirSync('private-delivery/M4-15',{recursive:true});writeFileSync('private-delivery/M4-15/delivery-check.local.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
