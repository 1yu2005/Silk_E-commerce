-- 撤销误登记只保留更正记录，不删除包裹、物流、实收或核对历史。
ALTER TABLE return_parcel
 ADD COLUMN cancelled_at timestamptz(3),
 ADD COLUMN cancellation_reason varchar(500),
 ADD COLUMN cancelled_by_id uuid REFERENCES employee(id) ON DELETE RESTRICT,
 ADD CONSTRAINT return_parcel_cancellation_complete CHECK (
  (cancelled_at IS NULL AND cancellation_reason IS NULL AND cancelled_by_id IS NULL)
  OR (cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL AND length(trim(cancellation_reason))>0 AND cancelled_by_id IS NOT NULL)
 );
CREATE FUNCTION return_parcel_cancellation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='return_parcel' THEN
  IF OLD.cancelled_at IS NOT NULL AND (NEW.cancelled_at,NEW.cancellation_reason,NEW.cancelled_by_id) IS DISTINCT FROM (OLD.cancelled_at,OLD.cancellation_reason,OLD.cancelled_by_id) THEN
   RAISE EXCEPTION 'parcel cancellation history is immutable';
  END IF;
  IF NEW.cancelled_at IS NOT NULL AND (NEW.origin<>'WAREHOUSE_UNANNOUNCED' OR NEW.reshipment_request_id IS NOT NULL OR NEW.current_revision_id IS NOT NULL
   OR EXISTS(SELECT 1 FROM return_receipt WHERE parcel_id=NEW.id) OR EXISTS(SELECT 1 FROM return_logistics_revision WHERE parcel_id=NEW.id)) THEN
   RAISE EXCEPTION 'only unreceived warehouse declarations without logistics can be cancelled';
  END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM return_parcel WHERE id=NEW.parcel_id AND cancelled_at IS NOT NULL) THEN
   RAISE EXCEPTION 'cancelled parcel cannot receive logistics or goods';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER return_parcel_cancellation BEFORE UPDATE ON return_parcel FOR EACH ROW EXECUTE FUNCTION return_parcel_cancellation_guard();
CREATE TRIGGER return_receipt_cancelled_parcel BEFORE INSERT OR UPDATE ON return_receipt FOR EACH ROW EXECUTE FUNCTION return_parcel_cancellation_guard();
CREATE TRIGGER return_logistics_cancelled_parcel BEFORE INSERT OR UPDATE ON return_logistics_revision FOR EACH ROW EXECUTE FUNCTION return_parcel_cancellation_guard();
