-- 作用：增量建立库存证据、登记、成功动作和不可改流水；不重建既有SKU和余额。
ALTER TYPE "BusinessAggregateType" ADD VALUE 'INVENTORY_ADJUSTMENT';
CREATE TYPE "InventorySourceType" AS ENUM ('RECEIPT','LOSS');
CREATE TYPE "InventoryAdjustmentType" AS ENUM ('INITIALIZATION','ARRIVAL','AVAILABLE_LOSS','CORRECTION');
CREATE TYPE "InventoryAdjustmentStatus" AS ENUM ('PENDING','POSTED','VOID');
CREATE TABLE inventory_source (
 id uuid PRIMARY KEY, source_type "InventorySourceType" NOT NULL, namespace varchar(80) NOT NULL,
 reference varchar(100) NOT NULL, normalized_reference varchar(150) NOT NULL, note varchar(2000),
 version integer NOT NULL DEFAULT 0 CHECK(version>=0), created_by_id uuid NOT NULL REFERENCES employee(id) ON DELETE RESTRICT,
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamptz(3) NOT NULL,
 CONSTRAINT inventory_source_namespace_normalized_reference_key UNIQUE(namespace,normalized_reference)
);
CREATE TABLE inventory_source_line (
 id uuid PRIMARY KEY, source_id uuid NOT NULL REFERENCES inventory_source(id) ON DELETE RESTRICT,
 line_key varchar(64) NOT NULL, sku_id uuid NOT NULL REFERENCES sku(id) ON DELETE RESTRICT,
 verified_quantity integer NOT NULL CHECK(verified_quantity>0), net_posted_quantity integer NOT NULL DEFAULT 0,
 version integer NOT NULL DEFAULT 0 CHECK(version>=0), created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamptz(3) NOT NULL,
 CHECK(net_posted_quantity>=0 AND net_posted_quantity<=verified_quantity),
 UNIQUE(source_id,line_key), UNIQUE(id,sku_id)
);
CREATE INDEX inventory_source_line_sku_id_idx ON inventory_source_line(sku_id);
CREATE TABLE inventory_adjustment (
 id uuid PRIMARY KEY, number varchar(64) NOT NULL UNIQUE, type "InventoryAdjustmentType" NOT NULL,
 status "InventoryAdjustmentStatus" NOT NULL DEFAULT 'PENDING', reason varchar(500) NOT NULL,
 evidence_note varchar(2000), created_by_id uuid NOT NULL REFERENCES employee(id) ON DELETE RESTRICT,
 posted_by_id uuid REFERENCES employee(id) ON DELETE RESTRICT, voided_by_id uuid REFERENCES employee(id) ON DELETE RESTRICT,
 posted_at timestamptz(3), voided_at timestamptz(3), version integer NOT NULL DEFAULT 0 CHECK(version>=0),
 conversion_key uuid UNIQUE, conversion_fingerprint char(64), conversion_snapshot jsonb,
 check_required boolean NOT NULL DEFAULT false, check_reason_code varchar(80),
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamptz(3) NOT NULL,
 UNIQUE(id,type),
 CHECK((status='PENDING' AND posted_at IS NULL AND posted_by_id IS NULL AND voided_at IS NULL AND voided_by_id IS NULL)
 OR (status='POSTED' AND posted_at IS NOT NULL AND posted_by_id IS NOT NULL AND voided_at IS NULL AND voided_by_id IS NULL AND NOT check_required)
 OR (status='VOID' AND voided_at IS NOT NULL AND voided_by_id IS NOT NULL AND posted_at IS NULL AND posted_by_id IS NULL AND NOT check_required)),
 CHECK((conversion_key IS NULL AND conversion_fingerprint IS NULL AND conversion_snapshot IS NULL)
 OR (conversion_key IS NOT NULL AND conversion_fingerprint IS NOT NULL AND conversion_snapshot IS NOT NULL AND type='INITIALIZATION')),
 CHECK(check_required=(check_reason_code IS NOT NULL))
);
CREATE INDEX inventory_adjustment_status_created_at_id_idx ON inventory_adjustment(status,created_at,id);
CREATE TABLE inventory_adjustment_line (
 id uuid PRIMARY KEY, adjustment_id uuid NOT NULL, type "InventoryAdjustmentType" NOT NULL,
 sku_id uuid NOT NULL REFERENCES sku(id) ON DELETE RESTRICT, source_line_id uuid NOT NULL,
 batch_key varchar(80), quantity integer, signed_delta_a integer, root_line_id uuid REFERENCES inventory_adjustment_line(id) ON DELETE RESTRICT,
 FOREIGN KEY(adjustment_id,type) REFERENCES inventory_adjustment(id,type) ON DELETE RESTRICT,
 FOREIGN KEY(source_line_id,sku_id) REFERENCES inventory_source_line(id,sku_id) ON DELETE RESTRICT,
 CHECK((type='CORRECTION' AND quantity IS NULL AND signed_delta_a IS NOT NULL AND signed_delta_a<>0 AND signed_delta_a>=-2147483647 AND root_line_id IS NOT NULL AND batch_key IS NULL)
 OR (type IN ('INITIALIZATION','ARRIVAL') AND quantity IS NOT NULL AND quantity>0 AND signed_delta_a IS NULL AND root_line_id IS NULL AND batch_key IS NOT NULL AND length(trim(batch_key))>0)
 OR (type='AVAILABLE_LOSS' AND quantity IS NOT NULL AND quantity>0 AND signed_delta_a IS NULL AND root_line_id IS NULL AND batch_key IS NULL))
);
CREATE INDEX inventory_adjustment_line_adjustment_id_idx ON inventory_adjustment_line(adjustment_id);
CREATE INDEX inventory_adjustment_line_root_line_id_idx ON inventory_adjustment_line(root_line_id);
CREATE INDEX inventory_adjustment_line_sku_id_idx ON inventory_adjustment_line(sku_id);
CREATE UNIQUE INDEX inventory_adjustment_line_root_unique ON inventory_adjustment_line(adjustment_id,root_line_id) WHERE root_line_id IS NOT NULL;
CREATE UNIQUE INDEX inventory_adjustment_line_receipt_unique ON inventory_adjustment_line(adjustment_id,sku_id,source_line_id,batch_key) WHERE batch_key IS NOT NULL;
CREATE UNIQUE INDEX inventory_adjustment_line_loss_unique ON inventory_adjustment_line(adjustment_id,sku_id,source_line_id) WHERE type='AVAILABLE_LOSS';
CREATE TABLE inventory_receipt_batch (
 id uuid PRIMARY KEY, source_line_id uuid NOT NULL REFERENCES inventory_source_line(id) ON DELETE RESTRICT,
 batch_key varchar(80) NOT NULL, root_adjustment_line_id uuid NOT NULL UNIQUE REFERENCES inventory_adjustment_line(id) ON DELETE RESTRICT,
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(source_line_id,batch_key)
);
ALTER TABLE initial_inventory_draft ADD COLUMN adjustment_id uuid UNIQUE REFERENCES inventory_adjustment(id) ON DELETE RESTRICT;
CREATE TABLE inventory_action (
 id uuid PRIMARY KEY, business_type varchar(40) NOT NULL CHECK(business_type IN ('ADJUSTMENT','ORDER','PAYMENT','RETURN_INSPECTION','REFUND')),
 business_id uuid NOT NULL, action_type varchar(50) NOT NULL CHECK(action_type IN ('MANUAL_POST','RESERVE','PAY','CLOSE','RETURN_RESTOCK','UNSHIPPED_REFUND_RESTOCK','PAID_PREPARATION_LOSS','ALLOCATE_REPLACEMENT')),
 action_key varchar(180) NOT NULL UNIQUE, request_fingerprint char(64) NOT NULL,
 adjustment_id uuid UNIQUE REFERENCES inventory_adjustment(id) ON DELETE RESTRICT, result_summary jsonb NOT NULL,
 actor_type "AuditActorType" NOT NULL, actor_employee_id uuid REFERENCES employee(id) ON DELETE RESTRICT,
 actor_customer_id uuid REFERENCES customer(id) ON DELETE RESTRICT, request_id varchar(64) NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK((actor_type='EMPLOYEE' AND actor_employee_id IS NOT NULL AND actor_customer_id IS NULL)
 OR (actor_type='CUSTOMER' AND actor_customer_id IS NOT NULL AND actor_employee_id IS NULL)
 OR (actor_type='SYSTEM' AND actor_employee_id IS NULL AND actor_customer_id IS NULL)),
 CHECK((business_type='ADJUSTMENT')=(adjustment_id IS NOT NULL)),
 CHECK(adjustment_id IS NULL OR adjustment_id=business_id)
);
CREATE INDEX inventory_action_business_type_business_id_idx ON inventory_action(business_type,business_id);
CREATE TABLE inventory_ledger (
 id uuid PRIMARY KEY, action_id uuid NOT NULL REFERENCES inventory_action(id) ON DELETE RESTRICT,
 sku_id uuid NOT NULL REFERENCES inventory_balance(sku_id) ON DELETE RESTRICT, sequence integer NOT NULL CHECK(sequence>0),
 event_type varchar(50) NOT NULL CHECK(event_type IN ('INITIALIZATION','ARRIVAL','AVAILABLE_LOSS','CORRECTION','RESERVE','PAY','CLOSE','RETURN_RESTOCK','UNSHIPPED_REFUND_RESTOCK','PAID_PREPARATION_LOSS','ALLOCATE_REPLACEMENT')),
 before_a integer NOT NULL CHECK(before_a>=0), before_r integer NOT NULL CHECK(before_r>=0),
 after_a integer NOT NULL CHECK(after_a>=0), after_r integer NOT NULL CHECK(after_r>=0), delta_a integer NOT NULL, delta_r integer NOT NULL,
 quantity_released integer CHECK(quantity_released>=0), quantity_damaged integer CHECK(quantity_damaged>=0),
 source_line_id uuid REFERENCES inventory_source_line(id) ON DELETE RESTRICT,
 root_adjustment_line_id uuid REFERENCES inventory_adjustment_line(id) ON DELETE RESTRICT,
 business_type varchar(40) NOT NULL, business_id uuid NOT NULL, business_number varchar(64) NOT NULL, reason varchar(500) NOT NULL,
 actor_type "AuditActorType" NOT NULL, actor_employee_id uuid REFERENCES employee(id) ON DELETE RESTRICT,
 actor_customer_id uuid REFERENCES customer(id) ON DELETE RESTRICT, request_id varchar(64) NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(action_id,sku_id,sequence),
 CHECK(after_a::bigint-before_a::bigint=delta_a::bigint AND after_r::bigint-before_r::bigint=delta_r::bigint),
 CHECK(quantity_damaged IS NULL OR (quantity_released IS NOT NULL AND quantity_damaged<=quantity_released)),
 CHECK((actor_type='EMPLOYEE' AND actor_employee_id IS NOT NULL AND actor_customer_id IS NULL)
 OR (actor_type='CUSTOMER' AND actor_customer_id IS NOT NULL AND actor_employee_id IS NULL)
 OR (actor_type='SYSTEM' AND actor_employee_id IS NULL AND actor_customer_id IS NULL))
);
CREATE INDEX inventory_ledger_sku_id_created_at_id_idx ON inventory_ledger(sku_id,created_at,id);
CREATE INDEX inventory_ledger_business_type_business_id_idx ON inventory_ledger(business_type,business_id);
CREATE INDEX inventory_ledger_event_type_created_at_idx ON inventory_ledger(event_type,created_at);
CREATE INDEX inventory_ledger_source_line_id_idx ON inventory_ledger(source_line_id);
CREATE TABLE inventory_purchase_block (
 id uuid PRIMARY KEY, sku_id uuid NOT NULL REFERENCES inventory_balance(sku_id) ON DELETE RESTRICT,
 source_type varchar(40) NOT NULL CHECK(source_type IN ('ADJUSTMENT','ORDER_STOCK_EXCEPTION','PHYSICAL_CHECK')),
 source_id uuid NOT NULL, reason_code varchar(80) NOT NULL, active boolean NOT NULL DEFAULT true,
 created_by_employee_id uuid REFERENCES employee(id) ON DELETE RESTRICT, released_at timestamptz(3),
 version integer NOT NULL DEFAULT 0 CHECK(version>=0), created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(active=(released_at IS NULL))
);
CREATE INDEX inventory_purchase_block_sku_id_active_idx ON inventory_purchase_block(sku_id,active);
CREATE UNIQUE INDEX inventory_purchase_block_active_unique ON inventory_purchase_block(sku_id,source_type,source_id) WHERE active;
-- PostgreSQL整数本身提供上限；显式写出预警范围以便审查。
ALTER TABLE inventory_balance ADD CONSTRAINT inventory_warning_range CHECK(warning_threshold BETWEEN 0 AND 2147483647);
CREATE FUNCTION inventory_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'inventory history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER inventory_action_immutable BEFORE UPDATE OR DELETE ON inventory_action FOR EACH ROW EXECUTE FUNCTION inventory_history_immutable();
CREATE TRIGGER inventory_ledger_immutable BEFORE UPDATE OR DELETE ON inventory_ledger FOR EACH ROW EXECUTE FUNCTION inventory_history_immutable();
CREATE TRIGGER inventory_batch_immutable BEFORE UPDATE OR DELETE ON inventory_receipt_batch FOR EACH ROW EXECUTE FUNCTION inventory_history_immutable();
CREATE FUNCTION inventory_posted_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status<>'PENDING' THEN RAISE EXCEPTION 'closed adjustment is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER inventory_adjustment_closed BEFORE UPDATE OR DELETE ON inventory_adjustment FOR EACH ROW EXECUTE FUNCTION inventory_posted_immutable();
CREATE FUNCTION inventory_line_pending_only() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id uuid;
BEGIN
 parent_id:=CASE WHEN TG_OP='INSERT' THEN NEW.adjustment_id ELSE OLD.adjustment_id END;
 IF NOT EXISTS(SELECT 1 FROM inventory_adjustment WHERE id=parent_id AND status='PENDING') THEN
 RAISE EXCEPTION 'closed adjustment lines are immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER inventory_line_closed BEFORE INSERT OR UPDATE OR DELETE ON inventory_adjustment_line FOR EACH ROW EXECUTE FUNCTION inventory_line_pending_only();
