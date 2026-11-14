// 作用：订单模块必须显式注册真实消费聚合；无模块、缺注册与查询失败分别处理。
import {Injectable} from '@nestjs/common';
import type {Prisma} from '@prisma/client';
import {CustomerError} from './customer.errors.js';
export interface CustomerConsumptionReader {read(tx:Prisma.TransactionClient,customerId:string):Promise<string>}
/** 用于口径契约；未来真实SQL聚合仍需按完成且未全额退款筛选。 */
export function completedConsumption(facts:readonly {status:string;paidCents:number;fullyRefunded:boolean}[]):string {
 let sum=0n;for(const fact of facts){if(!Number.isSafeInteger(fact.paidCents)||fact.paidCents<0)throw new CustomerError('CUSTOMER_CONSUMPTION_UNAVAILABLE');
 if(fact.status==='COMPLETED'&&!fact.fullyRefunded)sum+=BigInt(fact.paidCents);}
 return sum.toString();
}
@Injectable()
export class CustomerConsumptionService {
 private reader:CustomerConsumptionReader|undefined;
 register(reader:CustomerConsumptionReader){if(this.reader)throw new Error('消费查询器重复注册');this.reader=reader;}
 async read(tx:Prisma.TransactionClient,customerId:string){
  const base={currency:'CNY' as const,asOf:new Date().toISOString(),definitionVersion:'completed-unrefunded-v1'};
  const [installed]=await tx.$queryRaw<{installed:boolean}[]>`SELECT to_regclass('public.order_item') IS NOT NULL AS installed`;
  if(!this.reader){if(installed?.installed)throw new CustomerError('CUSTOMER_CONSUMPTION_UNAVAILABLE');return {...base,availability:'NOT_READY' as const,amountCents:null};}
  try{const amountCents=await this.reader.read(tx,customerId);if(!/^(0|[1-9][0-9]*)$/.test(amountCents))throw new Error('非法金额');return {...base,availability:'AVAILABLE' as const,amountCents};}
  catch{throw new CustomerError('CUSTOMER_CONSUMPTION_UNAVAILABLE');}
 }
}
