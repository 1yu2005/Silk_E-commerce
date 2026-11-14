// 作用：后续领域安装后缺真实读取器或查询失败，均拒绝关闭。
import {Inject,Injectable,type OnApplicationBootstrap} from '@nestjs/common';
import type {Prisma} from '@prisma/client';
import {PrismaService} from '../prisma/prisma.service.js';
import {AfterSaleError} from './after-sale.rules.js';
export interface AfterSaleCloseFactsReader{read(tx:Prisma.TransactionClient,id:string):Promise<{received:boolean;finalInspection:boolean;restocked:boolean;refundAttempt:boolean}>;}
@Injectable()
export class AfterSaleCloseFacts implements OnApplicationBootstrap{
 private reader?:AfterSaleCloseFactsReader;
 constructor(@Inject(PrismaService)private readonly db:PrismaService){}
 register(reader:AfterSaleCloseFactsReader){if(this.reader||typeof reader?.read!=='function')throw new Error('售后关闭事实读取器不完整或重复');this.reader=reader;}
 private async installed(tx:Prisma.TransactionClient){const [r]=await tx.$queryRaw<{installed:boolean}[]>`SELECT EXISTS(SELECT 1 FROM unnest(ARRAY['return_receipt','final_inspection','refund','refund_attempt','unshipped_physical_check']) n WHERE to_regclass('public.'||n) IS NOT NULL) AS installed`;if(r?.installed&&!this.reader)throw new AfterSaleError('AFTER_SALE_CLOSE_FACTS_REQUIRED');return r?.installed??false;}
 async onApplicationBootstrap(){await this.db.$transaction(tx=>this.installed(tx));}
 async read(tx:Prisma.TransactionClient,id:string){await this.installed(tx);if(!this.reader)return {received:false,finalInspection:false,restocked:false,refundAttempt:false};try{const facts=await this.reader.read(tx,id);if(!facts||['received','finalInspection','restocked','refundAttempt'].some(k=>typeof facts[k as keyof typeof facts]!=='boolean'))throw new Error('incomplete facts');return facts;}catch{throw new AfterSaleError('AFTER_SALE_CLOSE_FACTS_REQUIRED');}}
}
