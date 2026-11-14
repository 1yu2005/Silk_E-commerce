// 作用：在业务调用方事务中按文件ID排序加锁，验证用途/所有权/聚合并追加历史引用，与清理互斥。
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { requireSessionTransaction } from '../auth/session-support.js';
import { FileAccessService, type FileAccess } from './file-access.service.js';
import { FileBusinessAdapters, type FileTarget } from './file-business-adapters.js';
import { FileError, fileId } from './file.errors.js';
import { ownerPolicies, uploadedBy } from './file-policy.js';

export interface FileBinding extends FileTarget { fileIds: string[]; commandKey: string }
export async function fileNow(tx: Prisma.TransactionClient) {
  const [row] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  if (!row) throw new Error('无法读取文件事务时间');
  return row.now;
}
@Injectable()
export class FileBindingService {
  constructor(@Inject(FileAccessService) private readonly access: FileAccessService,
    @Inject(FileBusinessAdapters) private readonly adapters: FileBusinessAdapters) {}
  async bindFiles(tx: Prisma.TransactionClient, access: FileAccess, input: FileBinding) {
    requireSessionTransaction(tx);
    const policy = Object.hasOwn(ownerPolicies, input.ownerType) ? ownerPolicies[input.ownerType] : undefined;
    if (!policy || !policy.slots.includes(input.slot) || !['PUBLIC', 'CUSTOMER_VISIBLE', 'INTERNAL'].includes(input.audience)
      || (input.audience === 'PUBLIC') !== policy.public || !Array.isArray(input.fileIds) || !input.fileIds.length
      || input.fileIds.length > policy.max || typeof input.commandKey !== 'string' || !input.commandKey.trim() || input.commandKey.length > 150) {
      throw new FileError('FILE_INVALID_BINDING');
    }
    const ids = input.fileIds.map(fileId);
    if (new Set(ids).size !== ids.length) throw new FileError('FILE_INVALID_BINDING');
    const target: FileTarget = { ownerType: input.ownerType, ownerId: fileId(input.ownerId), slot: input.slot, audience: input.audience };
    const actor = await this.access.current(tx, access);
    const adapter = this.adapters.get(target.ownerType);
    await adapter.authorize(tx, actor, target, 'BIND');
    const aggregate = await adapter.aggregate(tx, target);
    if (!aggregate) throw new FileError('FILE_BUSINESS_NOT_READY');
    // 沟通是不可变的一次记录，可数全部引用；商品历史图不计入当前轮播上限，交给商品领域检查当前集合。
    if (target.ownerType === 'COMMUNICATION') {
      const existing = await tx.fileReference.findMany({ where: { ownerType: target.ownerType, ownerId: target.ownerId }, select: { fileAssetId: true } });
      if (new Set([...existing.map(row => row.fileAssetId), ...ids]).size > policy.max) throw new FileError('FILE_INVALID_BINDING');
    }
    // 业务锁由解析器持有，所有文件锁最后按固定升序取得。领域命令负责完整材料集合上限。
    await tx.$queryRaw(Prisma.sql`SELECT id FROM file_asset WHERE id IN (${Prisma.join([...ids].sort().map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`);
    const now = await fileNow(tx); const result = [];
    for (const id of ids) {
      const asset = await tx.fileAsset.findUnique({ where: { id }, include: { references: true } });
      if (!asset || (asset.state === 'STAGED' && !uploadedBy(asset, actor))) throw new FileError('FILE_NOT_FOUND');
      if (asset.purpose !== policy.purpose) throw new FileError('FILE_PURPOSE_MISMATCH');
      if (!['STAGED', 'RETAINED'].includes(asset.state)
        || (asset.state === 'STAGED' && (!asset.expiresAt || asset.expiresAt <= now))) throw new FileError('FILE_NOT_BINDABLE');
      if (target.ownerType === 'CUSTOMER_AVATAR' && !uploadedBy(asset, actor)) throw new FileError('FILE_NOT_FOUND');
      if (target.ownerType === 'PRODUCT' && asset.state === 'RETAINED'
        && !asset.references.some(ref=>ref.ownerType==='PRODUCT'&&ref.ownerId===target.ownerId)) throw new FileError('FILE_NOT_BINDABLE');
      for (const reference of asset.references) {
        const previous = await this.adapters.get(reference.ownerType).aggregate(tx, reference);
        // 订单只读快照引用不改变原PRODUCT聚合归属，也不妨碍该商品后续维护原图。
        if (reference.ownerType==='ORDER_ITEM' && target.ownerType==='PRODUCT') {
          const item=await tx.orderItem.findUnique({where:{id:reference.ownerId},select:{productId:true,imageAssetId:true}});
          if(item?.productId===target.ownerId&&item.imageAssetId===id)continue;
        }
        if (previous !== aggregate) throw new FileError('FILE_NOT_BINDABLE');
      }
      const existing = asset.references.find(ref => ref.ownerType === target.ownerType && ref.ownerId === target.ownerId && ref.slot === target.slot);
      if (existing && existing.audience !== target.audience) throw new FileError('FILE_NOT_BINDABLE');
      const reference = existing ?? await tx.fileReference.create({ data: { ...target, fileAssetId: id,
        createdByType: actor.subjectType, createdByEmployeeId: actor.subjectType === 'EMPLOYEE' ? actor.subjectId : null,
        createdByCustomerId: actor.subjectType === 'CUSTOMER' ? actor.subjectId : null } });
      if (asset.state === 'STAGED') await tx.fileAsset.update({ where: { id }, data: { state: 'RETAINED', expiresAt: null,
        visibility: policy.public ? 'PUBLIC' : 'PRIVATE', version: { increment: 1 } } });
      result.push({ id: reference.id, fileId: id, audience: reference.audience });
    }
    // commandKey由领域幂等命令持有；本表以引用唯一键防重复，不假装保存/校验完整业务请求指纹。
    return result;
  }
  /** 仅可信建单事务调用；不接受HTTP文件ID，按真实订单行验证原商品已保留的公开图片。 */
  async retainOrderImage(tx:Prisma.TransactionClient,orderItemId:string){
    requireSessionTransaction(tx);
    const item=await tx.orderItem.findUniqueOrThrow({where:{id:orderItemId}});if(!item.imageAssetId)return;
    await tx.$queryRaw`SELECT id FROM file_asset WHERE id=${item.imageAssetId}::uuid FOR UPDATE`;
    const asset=await tx.fileAsset.findUnique({where:{id:item.imageAssetId},include:{references:true}});
    if(!asset||asset.purpose!=='PRODUCT_IMAGE'||asset.state!=='RETAINED'||asset.visibility!=='PUBLIC'
      ||!asset.references.some(r=>r.ownerType==='PRODUCT'&&r.ownerId===item.productId))throw new FileError('FILE_NOT_BINDABLE');
    const order=await tx.order.findUniqueOrThrow({where:{id:item.orderId},select:{customerId:true}});
    await tx.fileReference.create({data:{fileAssetId:asset.id,ownerType:'ORDER_ITEM',ownerId:item.id,slot:'snapshot',audience:'PUBLIC',createdByType:'CUSTOMER',createdByCustomerId:order.customerId}});
  }
}
