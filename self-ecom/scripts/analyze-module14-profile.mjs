// 完整CPU profile仅保留于ignored目录；公开仅固定类别、静态函数名和百分比，不发布URL/参数/源码。
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
const [input,output]=process.argv.slice(2),source=resolve(input??''),target=resolve(output??''),privateRoot=resolve('output/testing/M4-14/cpu-profiles'),publicRoot=resolve('docs/verification/evidence/M4-14');
for(const [root,file]of [[privateRoot,source],[publicRoot,target]]){const r=relative(root,file);if(!r||r.startsWith('..')||isAbsolute(r))throw new Error('CPU分析路径须属于本轮私有profile或公开证据目录');}
const profile=JSON.parse(readFileSync(source,'utf8')),nodes=new Map(profile.nodes.map(n=>[n.id,n])),parents=new Map();for(const n of profile.nodes)for(const id of n.children??[])parents.set(id,n.id);
function category(frame){const url=frame.url??'',name=frame.functionName??'';
  if(/stacktrace|stack_trace|callsite|call_site|prepareStack|captureStack/i.test(name))return 'Error stack and callsite';
  if(name==='(garbage collector)')return 'Garbage collection';if(name==='(idle)')return 'Idle';
  if(/wasm:|query_compiler|query_engine/.test(url)||/wasm-function/.test(name))return 'Prisma WebAssembly';
  if(/prisma|query-compiler/.test(url))return 'Prisma JavaScript runtime';
  if(/pg-protocol|pg-types|node_modules[\\/]pg[\\/]|node_modules[\\/]\.pnpm[\\/]pg@/.test(url))return 'PostgreSQL client and protocol';
  if(/jose|crypto/.test(url))return 'JWT and crypto';
  if(/pino|sonic-boom|thread-stream/.test(url))return 'Logging';
  if(/nestjs|express|router|class-transformer|class-validator|body-parser/.test(url))return 'HTTP framework and validation';
  if(/node:|^internal[\\/]/.test(url))return 'Node.js runtime';if(/\bdist[\\/]/.test(url))return 'Application';
  if(/node_modules/.test(url))return 'Other dependency';return 'V8 or native';
}
const name=frame=>{const value=frame.functionName??'';return value&&value.length<=100&&/^[A-Za-z0-9_$<>. ():\[\]-]+$/.test(value)?value:'(anonymous or redacted)';};
const groups=new Map(),functions=new Map(),stacks=new Map();let total=0;
for(let i=0;i<(profile.samples??[]).length;i++){const id=profile.samples[i],node=nodes.get(id);if(!node)continue;const micros=profile.timeDeltas?.[i]??1000,kind=category(node.callFrame),key=kind+':'+name(node.callFrame);total+=micros;groups.set(kind,(groups.get(kind)??0)+micros);functions.set(key,(functions.get(key)??0)+micros);let parent=id;const chain=[];for(let j=0;j<6&&parent;j++){const f=nodes.get(parent)?.callFrame;if(!f)break;chain.push(category(f)+':'+name(f));parent=parents.get(parent);}const stack=chain.reverse().join(' > ');stacks.set(stack,(stacks.get(stack)??0)+micros);}
const percent=micros=>Math.round(micros/total*10000)/100,rank=map=>[...map].sort((a,b)=>b[1]-a[1]).map(([label,micros])=>({label,sampledMilliseconds:Math.round(micros/1000),percent:percent(micros)}));
const result={kind:'sanitized-cpu-profile-summary',window:'compiled API startup, warmup and measurement; diagnostic profile overhead applies',fullProfileRetainedPrivately:true,sourcePathsIncluded:false,queryParametersIncluded:false,samples:profile.samples.length,sampledMilliseconds:Math.round(total/1000),profileElapsedMilliseconds:Math.round((profile.endTime-profile.startTime)/1000),categories:rank(groups),topFunctions:rank(functions).slice(0,30),topStacks:rank(stacks).slice(0,20)};
writeFileSync(target,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
