-- CreateTable


-- CreateTable
CREATE TABLE "payment" (
    "id" UUID NOT NULL,
    "number" VARCHAR(64) NOT NULL,
    "order_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'SUCCEEDED',
    "method" VARCHAR(20) NOT NULL DEFAULT 'SIMULATED',
    "currency" CHAR(3) NOT NULL DEFAULT 'CNY',
    "paid_at" TIMESTAMPTZ(3) NOT NULL,
    "actor_customer_id" UUID NOT NULL,
    "request_id" VARCHAR(64) NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_incident" (
    "id" UUID NOT NULL,
    "incident_key" VARCHAR(128) NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "sku_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "reason" VARCHAR(500) NOT NULL,
    "evidence_note" VARCHAR(2000) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "stock_incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_incident_item" (
    "id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "allocation_type" VARCHAR(30) NOT NULL,
    "quantity_affected" INTEGER NOT NULL,
    "damaged_quantity" INTEGER,
    "verification_state" VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',
    "conclusion" VARCHAR(30),
    "version" INTEGER NOT NULL DEFAULT 0,
    "verified_by_id" UUID,
    "verified_at" TIMESTAMPTZ(3),

    CONSTRAINT "stock_incident_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_replenishment" (
    "id" UUID NOT NULL,
    "incident_item_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "inventory_action_id" UUID NOT NULL,
    "command_key" UUID NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "actor_employee_id" UUID NOT NULL,
    "goods_location" VARCHAR(500) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_replenishment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_incident_history" (
    "id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "incident_item_id" UUID,
    "action" VARCHAR(30) NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "actor_type" VARCHAR(20) NOT NULL,
    "actor_id" UUID,
    "reason" VARCHAR(500) NOT NULL,
    "command_key" VARCHAR(150) NOT NULL,
    "request_id" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_incident_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_incident_command" (
    "id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "command_key" UUID NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "action" VARCHAR(30) NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_incident_command_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_status_payment_deadline_id_idx" ON "order"("status", "payment_deadline", "id");

-- CreateIndex
CREATE INDEX "order_payment_blocked_status_idx" ON "order"("payment_blocked", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_number_key" ON "payment"("number");

-- CreateIndex
CREATE UNIQUE INDEX "payment_order_id_key" ON "payment"("order_id");

-- CreateIndex
CREATE INDEX "payment_paid_at_id_idx" ON "payment"("paid_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_incident_incident_key_key" ON "stock_incident"("incident_key");

-- CreateIndex
CREATE INDEX "stock_incident_sku_id_status_idx" ON "stock_incident"("sku_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_incident_item_incident_id_order_item_id_key" ON "stock_incident_item"("incident_id", "order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_replenishment_inventory_action_id_key" ON "stock_replenishment"("inventory_action_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_replenishment_incident_item_id_command_key_key" ON "stock_replenishment"("incident_item_id", "command_key");

-- CreateIndex
CREATE INDEX "stock_incident_history_incident_id_created_at_id_idx" ON "stock_incident_history"("incident_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_incident_command_incident_id_command_key_key" ON "stock_incident_command"("incident_id", "command_key");

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_incident_item" ADD CONSTRAINT "stock_incident_item_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "stock_incident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_incident_item" ADD CONSTRAINT "stock_incident_item_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_replenishment" ADD CONSTRAINT "stock_replenishment_incident_item_id_fkey" FOREIGN KEY ("incident_item_id") REFERENCES "stock_incident_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE payment ADD FOREIGN KEY(actor_customer_id) REFERENCES customer(id) ON DELETE RESTRICT,
 ADD CHECK(amount_cents BETWEEN 1 AND 100000000 AND status='SUCCEEDED' AND method='SIMULATED' AND currency='CNY');
CREATE TRIGGER payment_immutable BEFORE UPDATE OR DELETE ON payment FOR EACH ROW EXECUTE FUNCTION inventory_history_immutable();
ALTER TABLE stock_incident ADD FOREIGN KEY(sku_id) REFERENCES sku(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(created_by_id) REFERENCES employee(id) ON DELETE RESTRICT,
 ADD CHECK(status IN ('OPEN','RESOLVED') AND version>=0 AND (status='OPEN')=(resolved_at IS NULL) AND length(btrim(reason))>0 AND length(btrim(evidence_note))>0);
ALTER TABLE stock_incident_item ADD FOREIGN KEY(verified_by_id) REFERENCES employee(id) ON DELETE RESTRICT,
 ADD CHECK(allocation_type IN ('RESERVED','PAID_PREPARATION') AND quantity_affected BETWEEN 1 AND 99 AND version>=0),
 ADD CHECK(damaged_quantity IS NULL OR damaged_quantity BETWEEN 0 AND quantity_affected),
 ADD CHECK(verification_state IN ('UNKNOWN','CONFIRMED','REPLENISHED','SETTLED')),
 ADD CHECK(verification_state='UNKNOWN' OR (damaged_quantity IS NOT NULL AND verified_by_id IS NOT NULL AND verified_at IS NOT NULL));
ALTER TABLE stock_replenishment ADD FOREIGN KEY(order_item_id) REFERENCES order_item(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(inventory_action_id) REFERENCES inventory_action(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(actor_employee_id) REFERENCES employee(id) ON DELETE RESTRICT,
 ADD CHECK(quantity BETWEEN 1 AND 99 AND length(btrim(goods_location))>0 AND length(btrim(reason))>0);
ALTER TABLE stock_incident_history ADD FOREIGN KEY(incident_id) REFERENCES stock_incident(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(incident_item_id) REFERENCES stock_incident_item(id) ON DELETE RESTRICT;
ALTER TABLE stock_incident_command ADD FOREIGN KEY(incident_id) REFERENCES stock_incident(id) ON DELETE RESTRICT;
CREATE TRIGGER stock_replenishment_immutable BEFORE UPDATE OR DELETE ON stock_replenishment FOR EACH ROW EXECUTE FUNCTION inventory_history_immutable();
CREATE TRIGGER stock_history_immutable BEFORE UPDATE OR DELETE ON stock_incident_history FOR EACH ROW EXECUTE FUNCTION inventory_history_immutable();
CREATE TRIGGER stock_command_immutable BEFORE UPDATE OR DELETE ON stock_incident_command FOR EACH ROW EXECUTE FUNCTION inventory_history_immutable();

