// 作用：以最终Linux生产镜像补验Windows无法创建symlink的文件拒绝场景，保留全部现场。
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';

const image=process.argv[2];assert.match(image??'',/^self-ecom-m415-e2e-[a-f0-9]{8}-api:local$/);
const runId=randomUUID().slice(0,8),name='self-ecom-m415-linux-reconcile-'+runId;
const output=path.resolve('output/testing/M4-15/linux-reconcile',runId);mkdirSync(output,{recursive:true});
const docker=process.env.DOCKER_EXECUTABLE??(process.platform==='win32'?path.join(process.env.LOCALAPPDATA,'Programs/DockerDesktop/resources/bin/docker.exe'):'docker');
const args=['run','--name',name,'--network','none','--mount','type=bind,source='+path.resolve('scripts')+',target=/proof/scripts,readonly',
 '--mount','type=bind,source='+output+',target=/proof/output','--workdir','/proof','--entrypoint','node',image,'--test','scripts/test/reconcile.test.mjs'];
const startedAt=new Date().toISOString(),result=spawnSync(docker,args,{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
const report={kind:'linux-production-image-reconcile-unit',startedAt,endedAt:new Date().toISOString(),image,container:name,network:'none',databaseConnected:false,exitCode:result.status,resourcesRetained:true};
writeFileSync(path.join(output,'result.json'),JSON.stringify(report,null,2)+'\n');
console.log(result.stdout??'');console.error(result.stderr??'');assert.equal(result.status,0,'Linux对账单元未通过');
assert.match(result.stdout,/pass 7/);assert.match(result.stdout,/skipped 0/);console.log(JSON.stringify(report));
