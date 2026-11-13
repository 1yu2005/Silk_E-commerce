// 作用：将商品真实聚合接入文件和状态历史；调用方先持员工及商品锁，适配器不反向取得新锁。
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { FileBusinessAdapters } from '../files/file-business-adapters.js';
import { FileError } from '../files/file.errors.js';
import { BusinessRecordAdapters } from '../records/business-record-adapters.js';
import { RecordInputError } from '../records/record-support.js';
@Injectable()
export class CatalogAdapters implements OnModuleInit {
  constructor(@Inject(FileBusinessAdapters) private readonly files:FileBusinessAdapters,
    @Inject(BusinessRecordAdapters) private readonly records:BusinessRecordAdapters){}
  onModuleInit(){
    this.files.register({ownerType:'PRODUCT',async aggregate(tx,target){
      if(!await tx.product.count({where:{id:target.ownerId}}))throw new FileError('FILE_NOT_FOUND');return 'PRODUCT:'+target.ownerId;
    },async authorize(tx,actor,target,mode){
      if(actor.subjectType!=='EMPLOYEE'||actor.mustChangePassword||!actor.effectivePermissions.includes(mode==='BIND'?'product.manage':'product.read')
        ||!['main','gallery'].includes(target.slot)||target.audience!=='PUBLIC')throw new FileError('FILE_NOT_FOUND');
      const product=await tx.product.findUnique({where:{id:target.ownerId}});
      if(!product)throw new FileError('FILE_NOT_FOUND');if(mode==='BIND'&&product.archivedAt)throw new FileError('FILE_NOT_BINDABLE');
    }});
    this.records.registerStateHistory({aggregateType:'PRODUCT',async lockAndValidate(tx,actor,t){
      const product=await tx.product.findUnique({where:{id:t.aggregateId}});
      if(actor.type!=='EMPLOYEE'||!product||product.updatedById!==actor.id||!t.reason)throw new RecordInputError();
      if(t.dimension==='sales'){
        if(!['DRAFT','ON_SALE','OFF_SALE'].includes(t.fromState??'')||t.toState!==product.status)throw new RecordInputError();
      }else if(/^sku:[0-9a-f-]{36}$/.test(t.dimension)){
        const sku=await tx.sku.findFirst({where:{id:t.dimension.slice(4),productId:product.id}});
        if(!sku||!['ENABLED','DISABLED'].includes(t.fromState??'')||t.toState!==(sku.enabled?'ENABLED':'DISABLED'))throw new RecordInputError();
      }else throw new RecordInputError();
    }});
  }
}
