// 作用：板块15逐包工程检查；全部普通测试真实执行并保留临时文件和所有断言。
import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const kind=process.argv[2],root=process.cwd(),tsc=resolve('node_modules/typescript/bin/tsc'),eslint=resolve('node_modules/eslint/bin/eslint.js');
const retention=pathToFileURL(resolve('docs/verification/evidence/M0-04/step11/retain-artifacts.mjs')).href;
const env={...process.env,...(kind==='build'?{NODE_ENV:'production'}:{}),NODE_OPTIONS:[process.env.NODE_OPTIONS,'--import='+retention].filter(Boolean).join(' ')};
function run(cwd,script,args){const r=spawnSync(process.execPath,[script,...args],{cwd:resolve(cwd),env,stdio:'inherit',windowsHide:true});console.log(JSON.stringify({check:kind,cwd,command:['node',script,...args],exitCode:r.status}));if(r.status!==0||r.error)process.exit(r.status??1);}
const compile=(folder,noEmit=false)=>run(folder,tsc,['-p',folder==='apps/api'&&!noEmit?'tsconfig.build.json':'tsconfig.json',...(noEmit?['--noEmit']:[])]);
const packages=['packages/shared','packages/api-client','packages/ui'];
if(['typecheck','test','build','lint'].includes(kind))for(const folder of packages)compile(folder);
if(kind==='typecheck')for(const folder of [...packages,'apps/api','apps/admin-web','apps/store-web'])compile(folder,true);
else if(kind==='lint'){
 for(const folder of ['packages/config','packages/shared','packages/api-client','packages/ui','apps/api','apps/admin-web','apps/store-web']){const args=folder==='packages/config'?['.']:folder==='packages/ui'?['src']:folder==='apps/api'?['src','test','scripts','prisma.config.ts']:folder.startsWith('apps/')?['src','test','vite.config.ts']:['src','test'];run(folder,eslint,args);}
 const deliveryFiles=['scripts','infra'].flatMap(folder=>readdirSync(resolve(folder)).filter(name=>name.endsWith('.mjs')&&(name.includes('module15')||name==='reconcile.mjs')).map(name=>folder+'/'+name));
 run('.',eslint,[...deliveryFiles,'scripts/test']);
}
else if(kind==='test'){
 run('.', '--test', [...readdirSync(resolve('scripts/test')).filter(n=>n.endsWith('.test.mjs')).map(n=>'scripts/test/'+n), 'scripts/module15-ops.test.mjs']);
 for(const folder of ['packages/shared','packages/api-client','apps/admin-web','apps/store-web'])run(folder,'--test',readdirSync(resolve(folder,'test')).filter(n=>n.endsWith('.test.mjs')).map(n=>'test/'+n));
 run('apps/api',resolve('apps/api/node_modules/vitest/vitest.mjs'),['run','--config','test/verification/retained.config.mts']);
}else if(kind==='build'){compile('apps/api');for(const folder of ['apps/admin-web','apps/store-web']){compile(folder,true);run(folder,resolve(folder,'node_modules/vite/bin/vite.js'),['build']);}}
else if(!['typecheck','lint'].includes(kind))throw new Error('未知检查类型');
console.log(JSON.stringify({kind,status:'passed',root}));
