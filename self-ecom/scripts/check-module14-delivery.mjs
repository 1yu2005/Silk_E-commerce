// 作用：交付前只读检查Git、文档链接、私有排除和本期公开产物秘密泄漏；仅写脱敏检查结论。
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,existsSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {env} from './module13-runtime.mjs';
const root=process.cwd(),git=args=>{try{return execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024});}catch(error){throw new Error('Git只读检查失败：'+args[0]+' / '+(error.code??error.status),{cause:undefined});}},head=git(['rev-parse','HEAD']).trim();assert.equal(head,'5021fba961be3c7e636e4fe202ff374f4680dd93');
const stagedMode=process.argv.includes('--staged'),staged=git(['diff','--cached','--relative','--name-only','-z']).split('\0').filter(Boolean);
if(!stagedMode)assert.equal(staged.length,0);
for(const args of [['diff','--check'],...(stagedMode?[['diff','--cached','--check']]:[])]){const whitespace=spawnSync('git',['-c','core.safecrlf=false',...args],{cwd:root,encoding:'utf8',windowsHide:true});assert.equal(whitespace.status,0,whitespace.stdout);}
const privatePath='private-delivery/板块14_开发完成说明_含账号密码.local.md';assert.ok(existsSync(privatePath));git(['check-ignore',privatePath]);const dockerIgnore=readFileSync('.dockerignore','utf8');for(const entry of ['private-delivery','.env','docs','项目文档','output'])assert.ok(dockerIgnore.split(/\r?\n/).includes(entry));
const publicPath='项目文档/开发进度文档/开发完成说明/板块14_开发完成说明.md',documents=[publicPath,privatePath,'docs/design/M4-14.md','docs/verification/M4-14.md','README.md','项目文档/开发进度总览.md','项目文档/开发进度文档/M4_可验收交付/13_板块14_经营看板净消费与审计查询.md'];
const broken=[];for(const file of documents){const source=readFileSync(file,'utf8');for(const [,link]of source.matchAll(/\]\(([^)\s]+)\)/g)){if(/^(https?:|#)/.test(link))continue;const target=decodeURIComponent(link.split('#')[0]);if(target&&!existsSync(path.resolve(path.dirname(file),target)))broken.push({file,link});}}assert.deepEqual(broken,[]);
for(const file of [publicPath,privatePath])assert.ok(readFileSync(file,'utf8').includes('无新增成员，已有账号和密码保持不变'));
const credential=JSON.parse(readFileSync('private-delivery/板块8＋9_演示顾客.local.json','utf8')),sensitive=[...Object.entries(env).filter(([k,v])=>/PASSWORD|SECRET|TOKEN|DATABASE_URL/.test(k)&&v?.length>=8).map(([,v])=>v),credential.password,new URL(env.DATABASE_URL).password].filter(v=>v?.length>=8);
// 本轮保留的隔离成员也属于真实可登录凭据；从私有台账只读收集，绝不输出值。
function collectSecrets(value){if(!value||typeof value!=='object')return;for(const [key,item]of Object.entries(value)){if(/password|secret|token|database.?url/i.test(key)&&typeof item==='string'&&item.length>=8)sensitive.push(item);if(item&&typeof item==='object')collectSecrets(item);}}
function privateLedgers(folder){if(!existsSync(folder))return;for(const entry of readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isDirectory())privateLedgers(file);else if(entry.isFile()&&entry.name.endsWith('.json'))collectSecrets(JSON.parse(readFileSync(file,'utf8')));}}
privateLedgers('private-delivery/M4-14');
const files=new Set([...staged,...git(['diff','--relative','--name-only','-z']).split('\0'),...git(['ls-files','--others','--exclude-standard','-z']).split('\0')].filter(Boolean));
function visit(folder){for(const n of readdirSync(folder)){const f=path.join(folder,n);if(statSync(f).isDirectory())visit(f);else if(/\.(?:js|css|html|json|map)$/.test(f))files.add(f);}}
for(const folder of ['apps/api/dist','apps/admin-web/dist','apps/store-web/dist'])if(existsSync(folder))visit(folder);
const leaks=[];let scanned=0;for(const file of files){if(!existsSync(file)||!statSync(file).isFile()||/\.(png|jpe?g|webp|gif|ico|woff2?|ttf|pdf|zip)$/i.test(file))continue;const body=readFileSync(file,'utf8');scanned++;if(sensitive.some(s=>body.includes(s)))leaks.push({file,kind:'已知本机凭据'});if(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(body))leaks.push({file,kind:'完整JWT形态'});}
// 暂存内容也独立扫描，防止工作树的后续脱敏掩盖索引中的原始秘密。
for(const file of staged){if(/\.(png|jpe?g|webp|gif|ico|woff2?|ttf|pdf|zip)$/i.test(file))continue;const body=git(['show',':self-ecom/'+file]);if(sensitive.some(s=>body.includes(s)))leaks.push({file,kind:'暂存已知本机凭据'});if(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(body))leaks.push({file,kind:'暂存完整JWT形态'});}
if(leaks.length)console.log(JSON.stringify({leaks}));assert.deepEqual(leaks,[]);
const report={at:new Date().toISOString(),status:'passed',head,branch:git(['branch','--show-current']).trim(),mode:stagedMode?'working-tree-and-index':'working-tree',stagedFiles:staged.length,diffWhitespace:'passed',changedOrUntrackedFiles:files.size,scannedTextFiles:scanned,secretHits:0,documentLinks:'passed',privateIgnored:true,dockerExcluded:true};writeFileSync('docs/verification/evidence/M4-14/delivery-check.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
