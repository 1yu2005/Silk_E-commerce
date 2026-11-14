-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FileOwnerType" ADD VALUE 'AFTER_SALE_RETURN_LOGISTICS';
ALTER TYPE "FileOwnerType" ADD VALUE 'AFTER_SALE_RETURN_VERIFICATION';

-- AlterTable
ALTER TABLE "order" ADD COLUMN     "shipment_reclaim_required" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "order_block" ADD COLUMN     "source_after_sale_id" UUID;

-- CreateTable
CREATE TABLE "after_sale" (
    "id" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "order_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "status" VARCHAR(40) NOT NULL DEFAULT 'PENDING_REVIEW',
    "reason_code" VARCHAR(30) NOT NULL,
    "application_description" VARCHAR(2000) NOT NULL,
    "current_material_version_id" UUID,
    "requested_refund_amount" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "approved_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "return_address_snapshot" JSONB,
    "return_setting_version_id" UUID,
    "return_due_at" TIMESTAMPTZ(3),
    "return_rule_snapshot" JSONB,
    "return_freight_responsibility" VARCHAR(30),
    "responsibility_note" VARCHAR(1000),
    "last_public_explanation" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "after_sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "after_sale_material_version" (
    "id" UUID NOT NULL,
    "after_sale_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "submitted_by_customer_id" UUID,
    "submitted_by_employee_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "after_sale_material_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "after_sale_supplement_request" (
    "id" UUID NOT NULL,
    "after_sale_id" UUID NOT NULL,
    "request_no" INTEGER NOT NULL,
    "based_material_version_id" UUID NOT NULL,
    "requirement" VARCHAR(1000) NOT NULL,
    "public_explanation" VARCHAR(1000) NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "rule_snapshot" JSONB NOT NULL,
    "setting_version_id" UUID NOT NULL,
    "follow_task_id" UUID NOT NULL,
    "responded_material_version_id" UUID,
    "responded_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),

    CONSTRAINT "after_sale_supplement_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "after_sale_decision" (
    "id" UUID NOT NULL,
    "after_sale_id" UUID NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "from_status" VARCHAR(40) NOT NULL,
    "to_status" VARCHAR(40) NOT NULL,
    "based_material_version_id" UUID NOT NULL,
    "actor_customer_id" UUID,
    "actor_employee_id" UUID,
    "public_explanation" VARCHAR(1000) NOT NULL,
    "internal_note" VARCHAR(2000),
    "related_handover_attempt_id" UUID,
    "related_dispatch_verification_id" UUID,
    "communication_id" UUID,
    "reason" VARCHAR(500),
    "request_id" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "after_sale_decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_parcel" (
    "id" UUID NOT NULL,
    "after_sale_id" UUID NOT NULL,
    "batch_no" INTEGER NOT NULL,
    "current_revision_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_parcel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_logistics_revision" (
    "id" UUID NOT NULL,
    "parcel_id" UUID NOT NULL,
    "revision_no" INTEGER NOT NULL,
    "carrier_name" VARCHAR(60) NOT NULL,
    "tracking_number" VARCHAR(100) NOT NULL,
    "dispatch_declaration" VARCHAR(30) NOT NULL,
    "actual_dispatched_at" TIMESTAMPTZ(3),
    "unapproved_dispatch" BOOLEAN NOT NULL DEFAULT false,
    "description" VARCHAR(2000) NOT NULL,
    "actor_customer_id" UUID,
    "actor_employee_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_logistics_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_dispatch_verification" (
    "id" UUID NOT NULL,
    "after_sale_id" UUID NOT NULL,
    "parcel_id" UUID,
    "based_logistics_revision_id" UUID,
    "based_after_sale_version" INTEGER NOT NULL,
    "based_physical_version" INTEGER NOT NULL,
    "outcome" VARCHAR(20) NOT NULL,
    "verified_at" TIMESTAMPTZ(3) NOT NULL,
    "channel" VARCHAR(30) NOT NULL,
    "source_description" VARCHAR(2000) NOT NULL,
    "contact_result" VARCHAR(2000) NOT NULL,
    "next_step" VARCHAR(1000) NOT NULL,
    "public_explanation" VARCHAR(1000) NOT NULL,
    "actor_employee_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_dispatch_verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "after_sale_command_result" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "after_sale_id" UUID NOT NULL,
    "action" VARCHAR(60) NOT NULL,
    "command_key" UUID NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "result_reference" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "after_sale_command_result_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "after_sale_number_key" ON "after_sale"("number");

-- CreateIndex
CREATE INDEX "after_sale_customer_id_created_at_id_idx" ON "after_sale"("customer_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "after_sale_order_id_created_at_id_idx" ON "after_sale"("order_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "after_sale_status_created_at_id_idx" ON "after_sale"("status", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "after_sale_id_order_id_key" ON "after_sale"("id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "after_sale_material_version_after_sale_id_version_no_key" ON "after_sale_material_version"("after_sale_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "after_sale_material_version_id_after_sale_id_key" ON "after_sale_material_version"("id", "after_sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "after_sale_supplement_request_follow_task_id_key" ON "after_sale_supplement_request"("follow_task_id");

-- CreateIndex
CREATE UNIQUE INDEX "after_sale_supplement_request_after_sale_id_request_no_key" ON "after_sale_supplement_request"("after_sale_id", "request_no");

-- CreateIndex
CREATE INDEX "after_sale_decision_after_sale_id_created_at_id_idx" ON "after_sale_decision"("after_sale_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "return_parcel_after_sale_id_batch_no_key" ON "return_parcel"("after_sale_id", "batch_no");

-- CreateIndex
CREATE UNIQUE INDEX "return_parcel_id_after_sale_id_key" ON "return_parcel"("id", "after_sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "return_logistics_revision_parcel_id_revision_no_key" ON "return_logistics_revision"("parcel_id", "revision_no");

-- CreateIndex
CREATE UNIQUE INDEX "return_logistics_revision_id_parcel_id_key" ON "return_logistics_revision"("id", "parcel_id");

-- CreateIndex
CREATE INDEX "return_dispatch_verification_after_sale_id_created_at_id_idx" ON "return_dispatch_verification"("after_sale_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "after_sale_command_result_customer_id_order_id_action_comma_key" ON "after_sale_command_result"("customer_id", "order_id", "action", "command_key");

-- CreateIndex
CREATE UNIQUE INDEX "order_block_source_after_sale_id_key" ON "order_block"("source_after_sale_id");

-- 数据库底线：引用真实父事实；父/当前指针构造在一个事务内，提交边界复核归属。
ALTER TABLE after_sale
 ADD FOREIGN KEY(order_id) REFERENCES "order"(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(customer_id) REFERENCES customer(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(payment_id) REFERENCES payment(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(return_setting_version_id) REFERENCES store_setting_version(id) ON DELETE RESTRICT,
 ADD CHECK(type IN ('REFUND_ONLY','RETURN_REFUND')),
 ADD CHECK(status IN ('PENDING_REVIEW','WAIT_SUPPLEMENT','WAIT_FULFILLMENT_CHECK','WAIT_REFUND','WAIT_RETURN','WAIT_RECEIPT','WAIT_INSPECTION','INSPECTION_EXCEPTION','FINAL_INSPECTION','REFUNDING','REFUND_FAILED','REJECTED','WITHDRAWN','CLOSED','SUCCEEDED')),
 ADD CHECK(reason_code IN ('NOT_WANTED','QUALITY','WRONG_ITEM','DAMAGED','OTHER')),
 ADD CHECK(requested_refund_amount BETWEEN 1 AND 100000000 AND version>=0 AND length(btrim(application_description))>0),
 ADD CHECK(return_freight_responsibility IS NULL OR return_freight_responsibility IN ('CUSTOMER','MERCHANT','UNDETERMINED')),
 ADD CHECK((status IN ('REJECTED','WITHDRAWN','CLOSED','SUCCEEDED'))=(closed_at IS NOT NULL));
CREATE UNIQUE INDEX uq_after_sale_one_active_order ON after_sale(order_id) WHERE status NOT IN ('REJECTED','WITHDRAWN','CLOSED','SUCCEEDED');
ALTER TABLE after_sale_material_version
 ADD FOREIGN KEY(after_sale_id) REFERENCES after_sale(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(submitted_by_customer_id) REFERENCES customer(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(submitted_by_employee_id) REFERENCES employee(id) ON DELETE RESTRICT,
 ADD CHECK(version_no>0 AND length(btrim(description))>0 AND num_nonnulls(submitted_by_customer_id,submitted_by_employee_id)=1);
ALTER TABLE after_sale ADD FOREIGN KEY(current_material_version_id,id) REFERENCES after_sale_material_version(id,after_sale_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE after_sale_supplement_request
 ADD FOREIGN KEY(after_sale_id) REFERENCES after_sale(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(based_material_version_id,after_sale_id) REFERENCES after_sale_material_version(id,after_sale_id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(responded_material_version_id,after_sale_id) REFERENCES after_sale_material_version(id,after_sale_id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(requested_by_id) REFERENCES employee(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(follow_task_id) REFERENCES task(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(setting_version_id) REFERENCES store_setting_version(id) ON DELETE RESTRICT,
 ADD CHECK(request_no>0 AND length(btrim(requirement))>0 AND due_at>=requested_at AND (responded_at IS NULL)=(responded_material_version_id IS NULL));
CREATE UNIQUE INDEX uq_after_sale_open_supplement ON after_sale_supplement_request(after_sale_id) WHERE responded_at IS NULL AND closed_at IS NULL;
ALTER TABLE after_sale_decision
 ADD FOREIGN KEY(after_sale_id) REFERENCES after_sale(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(based_material_version_id,after_sale_id) REFERENCES after_sale_material_version(id,after_sale_id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(actor_customer_id) REFERENCES customer(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(actor_employee_id) REFERENCES employee(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(related_handover_attempt_id) REFERENCES handover_attempt(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(communication_id) REFERENCES communication(id) ON DELETE RESTRICT,
 ADD CHECK(kind IN ('REQUEST_SUPPLEMENT','APPROVE_REFUND_ONLY','APPROVE_RETURN','REJECT','WITHDRAW','CLOSE','NO_RETURN_REFUND_CONFIRM')),
 ADD CHECK(num_nonnulls(actor_customer_id,actor_employee_id)=1 AND length(btrim(public_explanation))>0);
ALTER TABLE return_parcel ADD FOREIGN KEY(after_sale_id) REFERENCES after_sale(id) ON DELETE RESTRICT, ADD CHECK(batch_no>0);
ALTER TABLE return_logistics_revision
 ADD FOREIGN KEY(parcel_id) REFERENCES return_parcel(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(actor_customer_id) REFERENCES customer(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(actor_employee_id) REFERENCES employee(id) ON DELETE RESTRICT,
 ADD CHECK(revision_no>0 AND length(btrim(carrier_name))>0 AND tracking_number ~ '^[A-Za-z0-9-]{1,100}$'),
 ADD CHECK(dispatch_declaration IN ('NOT_YET_SENT','DECLARED_SENT') AND (dispatch_declaration='DECLARED_SENT')=(actual_dispatched_at IS NOT NULL)),
 ADD CHECK(actual_dispatched_at IS NULL OR actual_dispatched_at<=created_at),
 ADD CHECK(num_nonnulls(actor_customer_id,actor_employee_id)=1);
ALTER TABLE return_parcel ADD FOREIGN KEY(current_revision_id,id) REFERENCES return_logistics_revision(id,parcel_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE return_dispatch_verification
 ADD FOREIGN KEY(after_sale_id) REFERENCES after_sale(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(parcel_id,after_sale_id) REFERENCES return_parcel(id,after_sale_id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(based_logistics_revision_id,parcel_id) REFERENCES return_logistics_revision(id,parcel_id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(actor_employee_id) REFERENCES employee(id) ON DELETE RESTRICT,
 ADD CHECK(outcome IN ('NOT_SENT','IN_TRANSIT','UNCERTAIN') AND channel IN ('PHONE','OTHER_OFFLINE')),
 ADD CHECK(based_after_sale_version>=0 AND based_physical_version>=0 AND verified_at<=created_at AND length(btrim(source_description))>0 AND length(btrim(contact_result))>0 AND length(btrim(next_step))>0 AND length(btrim(public_explanation))>0);
ALTER TABLE after_sale_decision ADD FOREIGN KEY(related_dispatch_verification_id) REFERENCES return_dispatch_verification(id) ON DELETE RESTRICT;
ALTER TABLE after_sale_command_result
 ADD FOREIGN KEY(customer_id) REFERENCES customer(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(order_id) REFERENCES "order"(id) ON DELETE RESTRICT,
 ADD FOREIGN KEY(after_sale_id,order_id) REFERENCES after_sale(id,order_id) ON DELETE RESTRICT,
 ADD CHECK(fingerprint ~ '^[0-9a-f]{64}$');
ALTER TABLE order_block
 ADD FOREIGN KEY(source_after_sale_id,order_id) REFERENCES after_sale(id,order_id) ON DELETE RESTRICT,
 ADD CHECK((type='AFTER_SALE')=(source_after_sale_id IS NOT NULL) AND (source_after_sale_id IS NULL OR source_after_sale_id=source_id));

CREATE FUNCTION after_sale_submission_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM after_sale WHERE id=NEW.id AND current_material_version_id IS NULL) THEN RAISE EXCEPTION 'after sale material pointer required'; END IF;
 IF EXISTS(SELECT 1 FROM after_sale a JOIN "order" o ON o.id=a.order_id JOIN payment p ON p.id=a.payment_id WHERE a.id=NEW.id AND (a.customer_id<>o.customer_id OR p.order_id<>a.order_id OR p.status<>'SUCCEEDED' OR a.requested_refund_amount<>p.amount_cents)) THEN RAISE EXCEPTION 'after sale payment scope mismatch'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER after_sale_submission_valid AFTER INSERT OR UPDATE ON after_sale DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION after_sale_submission_guard();
CREATE FUNCTION after_sale_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'after sale facts are append only'; END $$;
CREATE TRIGGER after_sale_material_immutable BEFORE UPDATE OR DELETE ON after_sale_material_version FOR EACH ROW EXECUTE FUNCTION after_sale_append_only();
CREATE TRIGGER after_sale_decision_immutable BEFORE UPDATE OR DELETE ON after_sale_decision FOR EACH ROW EXECUTE FUNCTION after_sale_append_only();
CREATE TRIGGER return_logistics_immutable BEFORE UPDATE OR DELETE ON return_logistics_revision FOR EACH ROW EXECUTE FUNCTION after_sale_append_only();
CREATE TRIGGER return_verification_immutable BEFORE UPDATE OR DELETE ON return_dispatch_verification FOR EACH ROW EXECUTE FUNCTION after_sale_append_only();
CREATE TRIGGER after_sale_command_immutable BEFORE UPDATE OR DELETE ON after_sale_command_result FOR EACH ROW EXECUTE FUNCTION after_sale_append_only();

-- 原申请与批准时快照不可覆盖；允许当前指针、人工延期和后续合法状态推进。
CREATE FUNCTION after_sale_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'after sale cannot be deleted'; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','current_material_version_id','version','approved_at','closed_at','return_address_snapshot','return_setting_version_id','return_due_at','return_rule_snapshot','return_freight_responsibility','responsibility_note','last_public_explanation','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','current_material_version_id','version','approved_at','closed_at','return_address_snapshot','return_setting_version_id','return_due_at','return_rule_snapshot','return_freight_responsibility','responsibility_note','last_public_explanation','updated_at']) THEN RAISE EXCEPTION 'application snapshot is immutable'; END IF;
 IF OLD.approved_at IS NOT NULL AND (OLD.approved_at IS DISTINCT FROM NEW.approved_at OR OLD.return_address_snapshot IS DISTINCT FROM NEW.return_address_snapshot OR OLD.return_setting_version_id IS DISTINCT FROM NEW.return_setting_version_id OR OLD.return_rule_snapshot IS NOT NULL AND OLD.return_rule_snapshot IS DISTINCT FROM NEW.return_rule_snapshot OR OLD.return_freight_responsibility IS DISTINCT FROM NEW.return_freight_responsibility OR OLD.responsibility_note IS DISTINCT FROM NEW.responsibility_note) THEN RAISE EXCEPTION 'approval snapshot is immutable'; END IF;
 IF OLD.closed_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'terminal after sale is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER after_sale_snapshot_immutable BEFORE UPDATE OR DELETE ON after_sale FOR EACH ROW EXECUTE FUNCTION after_sale_snapshot_guard();
CREATE FUNCTION return_parcel_pointer_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM return_parcel WHERE id=NEW.id AND current_revision_id IS NULL) THEN RAISE EXCEPTION 'return parcel revision required'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER return_parcel_pointer_valid AFTER INSERT OR UPDATE ON return_parcel DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION return_parcel_pointer_guard();

-- 仅新增允许更新的重新领单标记，原快照保护保持。
CREATE OR REPLACE FUNCTION order_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'orders cannot be deleted'; END IF;
 IF (to_jsonb(NEW)-ARRAY['shipment_reclaim_required','source_address_id','status','fulfillment_stage','paid_at','closed_at','close_reason_code','close_reason','closed_by_type','closed_by_id','payment_blocked','release_blocked','stock_physical_version','version','timer_version','auto_receipt_days','actual_handover_at','auto_receipt_base_due_at','auto_receipt_due_at','completed_at','after_sale_deadline','updated_at','receipt_rule_snapshot','receipt_setting_version_id','receipt_source','after_sale_rule_snapshot','completion_setting_version_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['shipment_reclaim_required','source_address_id','status','fulfillment_stage','paid_at','closed_at','close_reason_code','close_reason','closed_by_type','closed_by_id','payment_blocked','release_blocked','stock_physical_version','version','timer_version','auto_receipt_days','actual_handover_at','auto_receipt_base_due_at','auto_receipt_due_at','completed_at','after_sale_deadline','updated_at','receipt_rule_snapshot','receipt_setting_version_id','receipt_source','after_sale_rule_snapshot','completion_setting_version_id']) THEN RAISE EXCEPTION 'order snapshot is immutable'; END IF;
 IF OLD.receipt_rule_snapshot IS NOT NULL AND (OLD.receipt_rule_snapshot IS DISTINCT FROM NEW.receipt_rule_snapshot OR OLD.receipt_setting_version_id IS DISTINCT FROM NEW.receipt_setting_version_id OR OLD.actual_handover_at IS DISTINCT FROM NEW.actual_handover_at OR OLD.auto_receipt_base_due_at IS DISTINCT FROM NEW.auto_receipt_base_due_at OR OLD.auto_receipt_days IS DISTINCT FROM NEW.auto_receipt_days) THEN RAISE EXCEPTION 'handover rule is immutable'; END IF;
 IF OLD.completed_at IS NOT NULL AND (OLD.completed_at IS DISTINCT FROM NEW.completed_at OR OLD.after_sale_deadline IS DISTINCT FROM NEW.after_sale_deadline OR OLD.receipt_source IS DISTINCT FROM NEW.receipt_source OR OLD.after_sale_rule_snapshot IS DISTINCT FROM NEW.after_sale_rule_snapshot OR OLD.completion_setting_version_id IS DISTINCT FROM NEW.completion_setting_version_id) THEN RAISE EXCEPTION 'completion is immutable'; END IF;
 RETURN NEW;
END $$;
