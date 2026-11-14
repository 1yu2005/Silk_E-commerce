// 金额全程保留整数分字符串；仅将有界比例转为图形坐标。
import type {ApiOperations} from '@shop/api-client';
type Data<K extends keyof ApiOperations>=ApiOperations[K]['responses'] extends {200:{content:{'application/json':{data:infer D}}}}?D:never;
export type Overview=Data<'getDashboardOverview'>;
export type Trends=Data<'getDashboardTrends'>;
export type HotProducts=Data<'getDashboardHotProducts'>;
export type LowStock=Data<'getDashboardLowStock'>;
export const reportDate=(iso:string)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'medium',timeStyle:'medium',hour12:false}).format(new Date(iso));
export function decimal(value:string){const n=BigInt(value);return `${n<0n?'-':''}${(n<0n?-n:n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',')}`;}
export function money(value:string){const n=BigInt(value),a=n<0n?-n:n;return `${n<0n?'-':''}¥${decimal((a/100n).toString())}.${(a%100n).toString().padStart(2,'0')}`;}
export function trendCoordinates(items:Trends['items']){
 const values=items.flatMap(i=>[BigInt(i.paidAmountCents),BigInt(i.refundAmountCents),BigInt(i.netReceiptsCents)]);
 let min=0n,max=0n;for(const n of values){if(n<min)min=n;if(n>max)max=n;}const span=max-min||1n;
 const y=(value:string)=>20+Number((max-BigInt(value))*10000n/span)/10000*180;
 const x=(index:number)=>40+index*640/Math.max(items.length-1,1);
 return {zero:y('0'),series:(key:'paidAmountCents'|'refundAmountCents'|'netReceiptsCents')=>items.map((r,i)=>`${x(i)},${y(r[key])}`).join(' ')};
}
