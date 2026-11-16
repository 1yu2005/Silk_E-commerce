// 同一runId的每次运行独占session；命令/回应只创建一次，保留旧文件且不rename覆盖共享文件。
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const commandPattern=/^command-v2-([a-f0-9-]{36})-([1-9][0-9]*)\.json$/;
function identity(value){return value?.protocol===2&&uuid.test(value.runId??'')&&uuid.test(value.sessionId??'')&&Number.isSafeInteger(value.sequence)&&value.sequence>0;}
const same=(left,right)=>identity(left)&&identity(right)&&left.runId===right.runId&&left.sessionId===right.sessionId&&left.sequence===right.sequence;
async function completeJson(file){
 let text;try{text=await readFile(file,'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}
 if(!text.endsWith('\n'))return null;
 try{return JSON.parse(text);}catch(error){if(error instanceof SyntaxError)return null;throw error;}
}
export function controlFileName(kind,value){
 assert.ok(['command','response','probe','capture'].includes(kind)&&identity(value),'INVALID_PROBE_CONTROL_IDENTITY');
 return `${kind}-v2-${value.sessionId}-${value.sequence}.${kind==='probe'?'jsonl':'json'}`;
}
export async function writeControlCommand(directory,value){
 assert.ok(identity(value)&&['start','stop'].includes(value.action)&&typeof value.capture==='boolean','INVALID_PROBE_CONTROL_COMMAND');
 await writeFile(join(directory,controlFileName('command',value)),JSON.stringify(value)+'\n',{flag:'wx'});
}
export async function readControlResponse(directory,command){
 const response=await completeJson(join(directory,controlFileName('response',command)));
 return same(response,command)&&['started','stopped','error'].includes(response.action)?response:null;
}
export function createControlInbox(directory,runId){
 assert.match(runId,uuid);let active=null;
 return {
  async next(){
   if(active)return null;
   const files=await readdir(directory),existing=new Set(files),candidates=files.map(file=>({file,match:commandPattern.exec(file)})).filter(item=>item.match).sort((a,b)=>a.match[1].localeCompare(b.match[1])||Number(a.match[2])-Number(b.match[2]));
   for(const {file}of candidates){
    if(existing.has(file.replace(/^command-v2-/,'response-v2-')))continue;
    const value=await completeJson(join(directory,file));
    if(!identity(value)||value.runId!==runId||!['start','stop'].includes(value.action)||typeof value.capture!=='boolean'||controlFileName('command',value)!==file)continue;
    // 已存在的回应（包括失败时留下的半写文件）不能被覆盖或重复处理。
    if(existing.has(controlFileName('response',value)))continue;
    if(value.sequence>1&&!await readControlResponse(directory,{...value,sequence:value.sequence-1}))continue;
    active=value;return value;
   }
   return null;
  },
  async reply(command,value){
   assert.ok(same(command,active)&&['started','stopped','error'].includes(value.action),'INVALID_PROBE_CONTROL_REPLY');
   await writeFile(join(directory,controlFileName('response',command)),JSON.stringify({...value,protocol:2,runId,sessionId:command.sessionId,sequence:command.sequence})+'\n',{flag:'wx'});
   active=null;
  },
 };
}
