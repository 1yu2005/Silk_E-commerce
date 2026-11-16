// 作用：验证功能验收的源码指纹能识别修改、新增及删除，同时忽略非源码产物。
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {readSourceState,sourceManifestDigest} from '../module15-source-state.mjs';

test('source fingerprints detect changed, new and deleted files without including generated output',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'self-ecom-source-state-'));
 const git=args=>execFileSync('git',args,{cwd:root,windowsHide:true,stdio:'pipe'});
 await mkdir(path.join(root,'apps/api/src'),{recursive:true});
 await mkdir(path.join(root,'scripts'),{recursive:true});
 await writeFile(path.join(root,'package.json'),'{}\n');
 await writeFile(path.join(root,'apps/api/src/example.ts'),'export const value=1;\n');
 await writeFile(path.join(root,'.gitignore'),'ignored/\n');
 git(['init','--quiet']);
 git(['add','--','package.json','apps/api/src/example.ts','.gitignore']);
 git(['-c','user.name=Source State Test','-c','user.email=source-state@example.invalid','commit','--quiet','-m','fixture']);
 const original=await readSourceState(root);
 assert.equal(original.files.size,2);
 assert.match(original.head,/^[a-f0-9]{40}$/);
 assert.equal(original.changed.size,0);
 assert.equal(await sourceManifestDigest(root),original.digest);
 await writeFile(path.join(root,'apps/api/src/example.ts'),'export const value=2;\n');
 const modified=await readSourceState(root);
 assert.notEqual(modified.digest,original.digest);
 assert.ok(modified.changed.has('apps/api/src/example.ts'));
 await writeFile(path.join(root,'scripts/functional-check.mjs'),'export const check=true;\n');
 const added=await readSourceState(root);
 assert.notEqual(added.digest,modified.digest);
 assert.ok(added.files.has('scripts/functional-check.mjs'));
 assert.ok(added.changed.has('scripts/functional-check.mjs'));
 // 仅删除本测试在刚创建的独占目录中写入的这一明确文件；保留其他测试现场。
 await unlink(path.join(root,'apps/api/src/example.ts'));
 const removed=await readSourceState(root);
 assert.notEqual(removed.digest,added.digest);
 assert.equal(removed.files.has('apps/api/src/example.ts'),false);
 assert.ok(removed.changed.has('apps/api/src/example.ts'));
 await mkdir(path.join(root,'ignored'));
 await writeFile(path.join(root,'ignored/result.json'),'{}\n');
 assert.equal(await sourceManifestDigest(root),removed.digest);
 console.log(JSON.stringify({retainedSourceStateTestDirectory:root}));
});
