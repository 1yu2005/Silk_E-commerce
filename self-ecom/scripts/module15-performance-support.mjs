// 作用：固定内存分布与可回放的流式原始样本；量化上取整，不删失败/慢点。
import {createWriteStream} from 'node:fs';
import {once} from 'node:events';
export class Histogram {
 constructor(maxMs=120000,precisionMs=.1){this.precisionMs=precisionMs;this.bins=new Uint32Array(Math.ceil(maxMs/precisionMs)+1);this.count=0;this.maximum=0;this.overflow=0;this.sum=0;}
 add(value){if(!Number.isFinite(value)||value<0)throw new Error('非法耗时样本');const index=Math.ceil(value/this.precisionMs);if(index>=this.bins.length)this.overflow++;else this.bins[index]++;this.count++;this.sum+=value;this.maximum=Math.max(this.maximum,value);}
 percentile(p){if(!this.count)return null;const target=Math.ceil(this.count*p);let sum=0;for(let n=0;n<this.bins.length;n++){sum+=this.bins[n];if(sum>=target)return Math.round(n*this.precisionMs*1000)/1000;}return this.maximum;}
 summary(){return {samples:this.count,p50Ms:this.percentile(.5),p95Ms:this.percentile(.95),p99Ms:this.percentile(.99),maxMs:this.maximum,meanMs:this.count?this.sum/this.count:null,histogramPrecisionMs:this.precisionMs,histogramOverflow:this.overflow};}
}
export class JsonlWriter {
 constructor(path){this.stream=createWriteStream(path,{flags:'wx'});this.error=null;this.records=0;this.waitMs=0;this.stream.on('error',error=>{this.error=error;});}
 async write(row){if(this.error)throw this.error;this.records++;const start=performance.now();if(!this.stream.write(JSON.stringify(row)+'\n')){this.drain??=once(this.stream,'drain').finally(()=>{this.drain=undefined;});await this.drain;}this.waitMs+=performance.now()-start;if(this.error)throw this.error;}
 async close(){if(this.error)throw this.error;this.stream.end();await once(this.stream,'finish');if(this.error)throw this.error;}
}
export const mixedWeights=Object.freeze({orders:25,products:15,tasks:15,trends30:10,hotProducts:10,customers:15,audit:10});
export function mixedCase(sequence){let slot=sequence%100;for(const [name,weight]of Object.entries(mixedWeights)){if(slot<weight)return name;slot-=weight;}throw new Error('混合比例不完整');}
export function workloadPaths(now=new Date()){
 const since=new Date(+now-60*86400000).toISOString(),until=now.toISOString();
 return {
  orders:['/admin/orders?status=COMPLETED&page=1&pageSize=20','/admin/orders?status=WAIT_SHIPMENT&page=2&pageSize=20','/admin/orders?afterSaleOnly=true&page=3&pageSize=20',`/admin/orders?from=${encodeURIComponent(since)}&to=${encodeURIComponent(until)}&page=30&pageSize=20`],
  products:['/admin/products?status=ON_SALE&page=1&pageSize=20','/admin/products?keyword='+encodeURIComponent('性能服装')+'&page=2&pageSize=20','/admin/products?minPriceCents=9000&maxPriceCents=11000&page=3&pageSize=20'],
  tasks:['/admin/tasks?view=pool&businessType=ORDER&stage=SHIPMENT_PROCESS&page=1&pageSize=20','/admin/tasks?view=mine&businessType=AFTER_SALE&stage=REFUND_PROCESS&page=1&pageSize=20','/admin/tasks?view=pool&businessType=ORDER&page=10&pageSize=20'],
  trends30:['/admin/dashboard/trends?days=30'],hotProducts:['/admin/dashboard/hot-products?limit=10'],
  customers:['/admin/customers?page=1&pageSize=20','/admin/customers?page=13&pageSize=20','/admin/customers?page=30&pageSize=20'],
  audit:Array.from({length:10},(_,n)=>n%2?`/admin/audit-logs?from=${encodeURIComponent(since)}&to=${encodeURIComponent(until)}&page=${n+1}&pageSize=20`:`/admin/audit-logs?businessType=ORDER&businessNo=M415-O-${n*7919%100000+1}&from=${encodeURIComponent(since)}&to=${encodeURIComponent(until)}&page=1&pageSize=20`),
 };
}
