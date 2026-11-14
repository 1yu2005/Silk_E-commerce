// 作用：资格变更先合并后续业务锁，再同事务失效尚未领取的核实上下文。
import {Injectable} from '@nestjs/common';
import type {Prisma} from '@prisma/client';
import type {TaskBusinessReference} from './task-business-adapters.js';
import type {EmployeeTaskChange} from './task-eligibility.service.js';
interface IdentityEffect {
 references(tx:Prisma.TransactionClient,employeeId:string,permissions:readonly string[],change:EmployeeTaskChange):Promise<TaskBusinessReference[]>;
 invalidate(tx:Prisma.TransactionClient,employeeId:string,permissions:readonly string[],change:EmployeeTaskChange):Promise<void>;
}
@Injectable()
export class TaskIdentityEffects {
 private readonly effects:IdentityEffect[]=[];
 register(effect:IdentityEffect){this.effects.push(effect);}
 async references(tx:Prisma.TransactionClient,id:string,permissions:readonly string[],change:EmployeeTaskChange){return (await Promise.all(this.effects.map(e=>e.references(tx,id,permissions,change)))).flat();}
 async apply(tx:Prisma.TransactionClient,id:string,permissions:readonly string[],change:EmployeeTaskChange){for(const effect of this.effects)await effect.invalidate(tx,id,permissions,change);}
}
