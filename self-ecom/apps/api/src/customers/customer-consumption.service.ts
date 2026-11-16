// 作用：订单模块必须显式注册真实消费聚合；无模块、缺注册与查询失败分别处理。
import {Inject,Injectable,Optional} from '@nestjs/common';
import type {Prisma} from '@prisma/client';
import {CustomerError} from './customer.errors.js';
import {Clock,SystemClock} from '../common/time/clock.js';
export interface CustomerConsumptionReader {read(tx:Prisma.TransactionClient,customerId:string):Promise<string>;readMany?(tx:Prisma.TransactionClient,customerIds:readonly string[]):Promise<Map<string,string>>}
@Injectable()
export class CustomerConsumptionService {
 private reader:CustomerConsumptionReader|undefined;
 constructor(@Optional() @Inject(Clock)private readonly clock:Clock=new SystemClock()){}
 register(reader:CustomerConsumptionReader){if(this.reader)throw new Error('消费查询器重复注册');this.reader=reader;}
 async read(tx:Prisma.TransactionClient,customerId:string){
  const base={currency:'CNY' as const,asOf:this.clock.now().toISOString(),definitionVersion:'completed-unrefunded-v1'};
  const [installed]=await tx.$queryRaw<{installed:boolean}[]>`SELECT to_regclass('public.order_item') IS NOT NULL AS installed`;
  if(!this.reader){if(installed?.installed)throw new CustomerError('CUSTOMER_CONSUMPTION_UNAVAILABLE');return {...base,availability:'NOT_READY' as const,amountCents:null};}
  try{const amountCents=await this.reader.read(tx,customerId);if(!/^(0|[1-9][0-9]*)$/.test(amountCents))throw new Error('非法金额');return {...base,availability:'AVAILABLE' as const,amountCents};}
  catch{throw new CustomerError('CUSTOMER_CONSUMPTION_UNAVAILABLE');}
 }
 async readMany(tx:Prisma.TransactionClient,ids:readonly string[]){
  const base={currency:'CNY' as const,asOf:this.clock.now().toISOString(),definitionVersion:'completed-unrefunded-v1' as const};
  if(!ids.length)return new Map<string,{currency:'CNY';asOf:string;definitionVersion:'completed-unrefunded-v1';availability:'AVAILABLE'|'NOT_READY';amountCents:string|null}>();
  const [installed]=await tx.$queryRaw<{installed:boolean}[]>`SELECT to_regclass('public.order_item') IS NOT NULL AS installed`;
  if(!this.reader){if(installed?.installed)throw new CustomerError('CUSTOMER_CONSUMPTION_UNAVAILABLE');return new Map(ids.map(id=>[id,{...base,availability:'NOT_READY' as const,amountCents:null} ]));}
  try{
   if(!this.reader.readMany)throw new Error('已安装消费查询器缺少批量能力');
   const values=await this.reader.readMany(tx,ids);
   return new Map(ids.map(id=>{const amountCents=values.get(id)??'0';if(!/^(0|[1-9][0-9]*)$/.test(amountCents))throw new Error('非法金额');return [id,{...base,availability:'AVAILABLE' as const,amountCents}] as const;}));
  }catch{throw new CustomerError('CUSTOMER_CONSUMPTION_UNAVAILABLE');}
 }
}
