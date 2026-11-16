import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Histogram,JsonlWriter,mixedCase,mixedWeights} from './module15-performance-support.mjs';

test('有界直方图保留慢点与越界值，分位量化只向上取整',()=>{
 const histogram=new Histogram(10,.1);for(let n=1;n<=100;n++)histogram.add(n/100);
 assert.equal(histogram.percentile(.95),1);assert.equal(histogram.percentile(.99),1);
 histogram.add(120001);const result=histogram.summary();assert.equal(result.samples,101);assert.equal(result.maxMs,120001);assert.equal(result.histogramOverflow,1);assert.equal(histogram.percentile(1),120001);
 assert.throws(()=>histogram.add(Number.NaN));assert.throws(()=>histogram.add(-1));
});
test('混合负载每一百次调度精确符合权重，各工作者偏移不改变比例',()=>{
 for(const offset of [0,997,99700]){const counts={};for(let n=0;n<100;n++){const name=mixedCase(n+offset);counts[name]=(counts[name]??0)+1;}assert.deepEqual(counts,{...mixedWeights});}
});
test('100个并行写者经过背压仍完整保存逐条样本，不清理临时证据',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'self-ecom-m415-stream-')),file=join(directory,'samples.jsonl'),writer=new JsonlWriter(file);
 await Promise.all(Array.from({length:100},async(_,worker)=>{for(let sequence=0;sequence<20;sequence++)await writer.write({worker,sequence,payload:'x'.repeat(1024)});}));await writer.close();
 const rows=(await readFile(file,'utf8')).trimEnd().split('\n').map(line=>JSON.parse(line));assert.equal(rows.length,2000);assert.equal(writer.records,2000);assert.equal(new Set(rows.map(row=>`${row.worker}:${row.sequence}`)).size,2000);
});
