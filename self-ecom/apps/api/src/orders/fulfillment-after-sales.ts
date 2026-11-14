// 作用：售后未安装有明确边界；真实表出现后缺失查询器必须拒绝，测试实现由测试模块单独注册。
import {Injectable} from '@nestjs/common';
import type {Prisma} from '@prisma/client';
import {OrderError} from './order.errors.js';
export interface FulfillmentAfterSaleReader {
 hasActive(tx:Prisma.TransactionClient,orderId:string):Promise<boolean>;
 sourceBelongs(tx:Prisma.TransactionClient,orderId:string,sourceId:string):Promise<boolean>;
 sourceActive(tx:Prisma.TransactionClient,orderId:string,sourceId:string):Promise<boolean>;
 physicalCheckStartedAt?(tx:Prisma.TransactionClient,orderId:string):Promise<Date|null>;
 handoverRecorded?(tx:Prisma.TransactionClient,orderId:string,requestId:string):Promise<unknown>;
}
@Injectable()
export class FulfillmentAfterSales {
 private reader?:FulfillmentAfterSaleReader;
 register(reader:FulfillmentAfterSaleReader){if(this.reader||typeof reader?.hasActive!=='function'||typeof reader?.sourceBelongs!=='function'||typeof reader?.sourceActive!=='function')throw new Error('售后履约查询器重复或不完整');this.reader=reader;}
 private async installed(tx:Prisma.TransactionClient){const [r]=await tx.$queryRaw<{name:string|null}[]>`SELECT to_regclass('public.after_sale')::text AS name`;if(r?.name&&!this.reader)throw new OrderError('AFTER_SALE_READER_REQUIRED');}
 async hasActive(tx:Prisma.TransactionClient,id:string){await this.installed(tx);return this.reader?this.reader.hasActive(tx,id):false;}
 async sourceBelongs(tx:Prisma.TransactionClient,id:string,sourceId:string){await this.installed(tx);return this.reader?this.reader.sourceBelongs(tx,id,sourceId):false;}
 async sourceActive(tx:Prisma.TransactionClient,id:string,sourceId:string){await this.installed(tx);return this.reader?this.reader.sourceActive(tx,id,sourceId):false;}
 async physicalCheckStartedAt(tx:Prisma.TransactionClient,id:string){await this.installed(tx);return this.reader?.physicalCheckStartedAt?.(tx,id)??null;}
 async handoverRecorded(tx:Prisma.TransactionClient,id:string,requestId:string){await this.installed(tx);return this.reader?.handoverRecorded?.(tx,id,requestId);}
}
