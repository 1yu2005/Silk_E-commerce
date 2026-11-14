-- 作用：补充履约指针归属及持久事实保护；不修改已在隔离库执行的0011。
ALTER TYPE "FileOwnerType" ADD VALUE 'SHIPMENT_EXCEPTION_DECISION';
ALTER TABLE shipment_exception_decision DROP CONSTRAINT shipment_exception_decision_check;
ALTER TABLE shipment_exception_decision ADD CONSTRAINT shipment_exception_decision_check CHECK(kind IN ('WAREHOUSE_READY','CUSTOMER_WAIT','CUSTOMER_CONTINUE','CUSTOMER_REQUEST_REFUND','RESOLUTION') AND physical_version>=0 AND length(btrim(description))>0);
CREATE UNIQUE INDEX packing_id_fulfillment_key ON packing_check(id,fulfillment_id);
ALTER TABLE fulfillment ADD CONSTRAINT fulfillment_packing_owner_fkey FOREIGN KEY(current_packing_check_id,id) REFERENCES packing_check(id,fulfillment_id) ON DELETE RESTRICT;
CREATE FUNCTION handover_fact_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'handover facts cannot be deleted'; END IF;
 IF OLD.status IN ('HANDED_OVER','NOT_HANDED_OVER') THEN RAISE EXCEPTION 'resolved handover is immutable'; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','resolved_by_id','resolved_at','actual_handover_at','procedure_violation','resolution_reason','version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','resolved_by_id','resolved_at','actual_handover_at','procedure_violation','resolution_reason','version']) THEN RAISE EXCEPTION 'handover start snapshot is immutable'; END IF;
 IF OLD.status='UNCERTAIN' AND NEW.status='IN_PROGRESS' THEN RAISE EXCEPTION 'uncertain handover requires verification'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER handover_fact_immutable BEFORE UPDATE OR DELETE ON handover_attempt FOR EACH ROW EXECUTE FUNCTION handover_fact_guard();
CREATE FUNCTION shipment_fact_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'shipment cannot be deleted'; END IF;
 IF NEW.id<>OLD.id OR NEW.order_id<>OLD.order_id OR NEW.prepared_by_id<>OLD.prepared_by_id OR NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION 'shipment ownership is immutable'; END IF;
 IF OLD.status='CONFIRMED' AND (NEW.status<>OLD.status OR NEW.confirmed_attempt_id IS DISTINCT FROM OLD.confirmed_attempt_id OR NEW.actual_handover_at IS DISTINCT FROM OLD.actual_handover_at OR NEW.confirmed_by_id IS DISTINCT FROM OLD.confirmed_by_id) THEN RAISE EXCEPTION 'actual shipment is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER shipment_fact_immutable BEFORE UPDATE OR DELETE ON shipment FOR EACH ROW EXECUTE FUNCTION shipment_fact_guard();
