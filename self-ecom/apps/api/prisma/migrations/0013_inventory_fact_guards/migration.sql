-- 作用：增量补齐库存转换状态和已入账明细保护，不修改旧事实或已应用迁移。
-- 默认验证全部旧行；若已有转换状态与链接不一致，停止迁移，不能修数据绕过。
ALTER TABLE initial_inventory_draft ADD CONSTRAINT initial_draft_conversion_link
 CHECK((status='CONVERTED')=(adjustment_id IS NOT NULL));

CREATE OR REPLACE FUNCTION inventory_line_pending_only() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id uuid;
BEGIN
 parent_id:=CASE WHEN TG_OP='INSERT' THEN NEW.adjustment_id ELSE OLD.adjustment_id END;
 IF NOT EXISTS(SELECT 1 FROM inventory_adjustment WHERE id=parent_id AND status='PENDING') THEN
  RAISE EXCEPTION 'closed adjustment lines are immutable' USING ERRCODE='23514';
 END IF;
 -- UPDATE原先只验证旧父单，不能把待确认明细转移到已入账或作废的父单。
 IF TG_OP='UPDATE' AND NEW.adjustment_id IS DISTINCT FROM OLD.adjustment_id
  AND NOT EXISTS(SELECT 1 FROM inventory_adjustment WHERE id=NEW.adjustment_id AND status='PENDING') THEN
  RAISE EXCEPTION 'closed adjustment lines are immutable' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
