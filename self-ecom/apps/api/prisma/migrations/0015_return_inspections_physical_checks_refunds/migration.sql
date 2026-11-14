-- 作用：板块12增量模型及约束；保留旧迁移、旧业务与历史。
CREATE TABLE return_receipt (
 id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
 parcel_id uuid NOT NULL UNIQUE,
 after_sale_id uuid NOT NULL,
 received_at timestamptz(3) NOT NULL,
 received_by_id uuid NOT NULL,
 goods_location varchar(200) NOT NULL,
 source_note varchar(1000) NOT NULL,
 recorded_at timestamptz(3) NOT NULL,
 version integer NOT NULL DEFAULT 0,
 physical_version integer NOT NULL DEFAULT 0,
 current_inspection_revision_id uuid
);
CREATE TABLE return_inspection_revision (
 id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
 receipt_id uuid NOT NULL,
 revision_no integer NOT NULL,
 based_return_physical_version integer NOT NULL,
 based_receipt_physical_version integer NOT NULL,
 inspection_complete boolean NOT NULL,
 reason varchar(1000) NOT NULL,
 actor_employee_id uuid NOT NULL,
 created_at timestamptz(3) NOT NULL,
 UNIQUE (receipt_id,revision_no)
);
CREATE TABLE return_inspection_line (
 id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
 revision_id uuid NOT NULL,
 order_item_id uuid NOT NULL,
 matched_received_qty integer NOT NULL,
 sellable_qty integer NOT NULL,
 unsellable_qty integer NOT NULL,
 condition_note varchar(1000) NOT NULL,
 UNIQUE (revision_id,order_item_id)
);
CREATE TABLE return_unmatched_item (
 id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
 revision_id uuid NOT NULL,
 description varchar(1000) NOT NULL,
 quantity integer NOT NULL,
 kind varchar(30) NOT NULL,
 custody_location varchar(200) NOT NULL,
 disposition_note varchar(1000)
);
CREATE TABLE return_reshipment_request (
 id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
 after_sale_id uuid NOT NULL,
 round integer NOT NULL,
 missing_items jsonb NOT NULL,
 reason varchar(1000) NOT NULL,
 public_explanation varchar(1000) NOT NULL,
 communication_id uuid NOT NULL,
 return_address_snapshot jsonb NOT NULL,
 due_at timestamptz(3) NOT NULL,
 rule_snapshot jsonb NOT NULL,
 setting_version_id uuid NOT NULL,
 created_by_id uuid NOT NULL,
 created_at timestamptz(3) NOT NULL,
 status varchar(20) NOT NULL,
 UNIQUE (after_sale_id,round)
);
CREATE TABLE exception_refund_approval (
 id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
 after_sale_id uuid NOT NULL,
 approval_no integer NOT NULL,
 based_return_physical_version integer NOT NULL,
 based_revision_refs jsonb NOT NULL,
 reason varchar(1000) NOT NULL,
 public_explanation varchar(1000) NOT NULL,
 responsibility_note varchar(1000) NOT NULL,
 approved_by_id uuid NOT NULL,
 approved_at timestamptz(3) NOT NULL,
 invalidated_at timestamptz(3),
 invalidation_reason varchar(1000),
 UNIQUE (after_sale_id,approval_no)
);
CREATE TABLE final_inspection (
 id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
 after_sale_id uuid NOT NULL UNIQUE,
 mode varchar(30) NOT NULL,
 approval_id uuid,
 return_physical_version integer NOT NULL,
 source_revision_refs jsonb NOT NULL,
 inventory_action_id uuid UNIQUE,
 confirmed_by_id uuid NOT NULL,
 confirmed_at timestamptz(3) NOT NULL,
 command_key uuid NOT NULL,
 request_id varchar(64) NOT NULL
);
CREATE TABLE final_inspection_item (
 id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
 final_inspection_id uuid NOT NULL,
 order_item_id uuid NOT NULL,
 purchased_qty integer NOT NULL,
 received_qty integer NOT NULL,
 sellable_qty integer NOT NULL,
 unsellable_qty integer NOT NULL,
 missing_qty integer NOT NULL,
 UNIQUE (final_inspection_id,order_item_id)
);
CREATE TABLE unshipped_physical_check (
 id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
 after_sale_id uuid NOT NULL,
 order_id uuid NOT NULL,
 physical_version integer NOT NULL,
 check_no integer NOT NULL,
 status varchar(20) NOT NULL,
 goods_location varchar(200) NOT NULL,
 stopped_at timestamptz(3) NOT NULL,
 checked_at timestamptz(3) NOT NULL,
 checked_by_id uuid NOT NULL,
 invalidated_at timestamptz(3),
 invalidation_reason varchar(1000),
 consumed_refund_id uuid,
 command_key uuid NOT NULL,
 request_id varchar(64) NOT NULL,
 UNIQUE (after_sale_id,check_no)
);
CREATE TABLE unshipped_physical_check_item (
 id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
 check_id uuid NOT NULL,
 order_item_id uuid NOT NULL,
 purchased_qty integer NOT NULL,
 sellable_qty integer NOT NULL,
 damaged_qty integer NOT NULL,
 UNIQUE (check_id,order_item_id)
);
CREATE TABLE physical_check_item_incident (
 id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
 item_id uuid NOT NULL,
 incident_item_id uuid NOT NULL,
 UNIQUE (item_id,incident_item_id)
);
CREATE TABLE refund (
 id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
 refund_no varchar(40) NOT NULL UNIQUE,
 payment_id uuid NOT NULL UNIQUE,
 order_id uuid NOT NULL UNIQUE,
 after_sale_id uuid NOT NULL UNIQUE,
 amount_cents integer NOT NULL,
 currency varchar(3) NOT NULL,
 channel varchar(20) NOT NULL,
 status varchar(20) NOT NULL,
 version integer NOT NULL DEFAULT 0,
 succeeded_at timestamptz(3),
 successful_attempt_id uuid UNIQUE,
 created_at timestamptz(3) NOT NULL,
 updated_at timestamptz(3) NOT NULL
);
CREATE TABLE refund_attempt (
 id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
 refund_id uuid NOT NULL,
 attempt_no integer NOT NULL,
 command_key uuid NOT NULL,
 fingerprint varchar(64) NOT NULL,
 outcome varchar(20) NOT NULL,
 actor_employee_id uuid NOT NULL,
 task_id uuid NOT NULL,
 physical_check_id uuid,
 final_inspection_id uuid,
 failure_code varchar(80),
 public_explanation varchar(1000) NOT NULL,
 started_at timestamptz(3) NOT NULL,
 finished_at timestamptz(3) NOT NULL,
 request_id varchar(64) NOT NULL,
 UNIQUE (refund_id,attempt_no),
 UNIQUE (refund_id,command_key)
);
CREATE TABLE refund_precondition_rejection (
 id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
 after_sale_id uuid NOT NULL,
 command_key uuid NOT NULL,
 fingerprint varchar(64) NOT NULL,
 code varchar(80) NOT NULL,
 public_result jsonb NOT NULL,
 created_at timestamptz(3) NOT NULL,
 UNIQUE (after_sale_id,command_key)
);
CREATE TABLE return_physical_event (
 id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
 after_sale_id uuid NOT NULL,
 receipt_id uuid NOT NULL,
 kind varchar(30) NOT NULL,
 reason varchar(1000) NOT NULL,
 goods_location varchar(200) NOT NULL,
 actor_employee_id uuid NOT NULL,
 created_at timestamptz(3) NOT NULL,
 command_key uuid NOT NULL,
 UNIQUE (after_sale_id,command_key)
);
ALTER TABLE after_sale ADD COLUMN return_physical_version integer NOT NULL DEFAULT 0 CHECK(return_physical_version>=0), ADD COLUMN final_inspection_id uuid UNIQUE REFERENCES final_inspection(id) ON DELETE RESTRICT, ADD COLUMN active_unshipped_check_id uuid REFERENCES unshipped_physical_check(id) ON DELETE RESTRICT, ADD COLUMN refund_id uuid UNIQUE REFERENCES refund(id) ON DELETE RESTRICT;
ALTER TABLE return_parcel ADD COLUMN origin varchar(40) NOT NULL DEFAULT 'CUSTOMER_LOGISTICS' CHECK(origin IN ('CUSTOMER_LOGISTICS','WAREHOUSE_UNANNOUNCED','RESHIPMENT_AUTHORIZED')), ADD COLUMN reshipment_request_id uuid REFERENCES return_reshipment_request(id) ON DELETE RESTRICT, ADD COLUMN source_namespace varchar(80), ADD COLUMN source_reference_normalized varchar(200), ADD CHECK((source_namespace IS NULL)=(source_reference_normalized IS NULL));
CREATE UNIQUE INDEX return_parcel_stable_source ON return_parcel(source_namespace,source_reference_normalized) WHERE source_namespace IS NOT NULL;
CREATE UNIQUE INDEX reshipment_one_open ON return_reshipment_request(after_sale_id) WHERE status='OPEN';
CREATE UNIQUE INDEX approval_one_valid ON exception_refund_approval(after_sale_id) WHERE invalidated_at IS NULL;
CREATE UNIQUE INDEX check_one_valid ON unshipped_physical_check(after_sale_id) WHERE status='VALID';
CREATE UNIQUE INDEX attempt_one_success ON refund_attempt(refund_id) WHERE outcome='SUCCEEDED';
ALTER TABLE return_receipt ADD FOREIGN KEY(parcel_id) REFERENCES return_parcel(id) ON DELETE RESTRICT;
ALTER TABLE return_receipt ADD FOREIGN KEY(after_sale_id) REFERENCES after_sale(id) ON DELETE RESTRICT;
ALTER TABLE return_receipt ADD FOREIGN KEY(received_by_id) REFERENCES employee(id) ON DELETE RESTRICT;
ALTER TABLE return_receipt ADD FOREIGN KEY(current_inspection_revision_id) REFERENCES return_inspection_revision(id) ON DELETE RESTRICT;
ALTER TABLE return_inspection_revision ADD FOREIGN KEY(receipt_id) REFERENCES return_receipt(id) ON DELETE RESTRICT;
ALTER TABLE return_inspection_revision ADD FOREIGN KEY(actor_employee_id) REFERENCES employee(id) ON DELETE RESTRICT;
ALTER TABLE return_inspection_line ADD FOREIGN KEY(revision_id) REFERENCES return_inspection_revision(id) ON DELETE RESTRICT;
ALTER TABLE return_inspection_line ADD FOREIGN KEY(order_item_id) REFERENCES order_item(id) ON DELETE RESTRICT;
ALTER TABLE return_unmatched_item ADD FOREIGN KEY(revision_id) REFERENCES return_inspection_revision(id) ON DELETE RESTRICT;
ALTER TABLE return_reshipment_request ADD FOREIGN KEY(after_sale_id) REFERENCES after_sale(id) ON DELETE RESTRICT;
ALTER TABLE return_reshipment_request ADD FOREIGN KEY(communication_id) REFERENCES communication(id) ON DELETE RESTRICT;
ALTER TABLE return_reshipment_request ADD FOREIGN KEY(setting_version_id) REFERENCES store_setting_version(id) ON DELETE RESTRICT;
ALTER TABLE return_reshipment_request ADD FOREIGN KEY(created_by_id) REFERENCES employee(id) ON DELETE RESTRICT;
ALTER TABLE exception_refund_approval ADD FOREIGN KEY(after_sale_id) REFERENCES after_sale(id) ON DELETE RESTRICT;
ALTER TABLE exception_refund_approval ADD FOREIGN KEY(approved_by_id) REFERENCES employee(id) ON DELETE RESTRICT;
ALTER TABLE final_inspection ADD FOREIGN KEY(after_sale_id) REFERENCES after_sale(id) ON DELETE RESTRICT;
ALTER TABLE final_inspection ADD FOREIGN KEY(approval_id) REFERENCES exception_refund_approval(id) ON DELETE RESTRICT;
ALTER TABLE final_inspection ADD FOREIGN KEY(inventory_action_id) REFERENCES inventory_action(id) ON DELETE RESTRICT;
ALTER TABLE final_inspection ADD FOREIGN KEY(confirmed_by_id) REFERENCES employee(id) ON DELETE RESTRICT;
ALTER TABLE final_inspection_item ADD FOREIGN KEY(final_inspection_id) REFERENCES final_inspection(id) ON DELETE RESTRICT;
ALTER TABLE final_inspection_item ADD FOREIGN KEY(order_item_id) REFERENCES order_item(id) ON DELETE RESTRICT;
ALTER TABLE unshipped_physical_check ADD FOREIGN KEY(after_sale_id) REFERENCES after_sale(id) ON DELETE RESTRICT;
ALTER TABLE unshipped_physical_check ADD FOREIGN KEY(order_id) REFERENCES "order"(id) ON DELETE RESTRICT;
ALTER TABLE unshipped_physical_check ADD FOREIGN KEY(checked_by_id) REFERENCES employee(id) ON DELETE RESTRICT;
ALTER TABLE unshipped_physical_check ADD FOREIGN KEY(consumed_refund_id) REFERENCES refund(id) ON DELETE RESTRICT;
ALTER TABLE unshipped_physical_check_item ADD FOREIGN KEY(check_id) REFERENCES unshipped_physical_check(id) ON DELETE RESTRICT;
ALTER TABLE unshipped_physical_check_item ADD FOREIGN KEY(order_item_id) REFERENCES order_item(id) ON DELETE RESTRICT;
ALTER TABLE physical_check_item_incident ADD FOREIGN KEY(item_id) REFERENCES unshipped_physical_check_item(id) ON DELETE RESTRICT;
ALTER TABLE physical_check_item_incident ADD FOREIGN KEY(incident_item_id) REFERENCES stock_incident_item(id) ON DELETE RESTRICT;
ALTER TABLE refund ADD FOREIGN KEY(payment_id) REFERENCES payment(id) ON DELETE RESTRICT;
ALTER TABLE refund ADD FOREIGN KEY(order_id) REFERENCES "order"(id) ON DELETE RESTRICT;
ALTER TABLE refund ADD FOREIGN KEY(after_sale_id) REFERENCES after_sale(id) ON DELETE RESTRICT;
ALTER TABLE refund ADD FOREIGN KEY(successful_attempt_id) REFERENCES refund_attempt(id) ON DELETE RESTRICT;
ALTER TABLE refund_attempt ADD FOREIGN KEY(refund_id) REFERENCES refund(id) ON DELETE RESTRICT;
ALTER TABLE refund_attempt ADD FOREIGN KEY(actor_employee_id) REFERENCES employee(id) ON DELETE RESTRICT;
ALTER TABLE refund_attempt ADD FOREIGN KEY(task_id) REFERENCES task(id) ON DELETE RESTRICT;
ALTER TABLE refund_attempt ADD FOREIGN KEY(physical_check_id) REFERENCES unshipped_physical_check(id) ON DELETE RESTRICT;
ALTER TABLE refund_attempt ADD FOREIGN KEY(final_inspection_id) REFERENCES final_inspection(id) ON DELETE RESTRICT;
ALTER TABLE refund_precondition_rejection ADD FOREIGN KEY(after_sale_id) REFERENCES after_sale(id) ON DELETE RESTRICT;
ALTER TABLE return_physical_event ADD FOREIGN KEY(after_sale_id) REFERENCES after_sale(id) ON DELETE RESTRICT;
ALTER TABLE return_physical_event ADD FOREIGN KEY(receipt_id) REFERENCES return_receipt(id) ON DELETE RESTRICT;
ALTER TABLE return_physical_event ADD FOREIGN KEY(actor_employee_id) REFERENCES employee(id) ON DELETE RESTRICT;
ALTER TABLE return_receipt ADD CHECK(version>=0 AND physical_version>=0);
ALTER TABLE return_inspection_revision ADD CHECK(revision_no>=0 AND based_return_physical_version>=0 AND based_receipt_physical_version>=0);
ALTER TABLE return_inspection_line ADD CHECK(matched_received_qty>=0 AND sellable_qty>=0 AND unsellable_qty>=0);
ALTER TABLE return_unmatched_item ADD CHECK(quantity>=0);
ALTER TABLE return_reshipment_request ADD CHECK(round>=0);
ALTER TABLE exception_refund_approval ADD CHECK(approval_no>=0 AND based_return_physical_version>=0);
ALTER TABLE final_inspection ADD CHECK(return_physical_version>=0);
ALTER TABLE final_inspection_item ADD CHECK(purchased_qty>=0 AND received_qty>=0 AND sellable_qty>=0 AND unsellable_qty>=0 AND missing_qty>=0);
ALTER TABLE unshipped_physical_check ADD CHECK(physical_version>=0 AND check_no>=0);
ALTER TABLE unshipped_physical_check_item ADD CHECK(purchased_qty>=0 AND sellable_qty>=0 AND damaged_qty>=0);
ALTER TABLE refund ADD CHECK(amount_cents>=0 AND version>=0);
ALTER TABLE refund_attempt ADD CHECK(attempt_no>=0);
ALTER TABLE return_receipt ADD CHECK(received_at<=recorded_at);
ALTER TABLE return_inspection_line ADD CHECK(sellable_qty::bigint+unsellable_qty::bigint<=matched_received_qty::bigint);
ALTER TABLE return_unmatched_item ADD CHECK(quantity>0 AND kind IN ('WRONG_VARIANT','EXCESS','UNRELATED','UNKNOWN'));
ALTER TABLE final_inspection ADD CHECK(mode IN ('NORMAL','EXCEPTION_APPROVED') AND ((mode='NORMAL' AND approval_id IS NULL) OR (mode='EXCEPTION_APPROVED' AND approval_id IS NOT NULL)));
ALTER TABLE final_inspection_item ADD CHECK(sellable_qty::bigint+unsellable_qty::bigint=received_qty::bigint AND received_qty::bigint+missing_qty::bigint=purchased_qty::bigint);
ALTER TABLE unshipped_physical_check_item ADD CHECK(purchased_qty>0 AND sellable_qty::bigint+damaged_qty::bigint=purchased_qty::bigint);
ALTER TABLE unshipped_physical_check ADD CHECK(status IN ('VALID','INVALIDATED','CONSUMED'));
ALTER TABLE return_reshipment_request ADD CHECK(status IN ('OPEN','RECEIVED','CANCELLED') AND round>0);
ALTER TABLE refund ADD CHECK(amount_cents BETWEEN 1 AND 100000000 AND channel='SIMULATED' AND status IN ('REFUNDING','FAILED','SUCCEEDED')), ADD CHECK((status='SUCCEEDED')=(succeeded_at IS NOT NULL AND successful_attempt_id IS NOT NULL));
ALTER TABLE refund_attempt ADD CHECK(outcome IN ('FAILED','SUCCEEDED') AND attempt_no>0 AND finished_at>=started_at);
CREATE INDEX receipt_by_sale ON return_receipt(after_sale_id,received_at,id);
CREATE INDEX check_by_order ON unshipped_physical_check(order_id,physical_version,status);
CREATE INDEX refund_by_status ON refund(status,updated_at,id);
CREATE OR REPLACE FUNCTION return_parcel_pointer_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM return_parcel WHERE id=NEW.id AND current_revision_id IS NULL AND origin='CUSTOMER_LOGISTICS') THEN RAISE EXCEPTION 'customer logistics revision required'; END IF;RETURN NULL;END $$;
CREATE FUNCTION final_inspection_action_required() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM final_inspection WHERE id=NEW.id AND inventory_action_id IS NULL) THEN RAISE EXCEPTION 'final inspection action required'; END IF;RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER final_action_complete AFTER INSERT OR UPDATE ON final_inspection DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION final_inspection_action_required();
CREATE TRIGGER return_inspection_revision_immutable BEFORE UPDATE OR DELETE ON return_inspection_revision FOR EACH ROW EXECUTE FUNCTION inventory_history_immutable();
CREATE TRIGGER return_inspection_line_immutable BEFORE UPDATE OR DELETE ON return_inspection_line FOR EACH ROW EXECUTE FUNCTION inventory_history_immutable();
CREATE TRIGGER return_unmatched_item_immutable BEFORE UPDATE OR DELETE ON return_unmatched_item FOR EACH ROW EXECUTE FUNCTION inventory_history_immutable();
CREATE TRIGGER final_inspection_item_immutable BEFORE UPDATE OR DELETE ON final_inspection_item FOR EACH ROW EXECUTE FUNCTION inventory_history_immutable();
CREATE TRIGGER unshipped_physical_check_item_immutable BEFORE UPDATE OR DELETE ON unshipped_physical_check_item FOR EACH ROW EXECUTE FUNCTION inventory_history_immutable();
CREATE TRIGGER physical_check_item_incident_immutable BEFORE UPDATE OR DELETE ON physical_check_item_incident FOR EACH ROW EXECUTE FUNCTION inventory_history_immutable();
CREATE TRIGGER refund_attempt_immutable BEFORE UPDATE OR DELETE ON refund_attempt FOR EACH ROW EXECUTE FUNCTION inventory_history_immutable();
CREATE TRIGGER refund_precondition_rejection_immutable BEFORE UPDATE OR DELETE ON refund_precondition_rejection FOR EACH ROW EXECUTE FUNCTION inventory_history_immutable();
CREATE TRIGGER return_physical_event_immutable BEFORE UPDATE OR DELETE ON return_physical_event FOR EACH ROW EXECUTE FUNCTION inventory_history_immutable();
CREATE FUNCTION final_inspection_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP='DELETE' OR OLD.inventory_action_id IS NOT NULL OR (to_jsonb(OLD)-'inventory_action_id') IS DISTINCT FROM (to_jsonb(NEW)-'inventory_action_id') THEN RAISE EXCEPTION 'final inspection immutable';END IF;RETURN NEW;END $$;
CREATE TRIGGER final_immutable BEFORE UPDATE OR DELETE ON final_inspection FOR EACH ROW EXECUTE FUNCTION final_inspection_immutable();

CREATE OR REPLACE FUNCTION after_sale_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'after sale cannot be deleted'; END IF;
 IF (to_jsonb(NEW)-ARRAY['return_physical_version','final_inspection_id','active_unshipped_check_id','refund_id','status','current_material_version_id','version','approved_at','closed_at','return_address_snapshot','return_setting_version_id','return_due_at','return_rule_snapshot','return_freight_responsibility','responsibility_note','last_public_explanation','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['return_physical_version','final_inspection_id','active_unshipped_check_id','refund_id','status','current_material_version_id','version','approved_at','closed_at','return_address_snapshot','return_setting_version_id','return_due_at','return_rule_snapshot','return_freight_responsibility','responsibility_note','last_public_explanation','updated_at']) THEN RAISE EXCEPTION 'application snapshot is immutable'; END IF;
 IF OLD.approved_at IS NOT NULL AND (OLD.approved_at IS DISTINCT FROM NEW.approved_at OR OLD.return_address_snapshot IS DISTINCT FROM NEW.return_address_snapshot OR OLD.return_setting_version_id IS DISTINCT FROM NEW.return_setting_version_id OR OLD.return_rule_snapshot IS NOT NULL AND OLD.return_rule_snapshot IS DISTINCT FROM NEW.return_rule_snapshot OR OLD.return_freight_responsibility IS DISTINCT FROM NEW.return_freight_responsibility OR OLD.responsibility_note IS DISTINCT FROM NEW.responsibility_note) THEN RAISE EXCEPTION 'approval snapshot is immutable'; END IF;
 IF OLD.closed_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'terminal after sale is immutable'; END IF;
 RETURN NEW;
END $$;

ALTER TABLE task_business_source DROP CONSTRAINT task_business_source_source_type_check;
ALTER TABLE task_business_source ADD CHECK(source_type IN ('AFTER_SALE','SHIPMENT_EXCEPTION','STOCK_EXCEPTION','HANDOVER_UNCERTAIN','ADDRESS_REQUEST','RETURN_PARCEL'));
ALTER TABLE after_sale_decision DROP CONSTRAINT after_sale_decision_kind_check;
ALTER TABLE after_sale_decision ADD CHECK(kind IN ('REQUEST_SUPPLEMENT','APPROVE_REFUND_ONLY','APPROVE_RETURN','REJECT','WITHDRAW','CLOSE','NO_RETURN_REFUND_CONFIRM','REQUEST_EXCEPTION_REFUND','APPROVE_EXCEPTION_REFUND'));
-- 退款先提交后，原备货已经回到可售池；后到的真实损耗必须扣A，不能沿用备货零差额。
ALTER TABLE inventory_action DROP CONSTRAINT inventory_action_action_type_check;
ALTER TABLE inventory_action ADD CHECK(action_type IN ('MANUAL_POST','RESERVE','PAY','CLOSE','RETURN_RESTOCK','UNSHIPPED_REFUND_RESTOCK','PAID_PREPARATION_LOSS','ALLOCATE_REPLACEMENT','REFUNDED_AVAILABLE_LOSS'));
ALTER TABLE stock_incident_item DROP CONSTRAINT stock_incident_item_check;
ALTER TABLE stock_incident_item ADD CHECK(allocation_type IN ('RESERVED','PAID_PREPARATION','AVAILABLE_AFTER_REFUND') AND quantity_affected BETWEEN 1 AND 99 AND version>=0);
ALTER TABLE return_inspection_revision ADD CHECK(revision_no>0);
ALTER TABLE exception_refund_approval ADD CHECK(approval_no>0);
ALTER TABLE unshipped_physical_check ADD CHECK(check_no>0 AND stopped_at<=checked_at);
-- 延迟到事务提交核对循环指针、归属和不可空的最终事实，允许同事务按固定顺序构造。
CREATE FUNCTION settlement_ownership_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bad boolean := false;
BEGIN
 IF TG_TABLE_NAME='after_sale' THEN
  SELECT (a.final_inspection_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM final_inspection f WHERE f.id=a.final_inspection_id AND f.after_sale_id=a.id))
   OR (a.active_unshipped_check_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM unshipped_physical_check c WHERE c.id=a.active_unshipped_check_id AND c.after_sale_id=a.id AND c.order_id=a.order_id))
   OR (a.refund_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM refund r WHERE r.id=a.refund_id AND r.after_sale_id=a.id)) INTO bad FROM after_sale a WHERE a.id=NEW.id;
 ELSIF TG_TABLE_NAME='return_parcel' THEN
  SELECT p.reshipment_request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM return_reshipment_request r WHERE r.id=p.reshipment_request_id AND r.after_sale_id=p.after_sale_id) INTO bad FROM return_parcel p WHERE p.id=NEW.id;
 ELSIF TG_TABLE_NAME='return_receipt' THEN
  SELECT NOT EXISTS(SELECT 1 FROM return_parcel p WHERE p.id=r.parcel_id AND p.after_sale_id=r.after_sale_id) OR (r.current_inspection_revision_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM return_inspection_revision v WHERE v.id=r.current_inspection_revision_id AND v.receipt_id=r.id)) INTO bad FROM return_receipt r WHERE r.id=NEW.id;
 ELSIF TG_TABLE_NAME='return_inspection_line' THEN
  SELECT NOT EXISTS(SELECT 1 FROM return_inspection_revision v JOIN return_receipt r ON r.id=v.receipt_id JOIN after_sale a ON a.id=r.after_sale_id JOIN order_item i ON i.order_id=a.order_id WHERE v.id=NEW.revision_id AND i.id=NEW.order_item_id AND NEW.matched_received_qty<=i.quantity AND (NOT v.inspection_complete OR NEW.sellable_qty::bigint+NEW.unsellable_qty::bigint=NEW.matched_received_qty)) INTO bad;
 ELSIF TG_TABLE_NAME='final_inspection' THEN
  SELECT NOT EXISTS(SELECT 1 FROM inventory_action x WHERE x.id=f.inventory_action_id AND x.action_key='RESTOCK_FINAL_INSPECTION:'||f.after_sale_id::text AND x.business_type='RETURN_INSPECTION' AND x.business_id=f.id)
    OR (f.approval_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM exception_refund_approval p WHERE p.id=f.approval_id AND p.after_sale_id=f.after_sale_id))
    OR (SELECT count(*) FROM final_inspection_item i WHERE i.final_inspection_id=f.id)<>(SELECT count(*) FROM order_item i JOIN after_sale a ON a.order_id=i.order_id WHERE a.id=f.after_sale_id) INTO bad FROM final_inspection f WHERE f.id=NEW.id;
 ELSIF TG_TABLE_NAME='final_inspection_item' THEN
  SELECT NOT EXISTS(SELECT 1 FROM final_inspection f JOIN after_sale a ON a.id=f.after_sale_id JOIN order_item i ON i.order_id=a.order_id WHERE f.id=NEW.final_inspection_id AND i.id=NEW.order_item_id AND i.quantity=NEW.purchased_qty AND (f.mode<>'NORMAL' OR NEW.missing_qty=0)) INTO bad;
 ELSIF TG_TABLE_NAME='unshipped_physical_check' THEN
  SELECT NOT EXISTS(SELECT 1 FROM after_sale a WHERE a.id=c.after_sale_id AND a.order_id=c.order_id AND a.type='REFUND_ONLY') OR (c.consumed_refund_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM refund r WHERE r.id=c.consumed_refund_id AND r.after_sale_id=c.after_sale_id AND r.status='SUCCEEDED')) INTO bad FROM unshipped_physical_check c WHERE c.id=NEW.id;
 ELSIF TG_TABLE_NAME='unshipped_physical_check_item' THEN
  SELECT NOT EXISTS(SELECT 1 FROM unshipped_physical_check c JOIN order_item i ON i.order_id=c.order_id WHERE c.id=NEW.check_id AND i.id=NEW.order_item_id AND i.quantity=NEW.purchased_qty) INTO bad;
 ELSIF TG_TABLE_NAME='physical_check_item_incident' THEN
  SELECT NOT EXISTS(SELECT 1 FROM unshipped_physical_check_item c JOIN stock_incident_item i ON i.order_item_id=c.order_item_id WHERE c.id=NEW.item_id AND i.id=NEW.incident_item_id) INTO bad;
 ELSIF TG_TABLE_NAME='refund' THEN
  SELECT NOT EXISTS(SELECT 1 FROM after_sale a JOIN payment p ON p.id=a.payment_id WHERE a.id=r.after_sale_id AND a.order_id=r.order_id AND p.id=r.payment_id AND p.order_id=r.order_id AND p.status='SUCCEEDED' AND p.amount_cents=r.amount_cents AND p.currency=r.currency)
   OR NOT EXISTS(SELECT 1 FROM refund_attempt x WHERE x.refund_id=r.id)
   OR r.status='REFUNDING'
   OR (r.successful_attempt_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM refund_attempt x WHERE x.id=r.successful_attempt_id AND x.refund_id=r.id AND x.outcome='SUCCEEDED')) INTO bad FROM refund r WHERE r.id=NEW.id;
 ELSIF TG_TABLE_NAME='refund_attempt' THEN
  SELECT NOT EXISTS(SELECT 1 FROM refund r JOIN task t ON t.business_id=r.after_sale_id AND t.business_type='AFTER_SALE' AND t.stage='REFUND_PROCESS' WHERE r.id=NEW.refund_id AND t.id=NEW.task_id)
   OR (NEW.physical_check_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM refund r JOIN unshipped_physical_check c ON c.after_sale_id=r.after_sale_id WHERE r.id=NEW.refund_id AND c.id=NEW.physical_check_id))
   OR (NEW.final_inspection_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM refund r JOIN final_inspection f ON f.after_sale_id=r.after_sale_id WHERE r.id=NEW.refund_id AND f.id=NEW.final_inspection_id)) INTO bad;
 ELSIF TG_TABLE_NAME='return_physical_event' THEN
  SELECT NOT EXISTS(SELECT 1 FROM return_receipt r WHERE r.id=NEW.receipt_id AND r.after_sale_id=NEW.after_sale_id) INTO bad;
 END IF;
 IF bad THEN RAISE EXCEPTION 'settlement ownership or committed fact invalid'; END IF;
 RETURN NULL;
END $$;
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['after_sale','return_parcel','return_receipt','return_inspection_line','final_inspection','final_inspection_item','unshipped_physical_check','unshipped_physical_check_item','physical_check_item_incident','refund','refund_attempt','return_physical_event'] LOOP EXECUTE format('CREATE CONSTRAINT TRIGGER settlement_ownership AFTER INSERT OR UPDATE ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION settlement_ownership_guard()',t);END LOOP;END $$;
