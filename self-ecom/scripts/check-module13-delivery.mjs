// 作用：交付前只读检查Git、文档链接、私有排除和本期公开产物秘密泄漏；仅写脱敏检查结论。
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,existsSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {env} from './module13-runtime.mjs';
const root=process.cwd(),git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true}),head=git(['rev-parse','HEAD']).trim();assert.equal(head,'49934acda1dda77577f96396f87dc8497eedb6f0');
assert.equal(git(['diff','--cached','--name-only']).trim(),'');
const whitespace=spawnSync('git',['-c','core.safecrlf=false','diff','--check'],{cwd:root,encoding:'utf8',windowsHide:true});assert.equal(whitespace.status,0,whitespace.stdout);
const privatePath='private-delivery/板块13_开发完成说明_含账号密码.local.md';assert.ok(existsSync(privatePath));git(['check-ignore',privatePath]);const dockerIgnore=readFileSync('.dockerignore','utf8');for(const entry of ['private-delivery','.env','docs','项目文档','output'])assert.ok(dockerIgnore.split(/\r?\n/).includes(entry));
const publicPath='项目文档/开发进度文档/开发完成说明/板块13_开发完成说明.md',documents=[publicPath,privatePath,'docs/design/M3-13.md','docs/verification/M3-13.md','README.md','项目文档/开发进度总览.md','项目文档/开发进度文档/M3_售后闭环/12_板块13_异常协作争议与线下处理闭环.md'];
const broken=[];for(const file of documents){const source=readFileSync(file,'utf8');for(const [,link]of source.matchAll(/\]\(([^)\s]+)\)/g)){if(/^(https?:|#)/.test(link))continue;const target=decodeURIComponent(link.split('#')[0]);if(target&&!existsSync(path.resolve(path.dirname(file),target)))broken.push({file,link});}}assert.deepEqual(broken,[]);
for(const file of [publicPath,privatePath])assert.ok(readFileSync(file,'utf8').includes('无新增成员，已有账号和密码保持不变'));
const credential=JSON.parse(readFileSync('private-delivery/板块8＋9_演示顾客.local.json','utf8')),sensitive=[...Object.entries(env).filter(([k,v])=>/PASSWORD|SECRET|TOKEN|DATABASE_URL/.test(k)&&v?.length>=8).map(([,v])=>v),credential.password,new URL(env.DATABASE_URL).password].filter(v=>v?.length>=8);
const files=new Set([...git(['diff','--relative','--name-only','-z']).split('\0'),...git(['ls-files','--others','--exclude-standard','-z']).split('\0')].filter(Boolean));
function visit(folder){for(const n of readdirSync(folder)){const f=path.join(folder,n);if(statSync(f).isDirectory())visit(f);else if(/\.(?:js|css|html|json|map)$/.test(f))files.add(f);}}
for(const folder of ['apps/api/dist','apps/admin-web/dist','apps/store-web/dist'])if(existsSync(folder))visit(folder);
const leaks=[];let scanned=0;for(const file of files){if(!existsSync(file)||!statSync(file).isFile()||/\.(png|jpe?g|webp|gif|ico|woff2?|ttf|pdf|zip)$/i.test(file))continue;const body=readFileSync(file,'utf8');scanned++;if(sensitive.some(s=>body.includes(s)))leaks.push({file,kind:'已知本机凭据'});if(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(body))leaks.push({file,kind:'完整JWT形态'});}
if(leaks.length)console.log(JSON.stringify({leaks}));assert.deepEqual(leaks,[]);
const report={at:new Date().toISOString(),status:'passed',head,branch:git(['branch','--show-current']).trim(),stagedFiles:0,diffWhitespace:'passed',changedOrUntrackedFiles:files.size,scannedTextFiles:scanned,secretHits:0,documentLinks:'passed',privateIgnored:true,dockerExcluded:true};writeFileSync('docs/verification/evidence/M3-13/delivery-check.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
