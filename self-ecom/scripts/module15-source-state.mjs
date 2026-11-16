// 作用：为功能验收与部署生成源码指纹，涵盖未提交修改、新文件和已删除文件。
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const rootDirectory=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const execute=promisify(execFile);
const hash=value=>createHash('sha256').update(value).digest('hex');

export async function readSourceState(root=rootDirectory){
 const git=async args=>(await execute('git',args,{cwd:root,windowsHide:true,maxBuffer:32*1024*1024})).stdout;
 const include=file=>/^(apps|packages|scripts|infra)\//.test(file)||/^(package\.json|pnpm-lock\.yaml)$/.test(file);
 const listed=(await git(['ls-files','--cached','--others','--exclude-standard','-z','--','.'])).split('\0').filter(include).sort(),files=new Map();
 for(const file of listed){
  try{files.set(file,hash(await readFile(path.join(root,file))));}
  catch(error){if(error.code!=='ENOENT')throw error;}
 }
 const changed=new Set([...(await git(['diff','HEAD','--relative','--name-only','-z','--','.'])).split('\0'),...(await git(['ls-files','--others','--exclude-standard','-z','--','.'])).split('\0')].filter(include));
 return {head:(await git(['rev-parse','HEAD'])).trim(),digest:hash(JSON.stringify([...files])),files,changed};
}

export async function sourceManifestDigest(root=rootDirectory){return (await readSourceState(root)).digest;}
