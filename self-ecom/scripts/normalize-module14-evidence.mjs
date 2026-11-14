// 作用：保留公开证据的原始字节，仅规范文本空白；不删除任何文件。
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';

const scope='docs/verification/evidence/M4-14';
const backupRoot='private-delivery/M4-14/evidence-before-whitespace-normalization';
const manifestPath=path.join(scope,'public-text-normalization.json');
const sha=body=>createHash('sha256').update(body).digest('hex');
function files(folder){return readdirSync(folder,{withFileTypes:true}).flatMap(entry=>{const file=path.join(folder,entry.name);return entry.isDirectory()?files(file):entry.isFile()&&entry.name.endsWith('.txt')?[file]:[];});}
const previous=existsSync(manifestPath)?JSON.parse(readFileSync(manifestPath,'utf8')):null;
const entries=new Map((previous?.files??[]).map(entry=>[entry.path,entry]));
for(const file of files(scope).sort()){
 const source=readFileSync(file),text=source.toString('utf8');
 const normalized=text.replace(/\r\n?/g,'\n').replace(/[\t ]+$/gm,'').replace(/\n+$/,'');
 const clean=Buffer.from(normalized?normalized+'\n':'');
 if(source.equals(clean))continue;
 const relative=path.relative(scope,file).replaceAll('\\','/'),backup=path.join(backupRoot,relative);
 mkdirSync(path.dirname(backup),{recursive:true});
 if(existsSync(backup))assert.equal(sha(readFileSync(backup)),sha(source),'原始字节备份已存在且不同，停止覆盖');
 else writeFileSync(backup,source,{flag:'wx'});
 writeFileSync(file,clean);
 entries.set(relative,{path:relative,sourceSha256:sha(source),publicSha256:sha(clean),sourceBytes:source.length,publicBytes:clean.length});
}
const report={schemaVersion:1,at:new Date().toISOString(),scope,reason:'Docker原生文本包含尾空白；仅规范LF、行尾空格/Tab和末尾换行，命令与结果事实保持',originalBytesRetainedPrivately:true,files:[...entries.values()].sort((a,b)=>a.path.localeCompare(b.path))};
writeFileSync(manifestPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:'passed',normalizedFiles:entries.size,manifest:manifestPath}));
