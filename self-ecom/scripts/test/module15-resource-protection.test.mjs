import assert from 'node:assert/strict';
import {test} from 'node:test';
import {protectOriginalContainers} from '../module15-resource-protection.mjs';

const container={id:'original',name:'/old-test-api',image:'sha256:original',mounts:[{Name:'original-data',Destination:'/data',RW:true}],running:true,restartCount:3,startedAt:'2026-11-15T01:00:00Z',restartPolicy:{Name:'unless-stopped',MaximumRetryCount:0},project:'earlier-test'};
const changed=patch=>({...structuredClone(container),...patch});
test('unchanged containers and volumes pass without claiming a restart',()=>assert.deepEqual(protectOriginalContainers([container],[changed({})]),[]));
test('existing autonomous restarts are recorded while immutable resources stay equal',()=>{
 const result=protectOriginalContainers([container],[changed({restartCount:4,startedAt:'2026-11-15T01:01:00Z'})]);
 assert.equal(result.length,1);assert.equal(result[0].before.restartCount,3);assert.equal(result[0].after.restartCount,4);
});
test('missing containers, replaced images, changed mounts and running states fail',()=>{
 assert.throws(()=>protectOriginalContainers([container],[]));
 for(const patch of [{image:'other'},{mounts:[{Name:'other'}]},{running:false},{name:'/replacement'},{project:'other'}])assert.throws(()=>protectOriginalContainers([container],[changed(patch)]));
});
test('common environment restarts and unexplained or newly introduced restarts fail',()=>{
 const common=changed({project:'self-ecom'});assert.throws(()=>protectOriginalContainers([common],[{...common,restartCount:4,startedAt:'later'}]));
 for(const previous of [changed({restartCount:0}),changed({restartPolicy:{Name:'no'}}),changed({running:false})])assert.throws(()=>protectOriginalContainers([previous],[{...previous,running:true,restartCount:4,startedAt:'later'}]));
 for(const patch of [{restartCount:3,startedAt:'later'},{restartCount:2,startedAt:'later'},{restartCount:4}])assert.throws(()=>protectOriginalContainers([container],[changed(patch)]));
});
