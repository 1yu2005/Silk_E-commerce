// 作用：真实后续业务在原顾客状态事务内同步失效；未安装时保留原流程。
import {Injectable} from '@nestjs/common';
import type {Prisma} from '@prisma/client';
import type {CustomerContext} from './customer-access.service.js';
type StatusWrapper=<T>(tx:Prisma.TransactionClient,ctx:CustomerContext,customerId:string,work:()=>Promise<T>)=>Promise<T>;
@Injectable()
export class CustomerStatusEffects {
 private wrapper?:StatusWrapper;
 register(wrapper:StatusWrapper){if(this.wrapper)throw new Error('顾客状态业务衔接重复注册');this.wrapper=wrapper;}
 run<T>(tx:Prisma.TransactionClient,ctx:CustomerContext,id:string,work:()=>Promise<T>){return this.wrapper?this.wrapper(tx,ctx,id,work):work();}
}
