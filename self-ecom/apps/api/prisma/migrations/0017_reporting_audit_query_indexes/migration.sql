-- 板块14：仅新增审计检索投影与范围查询索引，不重写已有业务或审计事实。
CREATE TYPE "AuditBusinessType" AS ENUM ('ORDER','AFTER_SALE','REFUND','INVENTORY_ADJUSTMENT','OFFLINE_CASE');
CREATE TABLE "audit_business_reference" (
  "audit_log_id" UUID NOT NULL,
  "business_type" "AuditBusinessType" NOT NULL,
  "business_id" VARCHAR(100) NOT NULL,
  "business_no" VARCHAR(100),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_business_reference_pkey" PRIMARY KEY ("audit_log_id","business_type","business_id"),
  CONSTRAINT "audit_business_reference_audit_log_id_fkey" FOREIGN KEY ("audit_log_id") REFERENCES "audit_log"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "audit_business_reference_business_id_check" CHECK (length(btrim("business_id")) > 0),
  CONSTRAINT "audit_business_reference_business_no_check" CHECK ("business_no" IS NULL OR length(btrim("business_no")) > 0)
);
CREATE INDEX "audit_business_reference_number_idx" ON "audit_business_reference"("business_type","business_no","audit_log_id");
CREATE INDEX "audit_business_reference_object_idx" ON "audit_business_reference"("business_type","business_id","audit_log_id");
CREATE INDEX "audit_log_created_id_idx" ON "audit_log"("created_at" DESC,"id" DESC);
CREATE INDEX "audit_log_actor_employee_created_id_idx" ON "audit_log"("actor_type","actor_employee_id","created_at" DESC,"id" DESC);
CREATE INDEX "audit_log_customer_created_id_idx" ON "audit_log"("actor_customer_id","created_at" DESC,"id" DESC);
CREATE INDEX "order_created_id_idx" ON "order"("created_at","id");
CREATE INDEX "order_customer_status_id_idx" ON "order"("customer_id","status","id");
-- Prisma暂不表示INCLUDE/部分索引，由本迁移维护；复用payment/customer既有日期索引。
CREATE INDEX "order_item_order_product_quantity_idx" ON "order_item"("order_id","product_id") INCLUDE ("quantity");
CREATE INDEX "refund_succeeded_order_amount_idx" ON "refund"("succeeded_at","order_id") INCLUDE ("amount_cents") WHERE "status"='SUCCEEDED';
