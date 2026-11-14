-- 作用：增量扩展公开图片引用白名单；只允许可信订单快照引用，不放宽私有证据。
BEGIN;
ALTER TABLE file_reference DROP CONSTRAINT file_reference_public_owner_valid;
ALTER TABLE file_reference ADD CONSTRAINT file_reference_public_owner_valid CHECK (
  audience <> 'PUBLIC' OR owner_type IN ('CUSTOMER_AVATAR', 'PRODUCT', 'ORDER_ITEM'));
ALTER TABLE file_reference ADD CONSTRAINT file_reference_order_snapshot_valid CHECK (
  owner_type <> 'ORDER_ITEM' OR (audience = 'PUBLIC' AND slot = 'snapshot'));
COMMIT;
