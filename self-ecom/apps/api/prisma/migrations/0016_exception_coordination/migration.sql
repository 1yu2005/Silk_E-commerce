-- 板块13增量协作、争议、物品去向、冻结代录与线下工单；不改既有迁移和业务数据。
CREATE TABLE address_request (
 id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL,
 customer_id uuid NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'OPEN',
 reason varchar(500) NOT NULL,
 communication_id uuid NOT NULL,
 proposed_address_snapshot jsonb,
 physical_version_at_open integer NOT NULL,
 version integer NOT NULL DEFAULT 0,
 handoff_after_sale_id uuid,
 handoff_offline_case_id uuid,
 resolution_kind varchar(30),
 created_by_id uuid NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 resolved_at timestamptz(3)
);
CREATE INDEX address_request_order_id_status_idx ON address_request (order_id,status);
CREATE TABLE address_request_event (
 id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL,
 kind varchar(40) NOT NULL,
 before_data jsonb,
 after_data jsonb,
 reason varchar(500) NOT NULL,
 communication_id uuid,
 actor_employee_id uuid NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX address_request_event_request_id_created_at_id_idx ON address_request_event (request_id,created_at,id);
CREATE TABLE proxy_context (
 id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
 customer_id uuid NOT NULL,
 order_id uuid NOT NULL,
 after_sale_id uuid,
 parcel_id uuid,
 supplement_request_id uuid,
 offline_case_id uuid,
 action varchar(30) NOT NULL,
 customer_status_version integer NOT NULL,
 verified_by_id uuid NOT NULL,
 verified_at timestamptz(3) NOT NULL,
 method varchar(40) NOT NULL,
 verification_summary varchar(2000) NOT NULL,
 source_communication_id uuid NOT NULL,
 expires_at timestamptz(3) NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'VERIFIED',
 invalidated_reason varchar(500),
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX proxy_context_customer_id_order_id_status_expires_at_idx ON proxy_context (customer_id,order_id,status,expires_at);
CREATE UNIQUE INDEX proxy_context_id_order_id_key ON proxy_context (id,order_id);
CREATE TABLE proxy_execution (
 id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
 proxy_context_id uuid NOT NULL UNIQUE,
 actor_employee_id uuid NOT NULL,
 customer_id uuid NOT NULL,
 order_id uuid NOT NULL,
 action varchar(30) NOT NULL,
 command_key uuid NOT NULL,
 fingerprint char(64) NOT NULL,
 result_after_sale_id uuid,
 material_version_id uuid,
 parcel_revision_id uuid,
 offline_event_id uuid,
 request_id varchar(64) NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX proxy_execution_actor_employee_id_order_id_action_command_key_key ON proxy_execution (actor_employee_id,order_id,action,command_key);
CREATE TABLE dispute_request (
 id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
 after_sale_id uuid NOT NULL,
 kind varchar(40) NOT NULL,
 based_after_sale_version integer NOT NULL,
 based_order_physical_version integer,
 based_return_physical_version integer,
 communication_id uuid NOT NULL,
 proposal varchar(2000) NOT NULL,
 public_explanation varchar(1000) NOT NULL,
 created_by_id uuid NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 status varchar(20) NOT NULL DEFAULT 'OPEN'
);
CREATE INDEX dispute_request_after_sale_id_created_at_id_idx ON dispute_request (after_sale_id,created_at,id);
CREATE TABLE dispute_decision (
 id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL UNIQUE,
 after_sale_id uuid NOT NULL,
 decision varchar(50) NOT NULL,
 from_status varchar(40) NOT NULL,
 reason varchar(500) NOT NULL,
 public_explanation varchar(1000) NOT NULL,
 evidence_summary varchar(2000) NOT NULL,
 decided_by_id uuid NOT NULL,
 decided_at timestamptz(3) NOT NULL,
 checked_physical_version integer NOT NULL,
 checked_return_physical_version integer NOT NULL,
 related_check_id uuid,
 approval_id uuid,
 command_key uuid NOT NULL,
 request_id_trace varchar(64) NOT NULL
);
CREATE INDEX dispute_decision_after_sale_id_decided_at_idx ON dispute_decision (after_sale_id,decided_at);
CREATE TABLE custody_arrangement (
 id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
 dispute_decision_id uuid NOT NULL,
 after_sale_id uuid NOT NULL,
 order_item_id uuid,
 return_receipt_id uuid,
 unmatched_item_id uuid,
 description varchar(1000) NOT NULL,
 quantity integer NOT NULL,
 disposition varchar(40) NOT NULL,
 custodian_employee_id uuid,
 location varchar(200) NOT NULL,
 planned_action varchar(1000) NOT NULL,
 next_follow_at timestamptz(3),
 status varchar(20) NOT NULL DEFAULT 'PLANNED',
 follow_offline_case_id uuid,
 version integer NOT NULL DEFAULT 0,
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX custody_arrangement_status_next_follow_at_idx ON custody_arrangement (status,next_follow_at);
CREATE INDEX custody_arrangement_after_sale_id_created_at_id_idx ON custody_arrangement (after_sale_id,created_at,id);
CREATE TABLE custody_event (
 id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
 arrangement_id uuid NOT NULL,
 kind varchar(30) NOT NULL,
 occurred_at timestamptz(3) NOT NULL,
 quantity integer NOT NULL,
 carrier varchar(60),
 tracking varchar(100),
 location varchar(200),
 actor_employee_id uuid NOT NULL,
 evidence_note varchar(2000) NOT NULL,
 public_text varchar(1000),
 corrects_event_id uuid,
 command_key uuid NOT NULL,
 request_id varchar(64) NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX custody_event_arrangement_id_command_key_key ON custody_event (arrangement_id,command_key);
CREATE INDEX custody_event_arrangement_id_created_at_id_idx ON custody_event (arrangement_id,created_at,id);
CREATE TABLE offline_case (
 id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
 case_no varchar(40) NOT NULL UNIQUE,
 customer_id uuid NOT NULL,
 order_id uuid NOT NULL,
 after_sale_id uuid,
 address_request_id uuid,
 dispute_decision_id uuid,
 type varchar(40) NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'OPEN',
 subject varchar(100) NOT NULL,
 description varchar(2000) NOT NULL,
 public_summary varchar(1000) NOT NULL,
 version integer NOT NULL DEFAULT 0,
 next_follow_at timestamptz(3),
 created_by_id uuid NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 resolved_at timestamptz(3),
 closed_at timestamptz(3)
);
CREATE INDEX offline_case_status_created_at_id_idx ON offline_case (status,created_at,id);
CREATE INDEX offline_case_order_id_created_at_id_idx ON offline_case (order_id,created_at,id);
CREATE UNIQUE INDEX offline_case_id_order_id_key ON offline_case (id,order_id);
CREATE TABLE offline_case_event (
 id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
 offline_case_id uuid NOT NULL,
 kind varchar(30) NOT NULL,
 occurred_at timestamptz(3) NOT NULL,
 channel varchar(30) NOT NULL,
 result varchar(2000) NOT NULL,
 next_step varchar(1000),
 next_follow_at timestamptz(3),
 public_text varchar(1000),
 reported_amount_cents integer,
 external_payment_at timestamptz(3),
 external_verification varchar(20),
 carrier varchar(60),
 tracking varchar(100),
 actor_employee_id uuid NOT NULL,
 proxy_context_id uuid,
 represented_customer_id uuid,
 corrects_event_id uuid,
 command_key uuid NOT NULL,
 request_id varchar(64) NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX offline_case_event_offline_case_id_command_key_key ON offline_case_event (offline_case_id,command_key);
CREATE INDEX offline_case_event_offline_case_id_created_at_id_idx ON offline_case_event (offline_case_id,created_at,id);
CREATE TABLE coordination_command_result (
 id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL,
 action varchar(50) NOT NULL,
 command_key uuid NOT NULL,
 fingerprint char(64) NOT NULL,
 result_type varchar(50) NOT NULL,
 result_id uuid NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX coordination_command_result_order_id_action_command_key_key ON coordination_command_result (order_id,action,command_key);
CREATE TABLE coordination_handoff (
 id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL,
 source_type varchar(40) NOT NULL,
 source_id uuid NOT NULL,
 semantic_apply_key uuid NOT NULL,
 after_sale_id uuid NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX coordination_handoff_source_type_source_id_semantic_apply_key_key ON coordination_handoff (source_type,source_id,semantic_apply_key);
CREATE INDEX coordination_handoff_order_id_created_at_idx ON coordination_handoff (order_id,created_at);

ALTER TYPE "FileOwnerType" ADD VALUE 'PROXY_VERIFICATION';
ALTER TYPE "FileOwnerType" ADD VALUE 'DISPUTE_DECISION';
ALTER TYPE "FileOwnerType" ADD VALUE 'CUSTODY_EVENT';
ALTER TYPE "FileOwnerType" ADD VALUE 'OFFLINE_CASE_EVENT';
ALTER TABLE order_block ADD COLUMN source_address_request_id uuid UNIQUE;
ALTER TABLE after_sale ADD COLUMN proxy_context_id uuid, ADD COLUMN represented_customer_id uuid, ADD COLUMN submitted_by_employee_id uuid;
ALTER TABLE after_sale_material_version ADD COLUMN proxy_context_id uuid, ADD COLUMN represented_customer_id uuid;
ALTER TABLE return_logistics_revision ADD COLUMN proxy_context_id uuid, ADD COLUMN represented_customer_id uuid;
ALTER TABLE after_sale_decision ADD COLUMN dispute_decision_id uuid UNIQUE;
ALTER TABLE offline_case ADD COLUMN admin_request_event_id uuid, ADD COLUMN admin_decision_event_id uuid;
ALTER TABLE offline_case_event ADD COLUMN admin_decision varchar(20), ADD COLUMN based_admin_request_event_id uuid;
CREATE UNIQUE INDEX order_id_customer_key ON "order"(id,customer_id);
CREATE UNIQUE INDEX address_request_id_order_key ON address_request(id,order_id);
CREATE UNIQUE INDEX dispute_decision_id_sale_key ON dispute_decision(id,after_sale_id);
CREATE UNIQUE INDEX custody_event_id_arrangement_key ON custody_event(id,arrangement_id);
CREATE UNIQUE INDEX offline_event_id_case_key ON offline_case_event(id,offline_case_id);
CREATE UNIQUE INDEX address_request_open_key ON address_request(order_id) WHERE status='OPEN';
CREATE UNIQUE INDEX dispute_request_open_key ON dispute_request(after_sale_id,kind) WHERE status='OPEN';
ALTER TABLE address_request ADD FOREIGN KEY(order_id,customer_id) REFERENCES "order"(id,customer_id) ON DELETE RESTRICT;
ALTER TABLE address_request ADD FOREIGN KEY(communication_id) REFERENCES communication(id) ON DELETE RESTRICT;
ALTER TABLE address_request ADD FOREIGN KEY(created_by_id) REFERENCES employee(id) ON DELETE RESTRICT;
ALTER TABLE address_request ADD FOREIGN KEY(handoff_after_sale_id,order_id) REFERENCES after_sale(id,order_id) ON DELETE RESTRICT;
ALTER TABLE address_request ADD FOREIGN KEY(handoff_offline_case_id,order_id) REFERENCES offline_case(id,order_id) ON DELETE RESTRICT;
ALTER TABLE address_request_event ADD FOREIGN KEY(request_id) REFERENCES address_request(id) ON DELETE RESTRICT;
ALTER TABLE address_request_event ADD FOREIGN KEY(communication_id) REFERENCES communication(id) ON DELETE RESTRICT;
ALTER TABLE address_request_event ADD FOREIGN KEY(actor_employee_id) REFERENCES employee(id) ON DELETE RESTRICT;
ALTER TABLE proxy_context ADD FOREIGN KEY(order_id,customer_id) REFERENCES "order"(id,customer_id) ON DELETE RESTRICT;
ALTER TABLE proxy_context ADD FOREIGN KEY(after_sale_id,order_id) REFERENCES after_sale(id,order_id) ON DELETE RESTRICT;
ALTER TABLE proxy_context ADD FOREIGN KEY(parcel_id,after_sale_id) REFERENCES return_parcel(id,after_sale_id) ON DELETE RESTRICT;
ALTER TABLE proxy_context ADD FOREIGN KEY(supplement_request_id) REFERENCES after_sale_supplement_request(id) ON DELETE RESTRICT;
ALTER TABLE proxy_context ADD FOREIGN KEY(offline_case_id,order_id) REFERENCES offline_case(id,order_id) ON DELETE RESTRICT;
ALTER TABLE proxy_context ADD FOREIGN KEY(verified_by_id) REFERENCES employee(id) ON DELETE RESTRICT;
ALTER TABLE proxy_context ADD FOREIGN KEY(source_communication_id) REFERENCES communication(id) ON DELETE RESTRICT;
ALTER TABLE proxy_execution ADD FOREIGN KEY(proxy_context_id,order_id) REFERENCES proxy_context(id,order_id) ON DELETE RESTRICT;
ALTER TABLE proxy_execution ADD FOREIGN KEY(actor_employee_id) REFERENCES employee(id) ON DELETE RESTRICT;
ALTER TABLE proxy_execution ADD FOREIGN KEY(order_id,customer_id) REFERENCES "order"(id,customer_id) ON DELETE RESTRICT;
ALTER TABLE proxy_execution ADD FOREIGN KEY(result_after_sale_id,order_id) REFERENCES after_sale(id,order_id) ON DELETE RESTRICT;
ALTER TABLE proxy_execution ADD FOREIGN KEY(material_version_id) REFERENCES after_sale_material_version(id) ON DELETE RESTRICT;
ALTER TABLE proxy_execution ADD FOREIGN KEY(parcel_revision_id) REFERENCES return_logistics_revision(id) ON DELETE RESTRICT;
ALTER TABLE proxy_execution ADD FOREIGN KEY(offline_event_id) REFERENCES offline_case_event(id) ON DELETE RESTRICT;
ALTER TABLE dispute_request ADD FOREIGN KEY(after_sale_id) REFERENCES after_sale(id) ON DELETE RESTRICT;
ALTER TABLE dispute_request ADD FOREIGN KEY(communication_id) REFERENCES communication(id) ON DELETE RESTRICT;
ALTER TABLE dispute_request ADD FOREIGN KEY(created_by_id) REFERENCES employee(id) ON DELETE RESTRICT;
ALTER TABLE dispute_decision ADD FOREIGN KEY(request_id) REFERENCES dispute_request(id) ON DELETE RESTRICT;
ALTER TABLE dispute_decision ADD FOREIGN KEY(after_sale_id) REFERENCES after_sale(id) ON DELETE RESTRICT;
ALTER TABLE dispute_decision ADD FOREIGN KEY(decided_by_id) REFERENCES employee(id) ON DELETE RESTRICT;
ALTER TABLE dispute_decision ADD FOREIGN KEY(related_check_id) REFERENCES unshipped_physical_check(id) ON DELETE RESTRICT;
ALTER TABLE dispute_decision ADD FOREIGN KEY(approval_id) REFERENCES exception_refund_approval(id) ON DELETE RESTRICT;
ALTER TABLE custody_arrangement ADD FOREIGN KEY(dispute_decision_id,after_sale_id) REFERENCES dispute_decision(id,after_sale_id) ON DELETE RESTRICT;
ALTER TABLE custody_arrangement ADD FOREIGN KEY(order_item_id) REFERENCES order_item(id) ON DELETE RESTRICT;
ALTER TABLE custody_arrangement ADD FOREIGN KEY(return_receipt_id) REFERENCES return_receipt(id) ON DELETE RESTRICT;
ALTER TABLE custody_arrangement ADD FOREIGN KEY(unmatched_item_id) REFERENCES return_unmatched_item(id) ON DELETE RESTRICT;
ALTER TABLE custody_arrangement ADD FOREIGN KEY(custodian_employee_id) REFERENCES employee(id) ON DELETE RESTRICT;
ALTER TABLE custody_arrangement ADD FOREIGN KEY(follow_offline_case_id) REFERENCES offline_case(id) ON DELETE RESTRICT;
ALTER TABLE custody_event ADD FOREIGN KEY(arrangement_id) REFERENCES custody_arrangement(id) ON DELETE RESTRICT;
ALTER TABLE custody_event ADD FOREIGN KEY(actor_employee_id) REFERENCES employee(id) ON DELETE RESTRICT;
ALTER TABLE custody_event ADD FOREIGN KEY(corrects_event_id,arrangement_id) REFERENCES custody_event(id,arrangement_id) ON DELETE RESTRICT;
ALTER TABLE offline_case ADD FOREIGN KEY(order_id,customer_id) REFERENCES "order"(id,customer_id) ON DELETE RESTRICT;
ALTER TABLE offline_case ADD FOREIGN KEY(after_sale_id,order_id) REFERENCES after_sale(id,order_id) ON DELETE RESTRICT;
ALTER TABLE offline_case ADD FOREIGN KEY(address_request_id,order_id) REFERENCES address_request(id,order_id) ON DELETE RESTRICT;
ALTER TABLE offline_case ADD FOREIGN KEY(dispute_decision_id,after_sale_id) REFERENCES dispute_decision(id,after_sale_id) ON DELETE RESTRICT;
ALTER TABLE offline_case ADD FOREIGN KEY(created_by_id) REFERENCES employee(id) ON DELETE RESTRICT;
ALTER TABLE offline_case ADD FOREIGN KEY(admin_request_event_id,id) REFERENCES offline_case_event(id,offline_case_id) ON DELETE RESTRICT;
ALTER TABLE offline_case ADD FOREIGN KEY(admin_decision_event_id,id) REFERENCES offline_case_event(id,offline_case_id) ON DELETE RESTRICT;
ALTER TABLE offline_case_event ADD FOREIGN KEY(offline_case_id) REFERENCES offline_case(id) ON DELETE RESTRICT;
ALTER TABLE offline_case_event ADD FOREIGN KEY(actor_employee_id) REFERENCES employee(id) ON DELETE RESTRICT;
ALTER TABLE offline_case_event ADD FOREIGN KEY(proxy_context_id) REFERENCES proxy_context(id) ON DELETE RESTRICT;
ALTER TABLE offline_case_event ADD FOREIGN KEY(represented_customer_id) REFERENCES customer(id) ON DELETE RESTRICT;
ALTER TABLE offline_case_event ADD FOREIGN KEY(corrects_event_id,offline_case_id) REFERENCES offline_case_event(id,offline_case_id) ON DELETE RESTRICT;
ALTER TABLE offline_case_event ADD FOREIGN KEY(based_admin_request_event_id,offline_case_id) REFERENCES offline_case_event(id,offline_case_id) ON DELETE RESTRICT;
ALTER TABLE coordination_command_result ADD FOREIGN KEY(order_id) REFERENCES "order"(id) ON DELETE RESTRICT;
ALTER TABLE coordination_handoff ADD FOREIGN KEY(order_id) REFERENCES "order"(id) ON DELETE RESTRICT;
ALTER TABLE coordination_handoff ADD FOREIGN KEY(after_sale_id,order_id) REFERENCES after_sale(id,order_id) ON DELETE RESTRICT;
ALTER TABLE order_block ADD FOREIGN KEY(source_address_request_id,order_id) REFERENCES address_request(id,order_id) ON DELETE RESTRICT;
ALTER TABLE after_sale ADD FOREIGN KEY(proxy_context_id,order_id) REFERENCES proxy_context(id,order_id) ON DELETE RESTRICT;
ALTER TABLE after_sale ADD FOREIGN KEY(represented_customer_id) REFERENCES customer(id) ON DELETE RESTRICT;
ALTER TABLE after_sale ADD FOREIGN KEY(submitted_by_employee_id) REFERENCES employee(id) ON DELETE RESTRICT;
ALTER TABLE after_sale_material_version ADD FOREIGN KEY(proxy_context_id) REFERENCES proxy_context(id) ON DELETE RESTRICT;
ALTER TABLE after_sale_material_version ADD FOREIGN KEY(represented_customer_id) REFERENCES customer(id) ON DELETE RESTRICT;
ALTER TABLE return_logistics_revision ADD FOREIGN KEY(proxy_context_id) REFERENCES proxy_context(id) ON DELETE RESTRICT;
ALTER TABLE return_logistics_revision ADD FOREIGN KEY(represented_customer_id) REFERENCES customer(id) ON DELETE RESTRICT;
ALTER TABLE after_sale_decision ADD FOREIGN KEY(dispute_decision_id,after_sale_id) REFERENCES dispute_decision(id,after_sale_id) ON DELETE RESTRICT;

ALTER TABLE address_request ADD CHECK(status IN ('OPEN','HANDED_OFF','RESOLVED','CANCELLED') AND version>=0 AND physical_version_at_open>=0), ADD CHECK((status='HANDED_OFF')=(num_nonnulls(handoff_after_sale_id,handoff_offline_case_id)=1)), ADD CHECK(resolution_kind IS NULL OR resolution_kind IN ('CANCEL_REORDER','REFUND_REORDER','OFFLINE_FORWARD','CONTINUE_ORIGINAL'));
ALTER TABLE proxy_context ADD CHECK(status IN ('VERIFIED','CONSUMED','INVALIDATED') AND customer_status_version>=0 AND expires_at>verified_at AND verified_at<=created_at), ADD CHECK(action IN ('APPLY_AFTER_SALE','SUPPLEMENT','RETURN_LOGISTICS','OFFLINE_RESULT')), ADD CHECK(method IN ('PHONE_CALLBACK','ORDER_INFORMATION_CROSS_CHECK','OTHER_OFFLINE')), ADD CHECK(action NOT IN ('SUPPLEMENT','RETURN_LOGISTICS') OR after_sale_id IS NOT NULL), ADD CHECK(action<>'SUPPLEMENT' OR supplement_request_id IS NOT NULL), ADD CHECK(action<>'OFFLINE_RESULT' OR offline_case_id IS NOT NULL);
ALTER TABLE proxy_execution ADD CHECK(fingerprint ~ '^[0-9a-f]{64}$'), ADD CHECK((action='APPLY_AFTER_SALE' AND result_after_sale_id IS NOT NULL AND num_nonnulls(material_version_id,parcel_revision_id,offline_event_id)=0) OR (action='SUPPLEMENT' AND material_version_id IS NOT NULL AND num_nonnulls(result_after_sale_id,parcel_revision_id,offline_event_id)=0) OR (action='RETURN_LOGISTICS' AND parcel_revision_id IS NOT NULL AND num_nonnulls(result_after_sale_id,material_version_id,offline_event_id)=0) OR (action='OFFLINE_RESULT' AND offline_event_id IS NOT NULL AND num_nonnulls(result_after_sale_id,material_version_id,parcel_revision_id)=0));
ALTER TABLE dispute_request ADD CHECK(kind IN ('CLOSE_WITH_CUSTODY','STOP_UNSHIPPED_REFUND','OTHER_DISPUTE') AND status IN ('OPEN','DECIDED','WITHDRAWN') AND based_after_sale_version>=0 AND (based_order_physical_version IS NULL OR based_order_physical_version>=0) AND (based_return_physical_version IS NULL OR based_return_physical_version>=0));
ALTER TABLE dispute_decision ADD CHECK(decision IN ('CLOSE_BEFORE_FINAL_INSPECTION','STOP_UNSHIPPED_REFUND') AND checked_physical_version>=0 AND checked_return_physical_version>=0);
ALTER TABLE custody_arrangement ADD CHECK(quantity>=0 AND version>=0 AND status IN ('PLANNED','IN_PROGRESS','COMPLETED','EXCEPTION')), ADD CHECK(disposition IN ('KEEP_IN_CUSTODY','RETURN_TO_CUSTOMER','IN_TRANSIT_UNRECEIVED','NO_GOODS')), ADD CHECK(disposition<>'NO_GOODS' OR quantity=0), ADD CHECK(disposition NOT IN ('KEEP_IN_CUSTODY','RETURN_TO_CUSTOMER') OR (quantity>0 AND length(btrim(location))>0 AND custodian_employee_id IS NOT NULL)), ADD CHECK(length(btrim(planned_action))>0), ADD CHECK(order_item_id IS NULL OR unmatched_item_id IS NULL);
ALTER TABLE custody_event ADD CHECK(kind IN ('HANDOVER','RETURN_DISPATCH','RECEIPT_CONFIRMED','LOCATION_CHANGED','EXCEPTION','CORRECTION') AND quantity>=0 AND occurred_at<=created_at), ADD CHECK(kind<>'RETURN_DISPATCH' OR (carrier IS NOT NULL AND tracking IS NOT NULL)), ADD CHECK((kind='CORRECTION')=(corrects_event_id IS NOT NULL));
ALTER TABLE offline_case ADD CHECK(type IN ('EXPIRED_AFTER_SALE','FORWARDING','EXTRA_RESHIPMENT','EXTERNAL_COMPENSATION','CUSTODY_FOLLOW','OTHER_SERVICE') AND status IN ('OPEN','IN_PROGRESS','WAIT_EXTERNAL','RESOLVED','CLOSED') AND version>=0);
ALTER TABLE offline_case_event ADD CHECK(kind IN ('CONTACT','PROGRESS','EXTERNAL_RESULT','CORRECTION','RESOLUTION','CLOSURE')), ADD CHECK(occurred_at<=created_at AND (reported_amount_cents IS NULL OR reported_amount_cents BETWEEN 0 AND 100000000) AND (external_payment_at IS NULL OR external_payment_at<=created_at)), ADD CHECK(external_verification IS NULL OR external_verification IN ('DECLARED','VERIFIED')), ADD CHECK(admin_decision IS NULL OR admin_decision IN ('REQUEST','APPROVED','DECLINED')), ADD CHECK((kind='CORRECTION')=(corrects_event_id IS NOT NULL));
ALTER TABLE coordination_command_result ADD CHECK(fingerprint ~ '^[0-9a-f]{64}$');
ALTER TABLE coordination_handoff ADD CHECK(source_type IN ('ADDRESS_REQUEST','SHIPMENT_EXCEPTION'));
ALTER TABLE order_block ADD CHECK((type='ADDRESS_REQUEST')=(source_address_request_id IS NOT NULL) AND (source_address_request_id IS NULL OR source_address_request_id=source_id));
ALTER TABLE after_sale ADD CHECK(proxy_context_id IS NULL OR (submitted_by_employee_id IS NOT NULL AND represented_customer_id=customer_id));
ALTER TABLE after_sale_material_version ADD CHECK(proxy_context_id IS NULL OR (submitted_by_employee_id IS NOT NULL AND represented_customer_id IS NOT NULL));
ALTER TABLE return_logistics_revision ADD CHECK(proxy_context_id IS NULL OR (actor_employee_id IS NOT NULL AND represented_customer_id IS NOT NULL));
ALTER TABLE task_business_source DROP CONSTRAINT task_business_source_source_type_check;
ALTER TABLE task_business_source ADD CONSTRAINT task_business_source_source_type_check CHECK(source_type IN ('AFTER_SALE','SHIPMENT_EXCEPTION','STOCK_EXCEPTION','HANDOVER_UNCERTAIN','ADDRESS_REQUEST','RETURN_PARCEL','PROXY_CONTEXT','DISPUTE_REQUEST'));
CREATE TRIGGER address_request_event_immutable BEFORE UPDATE OR DELETE ON address_request_event FOR EACH ROW EXECUTE FUNCTION inventory_history_immutable();
CREATE TRIGGER proxy_execution_immutable BEFORE UPDATE OR DELETE ON proxy_execution FOR EACH ROW EXECUTE FUNCTION inventory_history_immutable();
CREATE TRIGGER dispute_decision_immutable BEFORE UPDATE OR DELETE ON dispute_decision FOR EACH ROW EXECUTE FUNCTION inventory_history_immutable();
CREATE TRIGGER custody_event_immutable BEFORE UPDATE OR DELETE ON custody_event FOR EACH ROW EXECUTE FUNCTION inventory_history_immutable();
CREATE TRIGGER offline_case_event_immutable BEFORE UPDATE OR DELETE ON offline_case_event FOR EACH ROW EXECUTE FUNCTION inventory_history_immutable();
CREATE TRIGGER coordination_command_result_immutable BEFORE UPDATE OR DELETE ON coordination_command_result FOR EACH ROW EXECUTE FUNCTION inventory_history_immutable();
CREATE TRIGGER coordination_handoff_immutable BEFORE UPDATE OR DELETE ON coordination_handoff FOR EACH ROW EXECUTE FUNCTION inventory_history_immutable();

-- 多态沟通和跨层实物来源不能仅靠单列FK证明归属；保留数据库侧拒绝能力。
CREATE FUNCTION coordination_ownership_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bad boolean := false;
BEGIN
 IF TG_TABLE_NAME='address_request' THEN
  bad := NOT EXISTS(SELECT 1 FROM communication c WHERE c.id=NEW.communication_id AND c.scope_type='ORDER' AND c.scope_id=NEW.order_id);
 ELSIF TG_TABLE_NAME='address_request_event' THEN
  bad := NEW.communication_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM communication c JOIN address_request a ON a.id=NEW.request_id WHERE c.id=NEW.communication_id AND c.scope_type='ORDER' AND c.scope_id=a.order_id);
 ELSIF TG_TABLE_NAME='proxy_context' THEN
  bad := NOT EXISTS(SELECT 1 FROM communication c WHERE c.id=NEW.source_communication_id AND ((c.scope_type='ORDER' AND c.scope_id=NEW.order_id) OR (c.scope_type='AFTER_SALE' AND EXISTS(SELECT 1 FROM after_sale a WHERE a.id=c.scope_id AND a.order_id=NEW.order_id))))
   OR (NEW.supplement_request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM after_sale_supplement_request r WHERE r.id=NEW.supplement_request_id AND r.after_sale_id=NEW.after_sale_id))
   OR (NEW.offline_case_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM offline_case o WHERE o.id=NEW.offline_case_id AND o.order_id=NEW.order_id AND o.customer_id=NEW.customer_id));
 ELSIF TG_TABLE_NAME='proxy_execution' THEN
  bad := NOT EXISTS(SELECT 1 FROM proxy_context p WHERE p.id=NEW.proxy_context_id AND p.order_id=NEW.order_id AND p.customer_id=NEW.customer_id AND p.verified_by_id=NEW.actor_employee_id AND p.action=NEW.action
   AND (NEW.result_after_sale_id IS NULL OR EXISTS(SELECT 1 FROM after_sale a WHERE a.id=NEW.result_after_sale_id AND a.proxy_context_id=p.id AND a.order_id=p.order_id))
   AND (NEW.material_version_id IS NULL OR EXISTS(SELECT 1 FROM after_sale_material_version m WHERE m.id=NEW.material_version_id AND m.after_sale_id=p.after_sale_id AND m.proxy_context_id=p.id))
   AND (NEW.parcel_revision_id IS NULL OR EXISTS(SELECT 1 FROM return_logistics_revision v JOIN return_parcel r ON r.id=v.parcel_id WHERE v.id=NEW.parcel_revision_id AND r.after_sale_id=p.after_sale_id AND (p.parcel_id IS NULL OR r.id=p.parcel_id) AND v.proxy_context_id=p.id))
   AND (NEW.offline_event_id IS NULL OR EXISTS(SELECT 1 FROM offline_case_event e WHERE e.id=NEW.offline_event_id AND e.offline_case_id=p.offline_case_id AND e.proxy_context_id=p.id)));
 ELSIF TG_TABLE_NAME='dispute_request' THEN
  bad := NOT EXISTS(SELECT 1 FROM communication c WHERE c.id=NEW.communication_id AND c.scope_type='AFTER_SALE' AND c.scope_id=NEW.after_sale_id);
 ELSIF TG_TABLE_NAME='dispute_decision' THEN
  bad := NOT EXISTS(SELECT 1 FROM dispute_request r WHERE r.id=NEW.request_id AND r.after_sale_id=NEW.after_sale_id)
   OR (NEW.related_check_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM unshipped_physical_check c WHERE c.id=NEW.related_check_id AND c.after_sale_id=NEW.after_sale_id))
   OR (NEW.approval_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM exception_refund_approval a WHERE a.id=NEW.approval_id AND a.after_sale_id=NEW.after_sale_id));
 ELSIF TG_TABLE_NAME='custody_arrangement' THEN
  bad := (NEW.order_item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM order_item i JOIN after_sale a ON a.order_id=i.order_id WHERE i.id=NEW.order_item_id AND a.id=NEW.after_sale_id))
   OR (NEW.return_receipt_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM return_receipt r WHERE r.id=NEW.return_receipt_id AND r.after_sale_id=NEW.after_sale_id))
   OR (NEW.unmatched_item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM return_unmatched_item u JOIN return_inspection_revision v ON v.id=u.revision_id JOIN return_receipt r ON r.id=v.receipt_id WHERE u.id=NEW.unmatched_item_id AND r.after_sale_id=NEW.after_sale_id AND (NEW.return_receipt_id IS NULL OR r.id=NEW.return_receipt_id)))
   OR (NEW.follow_offline_case_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM offline_case o WHERE o.id=NEW.follow_offline_case_id AND o.after_sale_id=NEW.after_sale_id AND o.dispute_decision_id=NEW.dispute_decision_id));
  IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['status','version','next_follow_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','next_follow_at']) THEN
   RAISE EXCEPTION 'custody plan is append-only; correct by event' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='offline_case_event' AND NEW.proxy_context_id IS NOT NULL THEN
  bad := NOT EXISTS(SELECT 1 FROM proxy_context p JOIN offline_case o ON o.id=NEW.offline_case_id WHERE p.id=NEW.proxy_context_id AND p.action='OFFLINE_RESULT' AND p.offline_case_id=o.id AND p.customer_id=NEW.represented_customer_id AND p.verified_by_id=NEW.actor_employee_id);
 END IF;
 IF bad THEN RAISE EXCEPTION 'coordination reference ownership mismatch on %',TG_TABLE_NAME USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER address_request_ownership BEFORE INSERT OR UPDATE ON address_request FOR EACH ROW EXECUTE FUNCTION coordination_ownership_guard();
CREATE TRIGGER address_request_event_ownership BEFORE INSERT ON address_request_event FOR EACH ROW EXECUTE FUNCTION coordination_ownership_guard();
CREATE TRIGGER proxy_context_ownership BEFORE INSERT OR UPDATE ON proxy_context FOR EACH ROW EXECUTE FUNCTION coordination_ownership_guard();
CREATE TRIGGER proxy_execution_ownership BEFORE INSERT ON proxy_execution FOR EACH ROW EXECUTE FUNCTION coordination_ownership_guard();
CREATE TRIGGER dispute_request_ownership BEFORE INSERT OR UPDATE ON dispute_request FOR EACH ROW EXECUTE FUNCTION coordination_ownership_guard();
CREATE TRIGGER dispute_decision_ownership BEFORE INSERT ON dispute_decision FOR EACH ROW EXECUTE FUNCTION coordination_ownership_guard();
CREATE TRIGGER custody_arrangement_ownership BEFORE INSERT OR UPDATE ON custody_arrangement FOR EACH ROW EXECUTE FUNCTION coordination_ownership_guard();
CREATE TRIGGER offline_case_event_ownership BEFORE INSERT ON offline_case_event FOR EACH ROW EXECUTE FUNCTION coordination_ownership_guard();
