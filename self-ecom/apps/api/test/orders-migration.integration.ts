// 作用：只在本轮随机独占库核查增量迁移、约束与历史保护；不改旧数据库。
import {afterAll,expect,it} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
if(process.env.NODE_ENV!=='test'||!/^\/m(?:108|210)_[a-f0-9]{32}_test$/.test(new URL(process.env.DATABASE_URL!).pathname))throw new Error('只允许本轮独占数据库');
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
afterAll(async()=>{await db.$disconnect();});
it('0001～0014全新部署成功，真实订单与支付表和外键存在',async()=>{const migrations=await db.$queryRaw<{migration_name:string;finished_at:Date|null}[]>`SELECT migration_name,finished_at FROM _prisma_migrations ORDER BY migration_name`;expect(migrations).toHaveLength(14);expect(migrations.at(-1)?.migration_name).toBe('0014_after_sales_review_material_return');expect(migrations.every(m=>m.finished_at!==null)).toBe(true);
 const [r]=await db.$queryRaw<{orders:boolean;payments:boolean;sources:boolean}[]>`SELECT to_regclass('public.order') IS NOT NULL AS orders,to_regclass('public.payment') IS NOT NULL AS payments,to_regclass('public.task_business_source') IS NOT NULL AS sources`;expect(r).toEqual({orders:true,payments:true,sources:true});
 const foreign=await db.$queryRaw<{target:string}[]>`SELECT confrelid::regclass::text AS target FROM pg_constraint WHERE conrelid='public.order_item'::regclass AND contype='f'`;expect(foreign.map(f=>f.target).sort()).toEqual(['file_asset','"order"','product','sku'].sort());
});
it('订单快照、支付事实与补齐历史有不可变触发器，期限和金额有CHECK',async()=>{const checks=await db.$queryRaw<{name:string}[]>`SELECT conname AS name FROM pg_constraint WHERE conrelid IN ('public.order'::regclass,'public.order_item'::regclass,'public.payment'::regclass,'public.stock_replenishment'::regclass) AND contype='c'`;expect(checks.length).toBeGreaterThanOrEqual(8);
 const triggers=await db.$queryRaw<{name:string}[]>`SELECT tgname AS name FROM pg_trigger WHERE tgrelid IN ('public.order'::regclass,'public.order_item'::regclass,'public.payment'::regclass,'public.stock_replenishment'::regclass) AND NOT tgisinternal`;expect(triggers.length).toBeGreaterThanOrEqual(4);
});
