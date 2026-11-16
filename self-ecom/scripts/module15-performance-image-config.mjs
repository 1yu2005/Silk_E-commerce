// 作用：仅另存本轮性能环境的最终镜像配置；不迁移、造数或改变任何容器状态。
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify,parseEnv} from 'node:util';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),execute=promisify(execFile);
const dockerExecutable=process.env.DOCKER_EXECUTABLE??(process.platform==='win32'?'C:/Users/20334/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe':'docker');
const imagePattern=/^self-ecom-m415-[a-z0-9-]+-api:local$/,digestPattern=/^sha256:[a-f0-9]{64}$/;
const json=async file=>JSON.parse(await readFile(file,'utf8')),save=(file,value)=>writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});

export function replacePerformanceImage(config,override,{image,imageId,previousImageId,sourceConfigFile,overrideFile,controlRoot}){
 assert.equal(config.schemaVersion,1);assert.match(config.project,/^self-ecom-m415-perf-[a-f0-9]{8}$/);assert.match(config.runId,/^[a-f0-9-]{36}$/);
 assert.match(image,imagePattern);assert.match(imageId,digestPattern);assert.match(previousImageId,digestPattern);assert.notEqual(imageId,previousImageId,'换版必须使用不同的最终镜像');
 assert.equal(override.services?.api?.image,config.image,'原override必须对应原配置镜像');
 if(config.freeze.imageId)assert.equal(config.freeze.imageId,previousImageId,'原冻结摘要必须一致');
 assert.ok(typeof controlRoot==='string'&&isAbsolute(controlRoot),'新控制目录必须为绝对路径');assert.notEqual(resolve(controlRoot),resolve(config.controlRoot),'新镜像必须使用新控制目录并保留原bootstrap及原始文件');
 const slash=value=>value.replaceAll('\\','/'),controls=override.services.api.volumes?.filter(mount=>mount.target==='/m415-control')??[];
 assert.equal(controls.length,1,'原override必须明确唯一控制目录');assert.equal(controls[0].type,'bind');assert.equal(slash(controls[0].source),slash(config.controlRoot));assert.notEqual(controls[0].read_only,true);
 const next=structuredClone(config),nextOverride=structuredClone(override);
 next.image=image;next.overrideFile=overrideFile;next.controlRoot=controlRoot;next.freeze.imageId=imageId;delete next.freeze.sourceDigest;
 next.imageRevision={preparedAt:new Date().toISOString(),sourceConfigFile,previous:{image:config.image,imageId:previousImageId,controlRoot:config.controlRoot,freeze:structuredClone(config.freeze)},next:{image,imageId,controlRoot},controlProtocol:2,sourceFreezePending:true,reusedDataset:true};
 nextOverride.services.api.image=image;
 const protocol={type:'bind',source:slash(join(root,'apps/api/test/fixtures/module15-performance-control.mjs')),target:'/app/test/fixtures/module15-performance-control.mjs',read_only:true};
 nextOverride.services.api.volumes=nextOverride.services.api.volumes.filter(mount=>mount.target!==protocol.target).map(mount=>mount.target==='/m415-control'?{...mount,source:slash(controlRoot)}:mount);
 nextOverride.services.api.volumes.push(protocol);
 return {config:next,override:nextOverride};
}

export async function preparePerformanceImageConfig(file,{image,imageId}){
 const sourceConfigFile=resolve(file),folder=dirname(sourceConfigFile);assert.match(sourceConfigFile.replaceAll('\\','/'),/\/private-delivery\/M4-15\//);
 await execute('git',['check-ignore','--quiet',sourceConfigFile],{cwd:root,windowsHide:true});
 assert.match(image,imagePattern);assert.match(imageId,digestPattern);
 const config=await json(sourceConfigFile),override=await json(config.overrideFile),env=parseEnv(await readFile(config.envFile,'utf8'));assert.match(new URL(env.DATABASE_URL).pathname,/^\/m415_[a-f0-9]{32}_test$/);
 const inspect=async value=>JSON.parse((await execute(dockerExecutable,['image','inspect',value],{windowsHide:true,maxBuffer:1024*1024})).stdout)[0];
 const previous=await inspect(config.image),replacement=await inspect(image);assert.equal(replacement.Id,imageId);assert.equal(replacement.Os,'linux');
 const attempt=randomUUID().slice(0,8),overrideFile=join(folder,`compose-image-${attempt}.override.local.json`),configFile=join(folder,`image-config-${attempt}.local.json`),controlRoot=join(folder,`control-${attempt}`);
 const next=replacePerformanceImage(config,override,{image,imageId,previousImageId:previous.Id,sourceConfigFile,overrideFile,controlRoot});
 await mkdir(controlRoot,{recursive:false});
 await save(overrideFile,next.override);await save(configFile,next.config);
 return {status:'image-config-prepared-no-container-change',runId:config.runId,project:config.project,previousImageId:previous.Id,imageId,configFile,sourceFreezePending:true};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),values={};for(let n=0;n<args.length;n+=2){assert.ok(['--config','--image','--image-id'].includes(args[n])&&args[n+1]&&!values[args[n]]);values[args[n]]=args[n+1];}
 preparePerformanceImageConfig(values['--config'],{image:values['--image'],imageId:values['--image-id']}).then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error(JSON.stringify({status:'failed',message:'最终镜像配置未准备成功；原配置与数据库不变，已生成文件保留。'}));process.exitCode=1;});
}
