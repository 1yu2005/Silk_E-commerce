// 作用：按套件替换全量首轮的定向复验结果，保留来源；不将分批通过称作全量重跑。
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const directories=process.argv.slice(2);assert.ok(directories.length>1,'需要全量首轮及明确的定向复验证据目录');
const suites=new Map(),runs=[];
for(const directory of directories){
 const result=JSON.parse(readFileSync(path.join(directory,'result.json'),'utf8'));
 const output=readFileSync(path.join(directory,'output.log'),'utf8');
 const pattern=/\{"suite":"(test\/[a-z0-9-]+\.integration\.ts)","ownedDatabaseRemoved":true\}/g;
 let start=0,found=0;
 for(const match of output.matchAll(pattern)){
  const block=output.slice(start,match.index),summaries=[...block.matchAll(/^\s*Tests\s+(.+)$/gm)],summary=summaries.at(-1)?.[1];assert.ok(summary,'缺少套件结果 '+match[1]);
  const count=word=>Number(summary.match(new RegExp('(\\d+) '+word))?.[1]??0);
  const entry={suite:match[1],passed:count('passed'),failed:count('failed'),skipped:count('skipped'),evidence:directory,ownedDatabaseRemoved:true};
  assert.ok(entry.passed+entry.failed+entry.skipped>0);suites.set(entry.suite,entry);found++;start=match.index+match[0].length;
 }
 assert.ok(found>0,'没有已结束套件 '+directory);runs.push({evidence:directory,exitCode:result.exitCode,suites:found,startedAt:result.startedAt,endedAt:result.endedAt});
}
const expected=readdirSync('apps/api/test').filter(file=>file.endsWith('.integration.ts')).map(file=>'test/'+file).sort();
assert.deepEqual([...suites.keys()].sort(),expected,'本轮所有当前套件必须有证据');
const items=[...suites.values()].sort((a,b)=>a.suite.localeCompare(b.suite));
assert.deepEqual(items.filter(item=>item.failed||item.skipped),[],'最终每套都须完整执行通过');
assert.ok(runs.slice(1).every(run=>run.exitCode===0),'定向复验进程均须成功');
const report={at:new Date().toISOString(),status:'passed',method:'49套全量首轮＋受影响完整套件定向复验＋新增套件；未再次全量重跑',suites:items.length,tests:items.reduce((sum,item)=>sum+item.passed,0),failed:0,skipped:0,runs,items};
writeFileSync('docs/verification/evidence/M3-13/integration-reconciled.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,suites:report.suites,tests:report.tests,failed:0,skipped:0,method:report.method}));
