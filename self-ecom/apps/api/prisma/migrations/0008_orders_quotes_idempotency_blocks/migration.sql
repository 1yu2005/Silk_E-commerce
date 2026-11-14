-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FileOwnerType" ADD VALUE 'ORDER_ITEM';

ALTER TYPE "FileOwnerType" ADD VALUE 'STOCK_INCIDENT';

-- CreateTable
CREATE TABLE "checkout_quote" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "address_id_snapshot" UUID NOT NULL,
    "address_version" INTEGER NOT NULL,
    "address_snapshot" JSONB NOT NULL,
    "setting_version_id" UUID NOT NULL,
    "pricing_rule_snapshot" JSONB NOT NULL,
    "goods_amount_cents" INTEGER NOT NULL,
    "shipping_fee_cents" INTEGER NOT NULL,
    "payable_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "checkout_quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_quote_item" (
    "id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "cart_item_id_snapshot" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "line_amount_cents" INTEGER NOT NULL,

    CONSTRAINT "checkout_quote_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order" (
    "id" UUID NOT NULL,
    "number" VARCHAR(64) NOT NULL,
    "customer_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "source_address_id" UUID,
    "status" VARCHAR(30) NOT NULL DEFAULT 'WAIT_PAYMENT',
    "fulfillment_stage" VARCHAR(30) NOT NULL DEFAULT 'UNCLAIMED',
    "goods_amount_cents" INTEGER NOT NULL,
    "shipping_fee_cents" INTEGER NOT NULL,
    "payable_cents" INTEGER NOT NULL,
    "receiver" VARCHAR(40) NOT NULL,
    "phone" VARCHAR(30) NOT NULL,
    "province" VARCHAR(50) NOT NULL,
    "city" VARCHAR(50) NOT NULL,
    "district" VARCHAR(50) NOT NULL,
    "detail" VARCHAR(200) NOT NULL,
    "shipping_rule_snapshot" JSONB NOT NULL,
    "payment_rule_snapshot" JSONB NOT NULL,
    "setting_version_id" UUID NOT NULL,
    "payment_deadline" TIMESTAMPTZ(3) NOT NULL,
    "paid_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "close_reason_code" VARCHAR(40),
    "close_reason" VARCHAR(500),
    "closed_by_type" VARCHAR(20),
    "closed_by_id" UUID,
    "payment_blocked" BOOLEAN NOT NULL DEFAULT false,
    "release_blocked" BOOLEAN NOT NULL DEFAULT false,
    "stock_physical_version" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "timer_version" INTEGER NOT NULL DEFAULT 0,
    "auto_receipt_days" INTEGER NOT NULL DEFAULT 10,
    "actual_handover_at" TIMESTAMPTZ(3),
    "auto_receipt_base_due_at" TIMESTAMPTZ(3),
    "auto_receipt_due_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "after_sale_deadline" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "order_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "order_item" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_name_snapshot" VARCHAR(200) NOT NULL,
    "product_code_snapshot" VARCHAR(64) NOT NULL,
    "sku_code_snapshot" VARCHAR(64) NOT NULL,
    "spec_snapshot" JSONB NOT NULL,
    "image_asset_id" UUID,
    "unit_price_cents" INTEGER NOT NULL,
    "unit_cost_cents" INTEGER,
    "quantity" INTEGER NOT NULL,
    "line_amount_cents" INTEGER NOT NULL,
    "damaged_reserved_quantity" INTEGER NOT NULL DEFAULT 0,
    "damage_unknown" BOOLEAN NOT NULL DEFAULT false,
    "physical_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "order_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_record" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "action_code" VARCHAR(40) NOT NULL DEFAULT 'CREATE_ORDER',
    "key" VARCHAR(128) NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "result_order_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "idempotency_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_block" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "source_type" VARCHAR(40) NOT NULL,
    "source_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "blocks_shipment" BOOLEAN NOT NULL DEFAULT true,
    "blocks_receipt" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMPTZ(3),
    "release_command_key" VARCHAR(150),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "order_block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timer_pause" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "cycle_no" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "paused_at" TIMESTAMPTZ(3) NOT NULL,
    "remaining_ms" BIGINT NOT NULL,
    "base_due_at" TIMESTAMPTZ(3) NOT NULL,
    "resumed_at" TIMESTAMPTZ(3),
    "new_due_at" TIMESTAMPTZ(3),
    "end_reason" VARCHAR(500),

    CONSTRAINT "timer_pause_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_timer_receipt" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "key" VARCHAR(150) NOT NULL,
    "signature" TEXT NOT NULL,

    CONSTRAINT "order_timer_receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_business_source" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "source_type" VARCHAR(40) NOT NULL,
    "source_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "add_command_key" VARCHAR(150) NOT NULL,
    "add_reason" VARCHAR(500) NOT NULL,
    "add_actor_key" VARCHAR(80) NOT NULL,
    "resolution_command_key" VARCHAR(150),
    "resolution_reason" VARCHAR(500),
    "resolution_actor_key" VARCHAR(80),
    "resolution_outcome" VARCHAR(20),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),

    CONSTRAINT "task_business_source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_business_source_history" (
    "id" UUID NOT NULL,
    "source_record_id" UUID NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "command_key" VARCHAR(150) NOT NULL,
    "actor_key" VARCHAR(80) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "request_id" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_business_source_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "checkout_quote_customer_id_created_at_idx" ON "checkout_quote"("customer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "checkout_quote_item_quote_id_sku_id_key" ON "checkout_quote_item"("quote_id", "sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "checkout_quote_item_quote_id_cart_item_id_snapshot_key" ON "checkout_quote_item"("quote_id", "cart_item_id_snapshot");

-- CreateIndex
CREATE UNIQUE INDEX "order_number_key" ON "order"("number");

-- CreateIndex
CREATE INDEX "order_customer_id_created_at_id_idx" ON "order"("customer_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "order_item_sku_id_idx" ON "order_item"("sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_item_order_id_sku_id_key" ON "order_item"("order_id", "sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_record_result_order_id_key" ON "idempotency_record"("result_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_record_customer_id_action_code_key_key" ON "idempotency_record"("customer_id", "action_code", "key");

-- CreateIndex
CREATE UNIQUE INDEX "order_block_order_id_type_source_type_source_id_key" ON "order_block"("order_id", "type", "source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "timer_pause_order_id_cycle_no_key" ON "timer_pause"("order_id", "cycle_no");

-- CreateIndex
CREATE UNIQUE INDEX "order_timer_receipt_order_id_key_key" ON "order_timer_receipt"("order_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "task_business_source_task_id_source_type_source_id_key" ON "task_business_source"("task_id", "source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_business_source_history_source_record_id_action_comman_key" ON "task_business_source_history"("source_record_id", "action", "command_key");

-- AddForeignKey
ALTER TABLE "checkout_quote_item" ADD CONSTRAINT "checkout_quote_item_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "checkout_quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "checkout_quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_block" ADD CONSTRAINT "order_block_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timer_pause" ADD CONSTRAINT "timer_pause_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_timer_receipt" ADD CONSTRAINT "order_timer_receipt_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- 真实旧实体外键与服务之外的数据库底线。
ALTER TABLE checkout_quote ADD FOREIGN KEY(customer_id) REFERENCES customer(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(setting_version_id) REFERENCES store_setting_version(id) ON DELETE RESTRICT,
 ADD CHECK(address_version>=0 AND expires_at>created_at),
 ADD CHECK(goods_amount_cents BETWEEN 1 AND 100000000 AND shipping_fee_cents BETWEEN 0 AND 1000000 AND payable_cents BETWEEN 1 AND 100000000 AND payable_cents::bigint=goods_amount_cents::bigint+shipping_fee_cents::bigint);
ALTER TABLE checkout_quote_item ADD FOREIGN KEY(sku_id) REFERENCES sku(id) ON DELETE RESTRICT,
 ADD CHECK(quantity BETWEEN 1 AND 99 AND unit_price_cents BETWEEN 1 AND 1000000 AND line_amount_cents::bigint=unit_price_cents::bigint*quantity);
ALTER TABLE "order" ADD FOREIGN KEY(customer_id) REFERENCES customer(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(source_address_id) REFERENCES address(id) ON DELETE SET NULL,
 ADD FOREIGN KEY(setting_version_id) REFERENCES store_setting_version(id) ON DELETE RESTRICT,
 ADD CHECK(status IN ('WAIT_PAYMENT','WAIT_SHIPMENT','SHIPPED','COMPLETED','CLOSED','REFUNDED')),
 ADD CHECK(fulfillment_stage IN ('UNCLAIMED','PREPARING','READY','HANDOVER_IN_PROGRESS','HANDOVER_UNCERTAIN','SHIPPED')),
 ADD CHECK(goods_amount_cents BETWEEN 1 AND 100000000 AND shipping_fee_cents BETWEEN 0 AND 1000000 AND payable_cents BETWEEN 1 AND 100000000 AND payable_cents::bigint=goods_amount_cents::bigint+shipping_fee_cents::bigint),
 ADD CHECK(payment_deadline>created_at AND version>=0 AND timer_version>=0 AND stock_physical_version>=0 AND auto_receipt_days BETWEEN 1 AND 365),
 ADD CHECK((status='WAIT_PAYMENT' AND paid_at IS NULL AND closed_at IS NULL) OR (status='CLOSED' AND paid_at IS NULL AND closed_at IS NOT NULL AND close_reason_code IS NOT NULL) OR (status IN ('WAIT_SHIPMENT','SHIPPED','COMPLETED','REFUNDED') AND paid_at IS NOT NULL AND closed_at IS NULL)),
 ADD CHECK(status NOT IN ('SHIPPED','COMPLETED') OR actual_handover_at IS NOT NULL),
 ADD CHECK(status<>'COMPLETED' OR completed_at IS NOT NULL);
ALTER TABLE order_item ADD FOREIGN KEY(sku_id) REFERENCES sku(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(product_id) REFERENCES product(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(image_asset_id) REFERENCES file_asset(id) ON DELETE RESTRICT,
 ADD CHECK(quantity BETWEEN 1 AND 99 AND unit_price_cents BETWEEN 1 AND 1000000 AND (unit_cost_cents IS NULL OR unit_cost_cents BETWEEN 0 AND 1000000)),
 ADD CHECK(line_amount_cents::bigint=unit_price_cents::bigint*quantity AND damaged_reserved_quantity BETWEEN 0 AND quantity AND physical_version>=0);
ALTER TABLE idempotency_record ADD FOREIGN KEY(customer_id) REFERENCES customer(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(result_order_id) REFERENCES "order"(id) ON DELETE RESTRICT,
 ADD CHECK(action_code='CREATE_ORDER' AND key ~ '^[A-Za-z0-9_-]{16,128}$' AND fingerprint ~ '^[a-f0-9]{64}$'),
 ADD CHECK((status='PENDING' AND result_order_id IS NULL AND completed_at IS NULL) OR (status='SUCCESS' AND result_order_id IS NOT NULL AND completed_at IS NOT NULL));
ALTER TABLE order_block ADD CHECK(type IN ('AFTER_SALE','SHIPMENT_EXCEPTION','HANDOVER_UNCERTAIN','ADDRESS_REQUEST','STOCK_EXCEPTION') AND type=source_type AND version>=0 AND (active=(released_at IS NULL)));
ALTER TABLE timer_pause ADD CHECK(cycle_no>0 AND remaining_ms>=0 AND status IN ('ACTIVE','RESUMED','TERMINATED')),
 ADD CHECK((status='ACTIVE' AND resumed_at IS NULL AND new_due_at IS NULL) OR (status='RESUMED' AND resumed_at IS NOT NULL AND new_due_at IS NOT NULL) OR status='TERMINATED');
CREATE UNIQUE INDEX timer_pause_one_active ON timer_pause(order_id) WHERE status='ACTIVE';
ALTER TABLE task_business_source ADD FOREIGN KEY(task_id) REFERENCES task(id) ON DELETE RESTRICT,
 ADD CHECK(source_type IN ('AFTER_SALE','SHIPMENT_EXCEPTION','STOCK_EXCEPTION','HANDOVER_UNCERTAIN','ADDRESS_REQUEST')),
 ADD CHECK((status='ACTIVE' AND ended_at IS NULL AND resolution_command_key IS NULL) OR (status IN ('RESOLVED','CANCELLED') AND ended_at IS NOT NULL AND resolution_command_key IS NOT NULL AND resolution_outcome IN ('COMPLETED','CANCELLED')));
ALTER TABLE task_business_source_history ADD FOREIGN KEY(source_record_id) REFERENCES task_business_source(id) ON DELETE RESTRICT;
CREATE TRIGGER task_source_history_immutable BEFORE UPDATE OR DELETE ON task_business_source_history FOR EACH ROW EXECUTE FUNCTION inventory_history_immutable();
CREATE TRIGGER timer_receipt_immutable BEFORE UPDATE OR DELETE ON order_timer_receipt FOR EACH ROW EXECUTE FUNCTION inventory_history_immutable();
CREATE FUNCTION order_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'orders cannot be deleted'; END IF;
 IF (to_jsonb(NEW)-ARRAY['source_address_id','status','fulfillment_stage','paid_at','closed_at','close_reason_code','close_reason','closed_by_type','closed_by_id','payment_blocked','release_blocked','stock_physical_version','version','timer_version','auto_receipt_days','actual_handover_at','auto_receipt_base_due_at','auto_receipt_due_at','completed_at','after_sale_deadline','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['source_address_id','status','fulfillment_stage','paid_at','closed_at','close_reason_code','close_reason','closed_by_type','closed_by_id','payment_blocked','release_blocked','stock_physical_version','version','timer_version','auto_receipt_days','actual_handover_at','auto_receipt_base_due_at','auto_receipt_due_at','completed_at','after_sale_deadline','updated_at']) THEN RAISE EXCEPTION 'order snapshot is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER order_snapshot_guard BEFORE UPDATE OR DELETE ON "order" FOR EACH ROW EXECUTE FUNCTION order_snapshot_immutable();
CREATE FUNCTION order_item_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'order items cannot be deleted'; END IF;
 IF (to_jsonb(NEW)-ARRAY['damaged_reserved_quantity','damage_unknown','physical_version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['damaged_reserved_quantity','damage_unknown','physical_version']) THEN RAISE EXCEPTION 'order item snapshot is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER order_item_snapshot_guard BEFORE UPDATE OR DELETE ON order_item FOR EACH ROW EXECUTE FUNCTION order_item_snapshot_immutable();
CREATE FUNCTION order_idempotency_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF OLD.status='SUCCESS' THEN RAISE EXCEPTION 'successful order result is immutable'; END IF; IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $$;
CREATE TRIGGER order_idempotency_guard BEFORE UPDATE OR DELETE ON idempotency_record FOR EACH ROW EXECUTE FUNCTION order_idempotency_immutable();

