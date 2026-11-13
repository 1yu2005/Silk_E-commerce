-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'ON_SALE', 'OFF_SALE');

-- CreateEnum
CREATE TYPE "InitialInventoryDraftStatus" AS ENUM ('EDITABLE', 'CONVERTED', 'VOID');

-- AlterEnum
ALTER TYPE "BusinessAggregateType" ADD VALUE 'PRODUCT';

-- CreateTable
CREATE TABLE "category" (
    "id" UUID NOT NULL,
    "parent_id" UUID,
    "name" VARCHAR(50) NOT NULL,
    "name_key" VARCHAR(100) NOT NULL,
    "icon_key" VARCHAR(50),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "depth" SMALLINT NOT NULL,
    "path_ids" UUID[],
    "version" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" UUID NOT NULL,
    "product_code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "brand" VARCHAR(80),
    "description" TEXT,
    "category_id" UUID,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "archived_at" TIMESTAMPTZ(3),
    "paid_sales_count" BIGINT NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_image" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "slot" VARCHAR(10) NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_image_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_spec_dimension" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" VARCHAR(30) NOT NULL,
    "name_key" VARCHAR(100) NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "retired_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_spec_dimension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_spec_value" (
    "id" UUID NOT NULL,
    "dimension_id" UUID NOT NULL,
    "name" VARCHAR(30) NOT NULL,
    "name_key" VARCHAR(100) NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "retired_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_spec_value_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sku" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "combination_signature" VARCHAR(64) NOT NULL,
    "price_cents" INTEGER,
    "cost_cents" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "retired_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sku_spec_choice" (
    "sku_id" UUID NOT NULL,
    "dimension_id" UUID NOT NULL,
    "value_id" UUID NOT NULL,

    CONSTRAINT "sku_spec_choice_pkey" PRIMARY KEY ("sku_id","dimension_id")
);

-- CreateTable
CREATE TABLE "inventory_balance" (
    "sku_id" UUID NOT NULL,
    "available" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "warning_threshold" INTEGER NOT NULL DEFAULT 10,
    "purchase_blocked" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inventory_balance_pkey" PRIMARY KEY ("sku_id")
);

-- CreateTable
CREATE TABLE "initial_inventory_draft" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "conversion_key" UUID NOT NULL,
    "status" "InitialInventoryDraftStatus" NOT NULL DEFAULT 'EDITABLE',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "initial_inventory_draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "initial_inventory_draft_line" (
    "draft_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "initial_inventory_draft_line_pkey" PRIMARY KEY ("draft_id","sku_id")
);

-- CreateIndex
CREATE INDEX "category_parent_id_sort_order_id_idx" ON "category"("parent_id", "sort_order", "id");

-- CreateIndex
CREATE UNIQUE INDEX "product_product_code_key" ON "product"("product_code");

-- CreateIndex
CREATE INDEX "product_status_archived_at_created_at_id_idx" ON "product"("status", "archived_at", "created_at", "id");

-- CreateIndex
CREATE INDEX "product_category_id_idx" ON "product"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_image_product_id_slot_sort_order_key" ON "product_image"("product_id", "slot", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "product_image_product_id_slot_asset_id_key" ON "product_image"("product_id", "slot", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_spec_value_id_dimension_id_key" ON "product_spec_value"("id", "dimension_id");

-- CreateIndex
CREATE UNIQUE INDEX "sku_code_key" ON "sku"("code");

-- CreateIndex
CREATE UNIQUE INDEX "sku_product_id_combination_signature_key" ON "sku"("product_id", "combination_signature");

-- CreateIndex
CREATE UNIQUE INDEX "initial_inventory_draft_conversion_key_key" ON "initial_inventory_draft"("conversion_key");

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_image" ADD CONSTRAINT "product_image_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_image" ADD CONSTRAINT "product_image_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "file_asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_spec_dimension" ADD CONSTRAINT "product_spec_dimension_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_spec_value" ADD CONSTRAINT "product_spec_value_dimension_id_fkey" FOREIGN KEY ("dimension_id") REFERENCES "product_spec_dimension"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sku" ADD CONSTRAINT "sku_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sku_spec_choice" ADD CONSTRAINT "sku_spec_choice_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sku_spec_choice" ADD CONSTRAINT "sku_spec_choice_dimension_id_fkey" FOREIGN KEY ("dimension_id") REFERENCES "product_spec_dimension"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sku_spec_choice" ADD CONSTRAINT "sku_spec_choice_value_id_dimension_id_fkey" FOREIGN KEY ("value_id", "dimension_id") REFERENCES "product_spec_value"("id", "dimension_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_balance" ADD CONSTRAINT "inventory_balance_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "initial_inventory_draft" ADD CONSTRAINT "initial_inventory_draft_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "initial_inventory_draft_line" ADD CONSTRAINT "initial_inventory_draft_line_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "initial_inventory_draft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "initial_inventory_draft_line" ADD CONSTRAINT "initial_inventory_draft_line_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 作用：补齐分类、商品、SKU和非记账草稿的数据库底线；不改变任何已有业务数量。
INSERT INTO system_guard(key) VALUES ('CATEGORY_TREE') ON CONFLICT DO NOTHING;

-- Prisma不能表达的部分唯一索引、边界和跨聚合约束在本增量内保存。
CREATE UNIQUE INDEX category_root_name_key ON category(name_key) WHERE parent_id IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX category_parent_name_key ON category(parent_id,name_key) WHERE parent_id IS NOT NULL AND deleted_at IS NULL;
ALTER TABLE category ALTER COLUMN path_ids SET NOT NULL;
ALTER TABLE category ADD CONSTRAINT category_values CHECK (depth BETWEEN 1 AND 3 AND array_ndims(path_ids)=1 AND array_lower(path_ids,1)=1 AND array_position(path_ids,NULL) IS NULL AND cardinality(path_ids)=depth AND path_ids[depth]=id AND array_position(path_ids,id)=depth AND (depth<3 OR path_ids[1]<>path_ids[2]) AND ((parent_id IS NULL AND depth=1) OR (parent_id IS NOT NULL AND depth>1 AND parent_id<>id AND path_ids[depth-1]=parent_id)) AND sort_order BETWEEN 0 AND 1000000 AND version>=0 AND char_length(btrim(name)) BETWEEN 1 AND 50);
ALTER TABLE product ADD CONSTRAINT product_values CHECK (version>=0 AND paid_sales_count>=0 AND char_length(btrim(name)) BETWEEN 1 AND 120 AND (description IS NULL OR char_length(description)<=20000) AND (archived_at IS NULL OR status<>'ON_SALE'));
ALTER TABLE product ADD CONSTRAINT product_creator_fk FOREIGN KEY(created_by_id) REFERENCES employee(id) ON DELETE RESTRICT;
ALTER TABLE product ADD CONSTRAINT product_updater_fk FOREIGN KEY(updated_by_id) REFERENCES employee(id) ON DELETE RESTRICT;
ALTER TABLE product_image ADD CONSTRAINT product_image_slot CHECK ((slot='MAIN' AND sort_order=0) OR (slot='GALLERY' AND sort_order BETWEEN 0 AND 9));
CREATE UNIQUE INDEX product_main_image ON product_image(product_id) WHERE slot='MAIN';
CREATE UNIQUE INDEX dimension_current_name ON product_spec_dimension(product_id,name_key) WHERE retired_at IS NULL;
CREATE UNIQUE INDEX dimension_current_sort ON product_spec_dimension(product_id,sort_order) WHERE retired_at IS NULL;
CREATE UNIQUE INDEX value_current_name ON product_spec_value(dimension_id,name_key) WHERE retired_at IS NULL;
CREATE UNIQUE INDEX value_current_sort ON product_spec_value(dimension_id,sort_order) WHERE retired_at IS NULL;
ALTER TABLE product_spec_dimension ADD CONSTRAINT dimension_values CHECK (sort_order BETWEEN 0 AND 2 AND char_length(btrim(name)) BETWEEN 1 AND 30);
ALTER TABLE product_spec_value ADD CONSTRAINT spec_value_values CHECK (sort_order BETWEEN 0 AND 19 AND char_length(btrim(name)) BETWEEN 1 AND 30);
ALTER TABLE sku ADD CONSTRAINT sku_values CHECK ((price_cents IS NULL OR price_cents BETWEEN 1 AND 1000000) AND (cost_cents IS NULL OR cost_cents BETWEEN 0 AND 1000000) AND code ~ '^[A-Z0-9_-]{1,64}$' AND (combination_signature='DEFAULT' OR combination_signature ~ '^[a-f0-9]{64}$') AND (retired_at IS NULL OR NOT enabled));
ALTER TABLE inventory_balance ADD CONSTRAINT inventory_balance_values CHECK (available>=0 AND reserved>=0 AND warning_threshold>=0 AND version>=0);
CREATE UNIQUE INDEX initial_inventory_editable ON initial_inventory_draft(product_id) WHERE status='EDITABLE';
ALTER TABLE initial_inventory_draft ADD CONSTRAINT initial_draft_version CHECK(version>=0);
ALTER TABLE initial_inventory_draft ADD CONSTRAINT initial_draft_creator_fk FOREIGN KEY(created_by_id) REFERENCES employee(id) ON DELETE RESTRICT;
ALTER TABLE initial_inventory_draft_line ADD CONSTRAINT initial_draft_quantity CHECK(quantity>=0);
-- SKU与维度、草稿与SKU必须同属商品；触发器提供直接SQL写入的底线，服务仍须持商品锁。
CREATE FUNCTION validate_catalog_relation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='sku_spec_choice' THEN
  IF (SELECT product_id FROM sku WHERE id=NEW.sku_id) IS DISTINCT FROM (SELECT product_id FROM product_spec_dimension WHERE id=NEW.dimension_id) THEN RAISE EXCEPTION 'SKU dimension product mismatch' USING ERRCODE='23514'; END IF;
 ELSE
  IF (SELECT product_id FROM sku WHERE id=NEW.sku_id) IS DISTINCT FROM (SELECT product_id FROM initial_inventory_draft WHERE id=NEW.draft_id) THEN RAISE EXCEPTION 'Draft SKU product mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sku_choice_product BEFORE INSERT OR UPDATE ON sku_spec_choice FOR EACH ROW EXECUTE FUNCTION validate_catalog_relation();
CREATE TRIGGER initial_draft_product BEFORE INSERT OR UPDATE ON initial_inventory_draft_line FOR EACH ROW EXECUTE FUNCTION validate_catalog_relation();
