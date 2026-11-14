-- 增量迁移：不改写既有账号资料、密码、会话、库存或已应用迁移。
ALTER TABLE customer ADD COLUMN status_version INTEGER NOT NULL DEFAULT 0 CHECK(status_version>=0);
CREATE INDEX customer_created_at_id_idx ON customer(created_at,id);
CREATE TABLE customer_status_history (
 id UUID PRIMARY KEY, customer_id UUID NOT NULL REFERENCES customer(id) ON DELETE RESTRICT,
 from_status "CustomerStatus" NOT NULL, to_status "CustomerStatus" NOT NULL,
 from_version INTEGER NOT NULL CHECK(from_version>=0), to_version INTEGER NOT NULL,
 reason VARCHAR(500) NOT NULL CHECK(length(btrim(reason))>0),
 actor_employee_id UUID NOT NULL REFERENCES employee(id) ON DELETE RESTRICT,
 request_id VARCHAR(64) NOT NULL, created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT customer_status_history_customer_id_to_version_key UNIQUE(customer_id,to_version),
 CONSTRAINT customer_status_history_transition_check CHECK(from_status<>to_status AND to_version=from_version::bigint+1)
);
CREATE INDEX customer_status_history_customer_id_created_at_id_idx ON customer_status_history(customer_id,created_at,id);
CREATE FUNCTION preserve_customer_status_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'customer status history is append only' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER customer_status_history_append_only BEFORE UPDATE OR DELETE ON customer_status_history
 FOR EACH ROW EXECUTE FUNCTION preserve_customer_status_history();
CREATE TABLE address (
 id UUID PRIMARY KEY, customer_id UUID NOT NULL REFERENCES customer(id) ON DELETE RESTRICT,
 receiver VARCHAR(40) NOT NULL CHECK(length(btrim(receiver))>0), phone VARCHAR(30) NOT NULL CHECK(length(btrim(phone))>0),
 province VARCHAR(50) NOT NULL CHECK(length(btrim(province))>0), city VARCHAR(50) NOT NULL CHECK(length(btrim(city))>0),
 district VARCHAR(50) NOT NULL CHECK(length(btrim(district))>0), detail VARCHAR(200) NOT NULL CHECK(length(btrim(detail))>0),
 is_default BOOLEAN NOT NULL DEFAULT false, version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0),
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX address_customer_id_is_default_created_at_id_idx ON address(customer_id,is_default,created_at,id);
CREATE UNIQUE INDEX address_one_default_per_customer ON address(customer_id) WHERE is_default;
CREATE TABLE cart_item (
 id UUID PRIMARY KEY, customer_id UUID NOT NULL REFERENCES customer(id) ON DELETE RESTRICT,
 sku_id UUID NOT NULL REFERENCES sku(id) ON DELETE RESTRICT, quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 99),
 selected BOOLEAN NOT NULL DEFAULT true, version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0),
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT cart_item_customer_id_sku_id_key UNIQUE(customer_id,sku_id)
);
CREATE INDEX cart_item_customer_id_updated_at_id_idx ON cart_item(customer_id,updated_at,id);
