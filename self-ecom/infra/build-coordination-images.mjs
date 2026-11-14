// 作用：在业务源码冻结后逐个构建指定生产镜像；不启动、停止或删除任何容器/卷。
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {env,docker,redact} from '../scripts/module13-runtime.mjs';
const [prefix,directory,...services]=process.argv.slice(2),suffix={api:'api','admin-web':'admin','store-web':'store'};assert.match(prefix??'',/^self-ecom-m313-acceptance-[a-f0-9]{8}$/);assert.ok(directory&&services.length&&new Set(services).size===services.length&&services.every(service=>service in suffix));
const output=path.resolve(directory);assert.ok(!existsSync(path.join(output,'result.json')));mkdirSync(output,{recursive:true});const report={startedAt:new Date().toISOString(),imagePrefix:prefix,commands:[],images:[]};
const override=path.join(output,'compose.override.yaml');writeFileSync(override,`services:\n  api:\n    image: ${prefix}-api:local\n  admin-web:\n    image: ${prefix}-admin:local\n  store-web:\n    image: ${prefix}-store:local\n`);
function run(args,label){console.log(JSON.stringify({started:label}));const startedAt=new Date().toISOString(),result=spawnSync(docker,args,{env:{...env,COMPOSE_BAKE:'false',COMPOSE_PARALLEL_LIMIT:'1'},encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024}),log=path.join(output,'command-'+report.commands.length+'.log');writeFileSync(log,redact((result.stdout??'')+(result.stderr??'')+(result.error??'')));report.commands.push({label,command:['docker',...args],startedAt,endedAt:new Date().toISOString(),exitCode:result.status,log});assert.equal(result.status,0,label);return result.stdout.trim();}
let ids=[],before;
try{ids=run(['ps','-aq'],'只读原容器清单').split(/\s+/).filter(Boolean);const state=()=>ids.length?run(['inspect','--format','{{.Id}} {{.State.StartedAt}} {{.State.Running}}',...ids],'只读原容器状态'):'';before=state();for(const service of services){run(['compose','--project-name',prefix,'--env-file','.env','-f','infra/compose.yaml','-f',override,'build',service],'顺序构建 '+service);const name=prefix+'-'+suffix[service]+':local';report.images.push({service,name,id:run(['image','inspect','--format','{{.Id}}',name],'冻结构建镜像ID')});}assert.equal(state(),before);report.originalResourcesPreserved=true;report.status='built';}
catch(error){report.status='failed';report.failure=redact(error.stack??error.message);process.exitCode=1;}
finally{report.endedAt=new Date().toISOString();writeFileSync(path.join(output,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,images:report.images,originalResourcesPreserved:report.originalResourcesPreserved??false}));}
