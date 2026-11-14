// 作用：正式实物命令同步通知已安装的售后核实领域，不在提交后异步修补。
import {Injectable} from '@nestjs/common';
import type {Prisma} from '@prisma/client';
import {OrderError} from './order.errors.js';
@Injectable()
export class OrderPhysicalChanges{
 private handler?: (tx:Prisma.TransactionClient,orderId:string,requestId:string)=>Promise<void>;
 register(handler:NonNullable<OrderPhysicalChanges['handler']>){if(this.handler)throw new Error('实物失效读取器重复');this.handler=handler;}
 async notify(tx:Prisma.TransactionClient,orderId:string,requestId:string){if(this.handler)return this.handler(tx,orderId,requestId);const [r]=await tx.$queryRaw<{installed:boolean}[]>`SELECT to_regclass('public.unshipped_physical_check') IS NOT NULL AS installed`;if(r?.installed&&await tx.unshippedPhysicalCheck.count({where:{orderId,status:'VALID'}}))throw new OrderError('PHYSICAL_CHECK_STALE');}
}
