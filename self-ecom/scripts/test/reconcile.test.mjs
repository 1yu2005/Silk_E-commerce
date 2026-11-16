// 作用：检验只读对账的账链判定；所有临时文件保留，不执行删除钩子。
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,writeFile,symlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {verifyInventoryChain,checkFile} from '../reconcile.mjs';
const edge=(id,a,r,da,dr,sequence=1)=>({action_id:id,sequence,before_a:a,before_r:r,after_a:a+da,after_r:r+dr,delta_a:da,delta_r:dr});
const temporaryRoot=path.resolve('output/testing/M4-15/reconcile-unit');await mkdir(temporaryRoot,{recursive:true});
test('空流水仅接受零余额；余额版本不参与推断',()=>{assert.equal(verifyInventoryChain([],{available:0,reserved:0,version:4}),true);assert.equal(verifyInventoryChain([],{available:1,reserved:0}),false);});
test('同动作内先按sequence压边，跨动作允许同毫秒乱序',()=>{const rows=[edge('pay',6,4,0,-4),edge('reserve',8,2,-2,2,2),edge('initial',0,0,10,0),edge('reserve',10,0,-2,2,1)];assert.equal(verifyInventoryChain(rows,{available:6,reserved:0}),true);});
test('存在分叉时验证完整Euler路径，不用贪心误拒合法循环',()=>{const rows=[edge('return',2,0,-2,0),edge('seed',0,0,2,0),edge('final',0,0,1,0)];assert.equal(verifyInventoryChain(rows,{available:1,reserved:0}),true);});
test('拒绝断开循环、错误delta、错误动作sequence和最终余额',()=>{assert.equal(verifyInventoryChain([edge('orphan',5,0,0,0)],{available:0,reserved:0}),false);assert.equal(verifyInventoryChain([{...edge('bad',0,0,1,0),after_a:2}],{available:2,reserved:0}),false);assert.equal(verifyInventoryChain([edge('gap',0,0,1,0,2)],{available:1,reserved:0}),false);assert.equal(verifyInventoryChain([edge('one',0,0,1,0)],{available:2,reserved:0}),false);});
test('拒绝同动作中途链不连续或负余额',()=>{assert.equal(verifyInventoryChain([edge('one',0,0,3,0),edge('one',2,0,1,0,2)],{available:3,reserved:0}),false);assert.equal(verifyInventoryChain([edge('negative',0,0,-1,0)],{available:-1,reserved:0}),false);});
test('文件核对真实字节、大小和SHA，拒绝缺失与路径穿越',async()=>{const root=await mkdtemp(path.join(temporaryRoot,'files-'));const key='tmp/'+randomUUID()+'.part';await mkdir(path.join(root,'tmp'));const bytes=Buffer.from('module15-file-proof');await writeFile(path.join(root,key),bytes);const asset={storage_key:key,byte_size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};assert.equal(await checkFile(asset,root),true);assert.equal(await checkFile({...asset,byte_size:1},root),false);assert.equal(await checkFile({...asset,sha256:'0'.repeat(64)},root),false);assert.equal(await checkFile({...asset,storage_key:'../outside'},root),false);assert.equal(await checkFile({...asset,storage_key:'tmp/'+randomUUID()+'.part'},root),false);});
test('符号链接文件不能作为上传证据',async t=>{const root=await mkdtemp(path.join(temporaryRoot,'symlink-')),key='tmp/'+randomUUID()+'.part';await mkdir(path.join(root,'tmp'));await writeFile(path.join(root,'source'),'x');try{await symlink(path.join(root,'source'),path.join(root,key),'file');}catch(error){if(error.code==='EPERM'){t.skip('当前Windows身份无symlink创建权限；需在Linux运维验证补验');return;}throw error;}assert.equal(await checkFile({storage_key:key,byte_size:1,sha256:createHash('sha256').update('x').digest('hex')},root),false);});
