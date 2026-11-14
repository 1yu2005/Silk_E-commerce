-- 板块10增量：原库数据与历史迁移保持。
ALTER TYPE "FileOwnerType" ADD VALUE 'HANDOVER_VERIFICATION';
ALTER TYPE "FileOwnerType" ADD VALUE 'SHIPMENT_EXCEPTION';
ALTER TYPE "FileOwnerType" ADD VALUE 'SHIPMENT_TRACKING_REVISION';
ALTER TABLE "order" ADD COLUMN receipt_rule_snapshot JSONB, ADD COLUMN receipt_setting_version_id UUID, ADD COLUMN receipt_source VARCHAR(20), ADD COLUMN after_sale_rule_snapshot JSONB, ADD COLUMN completion_setting_version_id UUID;

CREATE TABLE "fulfillment" (
 "id" UUID NOT NULL PRIMARY KEY,
 "order_id" UUID NOT NULL,
 "current_packing_check_id" UUID,
 "version" INTEGER NOT NULL DEFAULT 0,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE UNIQUE INDEX "fulfillment_order_id_key" ON "fulfillment"("order_id");

CREATE TABLE "packing_check" (
 "id" UUID NOT NULL PRIMARY KEY,
 "fulfillment_id" UUID NOT NULL,
 "order_id" UUID NOT NULL,
 "checked_physical_version" INTEGER NOT NULL,
 "checked_items" JSONB NOT NULL,
 "goods_location" VARCHAR(200) NOT NULL,
 "checked_by_id" UUID NOT NULL,
 "command_key" UUID NOT NULL,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "packing_check_order_id_command_key_key" ON "packing_check"("order_id","command_key");

CREATE TABLE "shipment" (
 "id" UUID NOT NULL PRIMARY KEY,
 "order_id" UUID NOT NULL,
 "carrier_name" VARCHAR(60) NOT NULL,
 "tracking_number" VARCHAR(100) NOT NULL,
 "status" VARCHAR(20) NOT NULL DEFAULT 'PREPARED',
 "confirmed_attempt_id" UUID,
 "actual_handover_at" TIMESTAMPTZ(3),
 "prepared_by_id" UUID NOT NULL,
 "confirmed_by_id" UUID,
 "version" INTEGER NOT NULL DEFAULT 0,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE UNIQUE INDEX "shipment_order_id_key" ON "shipment"("order_id");
CREATE UNIQUE INDEX "shipment_confirmed_attempt_id_key" ON "shipment"("confirmed_attempt_id");

CREATE TABLE "handover_attempt" (
 "id" UUID NOT NULL PRIMARY KEY,
 "order_id" UUID NOT NULL,
 "shipment_id" UUID NOT NULL,
 "attempt_no" INTEGER NOT NULL,
 "start_command_key" UUID NOT NULL,
 "fingerprint" CHAR(64) NOT NULL,
 "status" VARCHAR(30) NOT NULL DEFAULT 'IN_PROGRESS',
 "carrier_snapshot" VARCHAR(60) NOT NULL,
 "tracking_snapshot" VARCHAR(100) NOT NULL,
 "packing_check_id" UUID NOT NULL,
 "physical_version" INTEGER NOT NULL,
 "started_by_id" UUID NOT NULL,
 "started_at" TIMESTAMPTZ(3) NOT NULL,
 "uncertain_after" TIMESTAMPTZ(3) NOT NULL,
 "resolved_by_id" UUID,
 "resolved_at" TIMESTAMPTZ(3),
 "actual_handover_at" TIMESTAMPTZ(3),
 "procedure_violation" BOOLEAN NOT NULL DEFAULT false,
 "resolution_reason" VARCHAR(500),
 "version" INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX "handover_attempt_order_id_attempt_no_key" ON "handover_attempt"("order_id","attempt_no");
CREATE UNIQUE INDEX "handover_attempt_order_id_start_command_key_key" ON "handover_attempt"("order_id","start_command_key");
CREATE UNIQUE INDEX "handover_attempt_id_order_id_shipment_id_key" ON "handover_attempt"("id","order_id","shipment_id");
CREATE INDEX "handover_attempt_status_uncertain_after_id_idx" ON "handover_attempt"("status","uncertain_after","id");

CREATE TABLE "handover_verification" (
 "id" UUID NOT NULL PRIMARY KEY,
 "order_id" UUID NOT NULL,
 "attempt_id" UUID NOT NULL,
 "command_key" UUID NOT NULL,
 "fingerprint" CHAR(64) NOT NULL,
 "conclusion" VARCHAR(30) NOT NULL,
 "actual_handover_at" TIMESTAMPTZ(3),
 "goods_location" VARCHAR(200),
 "checked_items" JSONB,
 "physical_version" INTEGER,
 "reason" VARCHAR(500) NOT NULL,
 "evidence_note" VARCHAR(2000),
 "actor_employee_id" UUID NOT NULL,
 "request_id" VARCHAR(64) NOT NULL,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "handover_verification_attempt_id_command_key_key" ON "handover_verification"("attempt_id","command_key");
CREATE INDEX "handover_verification_attempt_id_created_at_id_idx" ON "handover_verification"("attempt_id","created_at","id");

CREATE TABLE "shipment_tracking_revision" (
 "id" UUID NOT NULL PRIMARY KEY,
 "order_id" UUID NOT NULL,
 "shipment_id" UUID NOT NULL,
 "old_carrier" VARCHAR(60) NOT NULL,
 "old_tracking" VARCHAR(100) NOT NULL,
 "new_carrier" VARCHAR(60) NOT NULL,
 "new_tracking" VARCHAR(100) NOT NULL,
 "reason" VARCHAR(500) NOT NULL,
 "evidence_note" VARCHAR(2000),
 "actor_employee_id" UUID NOT NULL,
 "is_historical_correction" BOOLEAN NOT NULL DEFAULT false,
 "command_key" UUID NOT NULL,
 "request_id" VARCHAR(64) NOT NULL,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "shipment_tracking_revision_shipment_id_command_key_key" ON "shipment_tracking_revision"("shipment_id","command_key");

CREATE TABLE "shipment_exception" (
 "id" UUID NOT NULL PRIMARY KEY,
 "order_id" UUID NOT NULL,
 "type" VARCHAR(30) NOT NULL,
 "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
 "incident_key" VARCHAR(128) NOT NULL,
 "fingerprint" CHAR(64) NOT NULL,
 "reason" VARCHAR(500) NOT NULL,
 "evidence_note" VARCHAR(2000) NOT NULL,
 "goods_location" VARCHAR(200) NOT NULL,
 "order_item_ids" JSONB NOT NULL,
 "physical_version_at_open" INTEGER NOT NULL,
 "current_verified_physical_version" INTEGER,
 "stock_incident_id" UUID,
 "version" INTEGER NOT NULL DEFAULT 0,
 "created_by_id" UUID NOT NULL,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "resolved_at" TIMESTAMPTZ(3)
);
CREATE UNIQUE INDEX "shipment_exception_incident_key_key" ON "shipment_exception"("incident_key");
CREATE INDEX "shipment_exception_order_id_status_idx" ON "shipment_exception"("order_id","status");

CREATE TABLE "shipment_exception_decision" (
 "id" UUID NOT NULL PRIMARY KEY,
 "exception_id" UUID NOT NULL,
 "kind" VARCHAR(40) NOT NULL,
 "physical_version" INTEGER NOT NULL,
 "description" VARCHAR(2000) NOT NULL,
 "actor_employee_id" UUID NOT NULL,
 "command_key" UUID NOT NULL,
 "request_id" VARCHAR(64) NOT NULL,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "shipment_exception_decision_exception_id_command_key_key" ON "shipment_exception_decision"("exception_id","command_key");

CREATE TABLE "fulfillment_command_result" (
 "id" UUID NOT NULL PRIMARY KEY,
 "order_id" UUID NOT NULL,
 "action" VARCHAR(50) NOT NULL,
 "command_key" UUID NOT NULL,
 "fingerprint" CHAR(64) NOT NULL,
 "result" JSONB NOT NULL,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "fulfillment_command_result_order_id_action_command_key_key" ON "fulfillment_command_result"("order_id","action","command_key");

CREATE TABLE "timer_pause_block" (
 "id" UUID NOT NULL PRIMARY KEY,
 "pause_id" UUID NOT NULL,
 "block_id" UUID NOT NULL,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "timer_pause_block_pause_id_block_id_key" ON "timer_pause_block"("pause_id","block_id");

ALTER TABLE "fulfillment" ADD CONSTRAINT "fulfillment_order_id_fkey" FOREIGN KEY("order_id") REFERENCES "order"(id) ON DELETE RESTRICT;
ALTER TABLE "fulfillment" ADD CONSTRAINT "fulfillment_current_packing_check_id_fkey" FOREIGN KEY("current_packing_check_id") REFERENCES "packing_check"(id) ON DELETE RESTRICT;
ALTER TABLE "packing_check" ADD CONSTRAINT "packing_check_fulfillment_id_fkey" FOREIGN KEY("fulfillment_id") REFERENCES "fulfillment"(id) ON DELETE RESTRICT;
ALTER TABLE "packing_check" ADD CONSTRAINT "packing_check_order_id_fkey" FOREIGN KEY("order_id") REFERENCES "order"(id) ON DELETE RESTRICT;
ALTER TABLE "packing_check" ADD CONSTRAINT "packing_check_checked_by_id_fkey" FOREIGN KEY("checked_by_id") REFERENCES "employee"(id) ON DELETE RESTRICT;
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_order_id_fkey" FOREIGN KEY("order_id") REFERENCES "order"(id) ON DELETE RESTRICT;
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_confirmed_attempt_id_fkey" FOREIGN KEY("confirmed_attempt_id") REFERENCES "handover_attempt"(id) ON DELETE RESTRICT;
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_prepared_by_id_fkey" FOREIGN KEY("prepared_by_id") REFERENCES "employee"(id) ON DELETE RESTRICT;
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_confirmed_by_id_fkey" FOREIGN KEY("confirmed_by_id") REFERENCES "employee"(id) ON DELETE RESTRICT;
ALTER TABLE "handover_attempt" ADD CONSTRAINT "handover_attempt_order_id_fkey" FOREIGN KEY("order_id") REFERENCES "order"(id) ON DELETE RESTRICT;
ALTER TABLE "handover_attempt" ADD CONSTRAINT "handover_attempt_shipment_id_fkey" FOREIGN KEY("shipment_id") REFERENCES "shipment"(id) ON DELETE RESTRICT;
ALTER TABLE "handover_attempt" ADD CONSTRAINT "handover_attempt_packing_check_id_fkey" FOREIGN KEY("packing_check_id") REFERENCES "packing_check"(id) ON DELETE RESTRICT;
ALTER TABLE "handover_attempt" ADD CONSTRAINT "handover_attempt_started_by_id_fkey" FOREIGN KEY("started_by_id") REFERENCES "employee"(id) ON DELETE RESTRICT;
ALTER TABLE "handover_attempt" ADD CONSTRAINT "handover_attempt_resolved_by_id_fkey" FOREIGN KEY("resolved_by_id") REFERENCES "employee"(id) ON DELETE RESTRICT;
ALTER TABLE "handover_verification" ADD CONSTRAINT "handover_verification_order_id_fkey" FOREIGN KEY("order_id") REFERENCES "order"(id) ON DELETE RESTRICT;
ALTER TABLE "handover_verification" ADD CONSTRAINT "handover_verification_attempt_id_fkey" FOREIGN KEY("attempt_id") REFERENCES "handover_attempt"(id) ON DELETE RESTRICT;
ALTER TABLE "handover_verification" ADD CONSTRAINT "handover_verification_actor_employee_id_fkey" FOREIGN KEY("actor_employee_id") REFERENCES "employee"(id) ON DELETE RESTRICT;
ALTER TABLE "shipment_tracking_revision" ADD CONSTRAINT "shipment_tracking_revision_order_id_fkey" FOREIGN KEY("order_id") REFERENCES "order"(id) ON DELETE RESTRICT;
ALTER TABLE "shipment_tracking_revision" ADD CONSTRAINT "shipment_tracking_revision_shipment_id_fkey" FOREIGN KEY("shipment_id") REFERENCES "shipment"(id) ON DELETE RESTRICT;
ALTER TABLE "shipment_tracking_revision" ADD CONSTRAINT "shipment_tracking_revision_actor_employee_id_fkey" FOREIGN KEY("actor_employee_id") REFERENCES "employee"(id) ON DELETE RESTRICT;
ALTER TABLE "shipment_exception" ADD CONSTRAINT "shipment_exception_order_id_fkey" FOREIGN KEY("order_id") REFERENCES "order"(id) ON DELETE RESTRICT;
ALTER TABLE "shipment_exception" ADD CONSTRAINT "shipment_exception_stock_incident_id_fkey" FOREIGN KEY("stock_incident_id") REFERENCES "stock_incident"(id) ON DELETE RESTRICT;
ALTER TABLE "shipment_exception" ADD CONSTRAINT "shipment_exception_created_by_id_fkey" FOREIGN KEY("created_by_id") REFERENCES "employee"(id) ON DELETE RESTRICT;
ALTER TABLE "shipment_exception_decision" ADD CONSTRAINT "shipment_exception_decision_exception_id_fkey" FOREIGN KEY("exception_id") REFERENCES "shipment_exception"(id) ON DELETE RESTRICT;
ALTER TABLE "shipment_exception_decision" ADD CONSTRAINT "shipment_exception_decision_actor_employee_id_fkey" FOREIGN KEY("actor_employee_id") REFERENCES "employee"(id) ON DELETE RESTRICT;
ALTER TABLE "fulfillment_command_result" ADD CONSTRAINT "fulfillment_command_result_order_id_fkey" FOREIGN KEY("order_id") REFERENCES "order"(id) ON DELETE RESTRICT;
ALTER TABLE "timer_pause_block" ADD CONSTRAINT "timer_pause_block_pause_id_fkey" FOREIGN KEY("pause_id") REFERENCES "timer_pause"(id) ON DELETE RESTRICT;
ALTER TABLE "timer_pause_block" ADD CONSTRAINT "timer_pause_block_block_id_fkey" FOREIGN KEY("block_id") REFERENCES "order_block"(id) ON DELETE RESTRICT;
ALTER TABLE "order" ADD CONSTRAINT "order_receipt_setting_version_id_fkey" FOREIGN KEY("receipt_setting_version_id") REFERENCES "store_setting_version"(id) ON DELETE RESTRICT;
ALTER TABLE "order" ADD CONSTRAINT "order_completion_setting_version_id_fkey" FOREIGN KEY("completion_setting_version_id") REFERENCES "store_setting_version"(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX handover_one_pending ON handover_attempt(order_id) WHERE status IN ('IN_PROGRESS','UNCERTAIN');
CREATE UNIQUE INDEX handover_one_actual ON handover_attempt(order_id) WHERE status='HANDED_OVER';
CREATE UNIQUE INDEX shipment_id_order_key ON shipment(id,order_id);
ALTER TABLE handover_attempt ADD FOREIGN KEY(shipment_id,order_id) REFERENCES shipment(id,order_id);
ALTER TABLE shipment ADD FOREIGN KEY(confirmed_attempt_id,order_id,id) REFERENCES handover_attempt(id,order_id,shipment_id);
CREATE UNIQUE INDEX packing_id_order_key ON packing_check(id,order_id);
ALTER TABLE handover_attempt ADD FOREIGN KEY(packing_check_id,order_id) REFERENCES packing_check(id,order_id);
CREATE UNIQUE INDEX fulfillment_id_order_key ON fulfillment(id,order_id);
ALTER TABLE packing_check ADD FOREIGN KEY(fulfillment_id,order_id) REFERENCES fulfillment(id,order_id);
CREATE UNIQUE INDEX attempt_id_order_key ON handover_attempt(id,order_id);
ALTER TABLE handover_verification ADD FOREIGN KEY(attempt_id,order_id) REFERENCES handover_attempt(id,order_id);
ALTER TABLE shipment_tracking_revision ADD FOREIGN KEY(shipment_id,order_id) REFERENCES shipment(id,order_id);
CREATE INDEX order_receipt_due_idx ON "order"(status,auto_receipt_due_at,id);
ALTER TABLE fulfillment ADD CHECK(version>=0);
ALTER TABLE packing_check ADD CHECK(checked_physical_version>=0 AND jsonb_typeof(checked_items)='array' AND jsonb_array_length(checked_items) BETWEEN 1 AND 100 AND length(btrim(goods_location))>0);
ALTER TABLE shipment ADD CHECK(version>=0 AND length(btrim(carrier_name)) BETWEEN 1 AND 60 AND tracking_number ~ '^[A-Za-z0-9-]{1,100}$'),
 ADD CHECK((status='PREPARED' AND confirmed_attempt_id IS NULL AND actual_handover_at IS NULL AND confirmed_by_id IS NULL) OR (status='CONFIRMED' AND confirmed_attempt_id IS NOT NULL AND actual_handover_at IS NOT NULL AND confirmed_by_id IS NOT NULL));
ALTER TABLE handover_attempt ADD CHECK(attempt_no>0 AND version>=0 AND physical_version>=0 AND uncertain_after>started_at AND fingerprint ~ '^[a-f0-9]{64}$'),
 ADD CHECK((status IN ('IN_PROGRESS','UNCERTAIN') AND resolved_at IS NULL AND actual_handover_at IS NULL) OR (status='HANDED_OVER' AND resolved_at IS NOT NULL AND actual_handover_at IS NOT NULL) OR (status='NOT_HANDED_OVER' AND resolved_at IS NOT NULL AND actual_handover_at IS NULL));
ALTER TABLE handover_verification ADD CHECK(conclusion IN ('HANDED_OVER','NOT_HANDED_OVER','STILL_UNCERTAIN') AND fingerprint ~ '^[a-f0-9]{64}$' AND length(btrim(reason))>0),
 ADD CHECK((conclusion='HANDED_OVER' AND actual_handover_at IS NOT NULL) OR (conclusion<>'HANDED_OVER' AND actual_handover_at IS NULL)),
 ADD CHECK(conclusion<>'NOT_HANDED_OVER' OR (goods_location IS NOT NULL AND length(btrim(goods_location))>0 AND checked_items IS NOT NULL AND physical_version>=0));
ALTER TABLE shipment_exception ADD CHECK(type IN ('SHORTAGE','DAMAGED','WRONG_VARIANT','OTHER') AND version>=0 AND physical_version_at_open>=0 AND fingerprint ~ '^[a-f0-9]{64}$'),
 ADD CHECK((status='OPEN' AND resolved_at IS NULL) OR (status='RESOLVED' AND resolved_at IS NOT NULL)),
 ADD CHECK(jsonb_typeof(order_item_ids)='array' AND jsonb_array_length(order_item_ids) BETWEEN 1 AND 100);
ALTER TABLE shipment_exception_decision ADD CHECK(kind IN ('WAREHOUSE_READY','CUSTOMER_WAIT','CUSTOMER_CONTINUE','CUSTOMER_REQUEST_REFUND') AND physical_version>=0 AND length(btrim(description))>0);
ALTER TABLE fulfillment_command_result ADD CHECK(fingerprint ~ '^[a-f0-9]{64}$');
ALTER TABLE "order" ADD CHECK(receipt_source IS NULL OR receipt_source IN ('CUSTOMER','SYSTEM'));

CREATE TRIGGER packing_check_immutable BEFORE UPDATE OR DELETE ON packing_check FOR EACH ROW EXECUTE FUNCTION inventory_history_immutable();
CREATE TRIGGER handover_verification_immutable BEFORE UPDATE OR DELETE ON handover_verification FOR EACH ROW EXECUTE FUNCTION inventory_history_immutable();
CREATE TRIGGER shipment_tracking_revision_immutable BEFORE UPDATE OR DELETE ON shipment_tracking_revision FOR EACH ROW EXECUTE FUNCTION inventory_history_immutable();
CREATE TRIGGER shipment_exception_decision_immutable BEFORE UPDATE OR DELETE ON shipment_exception_decision FOR EACH ROW EXECUTE FUNCTION inventory_history_immutable();
CREATE TRIGGER fulfillment_command_result_immutable BEFORE UPDATE OR DELETE ON fulfillment_command_result FOR EACH ROW EXECUTE FUNCTION inventory_history_immutable();
CREATE TRIGGER timer_pause_block_immutable BEFORE UPDATE OR DELETE ON timer_pause_block FOR EACH ROW EXECUTE FUNCTION inventory_history_immutable();
CREATE OR REPLACE FUNCTION order_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'orders cannot be deleted'; END IF;
 IF (to_jsonb(NEW)-ARRAY['source_address_id','status','fulfillment_stage','paid_at','closed_at','close_reason_code','close_reason','closed_by_type','closed_by_id','payment_blocked','release_blocked','stock_physical_version','version','timer_version','auto_receipt_days','actual_handover_at','auto_receipt_base_due_at','auto_receipt_due_at','completed_at','after_sale_deadline','updated_at','receipt_rule_snapshot','receipt_setting_version_id','receipt_source','after_sale_rule_snapshot','completion_setting_version_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['source_address_id','status','fulfillment_stage','paid_at','closed_at','close_reason_code','close_reason','closed_by_type','closed_by_id','payment_blocked','release_blocked','stock_physical_version','version','timer_version','auto_receipt_days','actual_handover_at','auto_receipt_base_due_at','auto_receipt_due_at','completed_at','after_sale_deadline','updated_at','receipt_rule_snapshot','receipt_setting_version_id','receipt_source','after_sale_rule_snapshot','completion_setting_version_id']) THEN RAISE EXCEPTION 'order snapshot is immutable'; END IF;
 IF OLD.receipt_rule_snapshot IS NOT NULL AND (OLD.receipt_rule_snapshot IS DISTINCT FROM NEW.receipt_rule_snapshot OR OLD.receipt_setting_version_id IS DISTINCT FROM NEW.receipt_setting_version_id OR OLD.actual_handover_at IS DISTINCT FROM NEW.actual_handover_at OR OLD.auto_receipt_base_due_at IS DISTINCT FROM NEW.auto_receipt_base_due_at OR OLD.auto_receipt_days IS DISTINCT FROM NEW.auto_receipt_days) THEN RAISE EXCEPTION 'handover rule is immutable'; END IF;
 IF OLD.completed_at IS NOT NULL AND (OLD.completed_at IS DISTINCT FROM NEW.completed_at OR OLD.after_sale_deadline IS DISTINCT FROM NEW.after_sale_deadline OR OLD.receipt_source IS DISTINCT FROM NEW.receipt_source OR OLD.after_sale_rule_snapshot IS DISTINCT FROM NEW.after_sale_rule_snapshot OR OLD.completion_setting_version_id IS DISTINCT FROM NEW.completion_setting_version_id) THEN RAISE EXCEPTION 'completion is immutable'; END IF;
 RETURN NEW;
END $$;
