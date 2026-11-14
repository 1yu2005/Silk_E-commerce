// 作用：合法UUID的大小写不改变更正根身份，避免查到原根后因字符串比较失配而返回500。
import 'reflect-metadata';
import { expect, it, vi } from 'vitest';
import type { InventoryAdjustment, Prisma } from '@prisma/client';
import { InventoryAdjustments } from '../src/inventory/inventory-adjustment.service.js';
import type { InventoryContext } from '../src/inventory/inventory-access.service.js';

const rootId='abcdefab-cdef-4abc-8def-abcdefabcdef';
const skuId='12345678-abcd-4abc-8def-abcdefabcdef';
const sourceLineId='87654321-abcd-4abc-8def-abcdefabcdef';

function fixture(){
 const root={id:rootId,skuId,sourceLineId,adjustmentId:'original'};
 const tx={inventoryAdjustmentLine:{findMany:vi.fn().mockResolvedValue([root])},sku:{findMany:vi.fn().mockResolvedValue([{id:skuId,productId:'product'}])},$queryRaw:vi.fn().mockResolvedValue([])};
 const db={$transaction:async(work:(client:Prisma.TransactionClient)=>Promise<unknown>)=>work(tx as unknown as Prisma.TransactionClient)};
 const access={actor:vi.fn().mockResolvedValue({subjectId:'employee'})};
 const service=Reflect.construct(InventoryAdjustments,[db,access]) as InventoryAdjustments;
 const create=vi.spyOn(service,'createInTransaction').mockResolvedValue({id:'correction'} as InventoryAdjustment);
 return {service,create};
}
const ctx={} as InventoryContext;

it.each([rootId,rootId.toUpperCase()])('更正使用同一根UUID %s，传入后续领域校验的身份保持数据库规范值',async id=>{
 const {service,create}=fixture();
 await expect(service.corrections(ctx,'original',{reason:'核实差额',evidenceNote:'独立回归',lines:[{rootLineId:id,signedDeltaA:-1}]})).resolves.toEqual({id:'correction',changed:true});
 expect(create.mock.calls[0]![6]).toEqual([{skuId,sourceLineId,rootLineId:rootId,signedDeltaA:-1}]);
});

it('同一更正根大小写混用仍作为重复目标拒绝，不创建任何登记',async()=>{
 const {service,create}=fixture();
 await expect(service.corrections(ctx,'original',{reason:'重复目标',evidenceNote:'独立回归',lines:[{rootLineId:rootId,signedDeltaA:-1},{rootLineId:rootId.toUpperCase(),signedDeltaA:-1}]})).rejects.toMatchObject({code:'CORRECTION_NOT_ALLOWED'});
 expect(create).not.toHaveBeenCalled();
});
