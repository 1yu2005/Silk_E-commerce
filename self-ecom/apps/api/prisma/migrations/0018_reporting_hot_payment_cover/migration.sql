CREATE INDEX "payment_succeeded_order_paid_at_idx" ON "payment"("order_id") INCLUDE ("paid_at") WHERE "status"='SUCCEEDED';
