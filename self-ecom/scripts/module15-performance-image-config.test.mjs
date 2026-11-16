import assert from 'node:assert/strict';
import {test} from 'node:test';
import {resolve,join} from 'node:path';
import {replacePerformanceImage} from './module15-performance-image-config.mjs';

const previousImageId='sha256:'+'a'.repeat(64),imageId='sha256:'+'b'.repeat(64);
const original={schemaVersion:1,project:'self-ecom-m415-perf-1234abcd',runId:'1234abcd-1234-1234-1234-123456789012',image:'self-ecom-m415-e2e-old-api:local',overrideFile:'original-override',envFile:'retained-env',uploadsRoot:'retained-uploads',controlRoot:resolve('retained-control'),credentials:{username:'synthetic',password:'synthetic-private'},freeze:{gitSha:'retained-head',imageId:previousImageId,sourceDigest:'old-source'}};
const override={services:{api:{image:original.image,command:['node','same-bootstrap'],volumes:[{source:'same-uploads',target:'/app/storage/uploads'},{type:'bind',source:original.controlRoot.replaceAll('\\','/'),target:'/m415-control'},{type:'bind',source:'same-bootstrap',target:'/app/test/fixtures/module15-performance-bootstrap.mjs',read_only:true},{type:'bind',source:'same-probe',target:'/app/test/fixtures/module15-performance-probe.mjs',read_only:true}]}}};
const options={image:'self-ecom-m415-e2e-new-api:local',imageId,previousImageId,sourceConfigFile:'original-config',overrideFile:'new-override',controlRoot:resolve('fresh-control')};

test('换镜像不改变原配置、凭据或任何数据库及上传关联',()=>{
 const saved=structuredClone({original,override}),next=replacePerformanceImage(original,override,options);
 assert.deepEqual({original,override},saved);
 for(const key of ['runId','project','envFile','uploadsRoot','credentials'])assert.deepEqual(next.config[key],original[key]);
 assert.equal(next.config.controlRoot,options.controlRoot);assert.notEqual(next.config.controlRoot,original.controlRoot);
 for(const mount of override.services.api.volumes.filter(item=>item.target!=='/m415-control'))assert.deepEqual(next.override.services.api.volumes.find(item=>item.target===mount.target),mount);
 assert.equal(next.override.services.api.volumes.find(item=>item.target==='/m415-control').source,options.controlRoot.replaceAll('\\','/'));
 assert.deepEqual(next.override.services.api.volumes.find(item=>item.target==='/app/test/fixtures/module15-performance-control.mjs'),{type:'bind',source:join(resolve('.'),'apps/api/test/fixtures/module15-performance-control.mjs').replaceAll('\\','/'),target:'/app/test/fixtures/module15-performance-control.mjs',read_only:true});
 assert.deepEqual(next.override.services.api.command,override.services.api.command);
 assert.equal(next.config.freeze.imageId,imageId);assert.equal(next.config.freeze.sourceDigest,undefined);assert.equal(next.config.imageRevision.sourceFreezePending,true);assert.deepEqual(next.config.imageRevision.previous.freeze,original.freeze);
});
test('拒绝不一致的原override、原冻结摘要及相同或不合法的新镜像',()=>{
 assert.throws(()=>replacePerformanceImage(original,{services:{api:{image:'other'}}},options));
 assert.throws(()=>replacePerformanceImage({...original,freeze:{...original.freeze,imageId:'sha256:'+'c'.repeat(64)}},override,options));
 assert.throws(()=>replacePerformanceImage(original,override,{...options,imageId:previousImageId}));
 assert.throws(()=>replacePerformanceImage(original,override,{...options,image:'unrelated:latest'}));
 assert.throws(()=>replacePerformanceImage(original,override,{...options,imageId:'sha256:short'}));
 assert.throws(()=>replacePerformanceImage(original,override,{...options,controlRoot:original.controlRoot}));
 assert.throws(()=>replacePerformanceImage(original,override,{...options,controlRoot:'relative-control'}));
 assert.throws(()=>replacePerformanceImage(original,{services:{api:{...override.services.api,volumes:override.services.api.volumes.filter(item=>item.target!=='/m415-control')}}},options));
});

test('a subsequent image revision keeps exactly one readonly protocol mount and preserves earlier controls',()=>{
 const first=replacePerformanceImage(original,override,options),next=replacePerformanceImage(first.config,first.override,{...options,image:'self-ecom-m415-e2e-newer-api:local',imageId:'sha256:'+'c'.repeat(64),previousImageId:imageId,controlRoot:resolve('another-fresh-control')});
 assert.equal(next.override.services.api.volumes.filter(item=>item.target==='/app/test/fixtures/module15-performance-control.mjs').length,1);
 assert.equal(first.config.controlRoot,options.controlRoot);assert.equal(next.config.imageRevision.previous.controlRoot,first.config.controlRoot);
});
