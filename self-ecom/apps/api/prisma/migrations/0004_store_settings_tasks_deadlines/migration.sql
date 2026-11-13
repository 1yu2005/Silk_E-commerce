-- 作用：增量建立全店配置、任务期限与调度记录；完整迁移同事务，不改已有业务数据。
BEGIN;

-- CreateEnum
CREATE TYPE "TaskBusinessType" AS ENUM ('INVENTORY_ADJUSTMENT', 'ORDER', 'AFTER_SALE', 'OFFLINE_CASE', 'CUSTODY_ARRANGEMENT');

-- CreateEnum
CREATE TYPE "TaskStage" AS ENUM ('INVENTORY_POST', 'INVENTORY_RECONCILE', 'SHIPMENT_PROCESS', 'HANDOVER_VERIFY', 'PHYSICAL_VERIFY', 'STOCK_EXCEPTION_VERIFY', 'SHIPMENT_EXCEPTION_VERIFY', 'CUSTOMER_CONTACT', 'AFTER_SALE_REVIEW', 'SUPPLEMENT_FOLLOW', 'RETURN_FOLLOW', 'RETURN_RECEIVE', 'RETURN_INSPECT', 'INSPECTION_EXCEPTION_CONTACT', 'REFUND_PROCESS', 'ADMIN_DISPUTE', 'ADMIN_STOCK_REVIEW', 'PROXY_INPUT', 'OFFLINE_FOLLOW', 'CUSTODY_EXECUTE');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'CLAIMED', 'SUSPENDED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskHistoryAction" AS ENUM ('CREATED', 'CLAIMED', 'RELEASED', 'TRANSFERRED', 'QUALIFICATION_LOST', 'SUSPENDED', 'RESUMED', 'COMPLETED', 'CANCELLED', 'DEADLINE_CHANGED');

-- CreateEnum
CREATE TYPE "TaskActorType" AS ENUM ('EMPLOYEE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "DeadlineEventType" AS ENUM ('OVERDUE', 'EXTENDED', 'DEADLINE_ASSIGNED');

-- CreateEnum
CREATE TYPE "SchedulerRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL_FAILED', 'FAILED', 'ABANDONED');

-- CreateTable
CREATE TABLE "store_setting_head" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "current_version_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "store_setting_head_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_setting_version" (
    "id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "created_by_employee_id" UUID,
    "reason" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shipping_fee_cents" INTEGER NOT NULL,
    "free_shipping_enabled" BOOLEAN NOT NULL,
    "free_shipping_threshold_cents" INTEGER NOT NULL,
    "return_receiver" VARCHAR(40) NOT NULL,
    "return_phone" VARCHAR(30) NOT NULL,
    "return_province" VARCHAR(50) NOT NULL,
    "return_city" VARCHAR(50) NOT NULL,
    "return_district" VARCHAR(50) NOT NULL,
    "return_detail" VARCHAR(200) NOT NULL,
    "service_phone" VARCHAR(30) NOT NULL,
    "service_hours" VARCHAR(100),
    "payment_minutes" INTEGER NOT NULL,
    "auto_receipt_days" INTEGER NOT NULL,
    "after_sale_window_days" INTEGER NOT NULL,
    "review_workdays" INTEGER NOT NULL,
    "supplement_days" INTEGER NOT NULL,
    "return_ship_days" INTEGER NOT NULL,
    "inspection_workdays" INTEGER NOT NULL,
    "refund_workdays" INTEGER NOT NULL,

    CONSTRAINT "store_setting_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_stage_cursor" (
    "id" UUID NOT NULL,
    "business_type" "TaskBusinessType" NOT NULL,
    "business_id" UUID NOT NULL,
    "stage" "TaskStage" NOT NULL,
    "last_round" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "task_stage_cursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task" (
    "id" UUID NOT NULL,
    "cursor_id" UUID NOT NULL,
    "business_type" "TaskBusinessType" NOT NULL,
    "business_id" UUID NOT NULL,
    "stage" "TaskStage" NOT NULL,
    "round" INTEGER NOT NULL,
    "entry_key" VARCHAR(150) NOT NULL,
    "required_permissions" JSONB NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "assignee_id" UUID,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "original_due_at" TIMESTAMPTZ(3),
    "due_at" TIMESTAMPTZ(3),
    "settings_version_id" UUID,
    "rule_snapshot" JSONB NOT NULL,
    "ever_overdue" BOOLEAN NOT NULL DEFAULT false,
    "first_overdue_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "reassign_needed" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_history" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "action" "TaskHistoryAction" NOT NULL,
    "actor_type" "TaskActorType" NOT NULL,
    "actor_employee_id" UUID,
    "from_assignee_id" UUID,
    "to_assignee_id" UUID,
    "before_status" "TaskStatus",
    "after_status" "TaskStatus" NOT NULL,
    "reason" VARCHAR(500),
    "command_key" VARCHAR(150) NOT NULL,
    "request_id" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deadline_event" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "event_type" "DeadlineEventType" NOT NULL,
    "deadline_at" TIMESTAMPTZ(3) NOT NULL,
    "new_due_at" TIMESTAMPTZ(3),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "detected_at" TIMESTAMPTZ(3) NOT NULL,
    "actor_type" "TaskActorType" NOT NULL,
    "actor_employee_id" UUID,
    "reason" VARCHAR(500),
    "command_key" VARCHAR(150) NOT NULL,
    "request_id" VARCHAR(64) NOT NULL,

    CONSTRAINT "deadline_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduler_run" (
    "id" UUID NOT NULL,
    "job_name" VARCHAR(80) NOT NULL,
    "instance_id" VARCHAR(100) NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "status" "SchedulerRunStatus" NOT NULL DEFAULT 'RUNNING',
    "scanned_count" INTEGER NOT NULL DEFAULT 0,
    "changed_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "request_id" VARCHAR(64) NOT NULL,

    CONSTRAINT "scheduler_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduler_failure" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "task_id" UUID,
    "error_code" VARCHAR(80) NOT NULL,
    "sanitized_message" VARCHAR(500) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduler_failure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_setting_version_version_number_key" ON "store_setting_version"("version_number");

-- CreateIndex
CREATE INDEX "store_setting_version_created_at_id_idx" ON "store_setting_version"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "store_setting_version_id_number_key" ON "store_setting_version"("id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "task_stage_cursor_business_stage_key" ON "task_stage_cursor"("business_type", "business_id", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "task_stage_cursor_id_business_stage_key" ON "task_stage_cursor"("id", "business_type", "business_id", "stage");

-- CreateIndex
CREATE INDEX "task_assignee_status_due_idx" ON "task"("assignee_id", "status", "due_at", "id");

-- CreateIndex
CREATE INDEX "task_status_due_idx" ON "task"("status", "due_at", "id");

-- CreateIndex
CREATE INDEX "task_reassign_needed_status_idx" ON "task"("reassign_needed", "status");

-- CreateIndex
CREATE INDEX "task_business_type_business_id_idx" ON "task"("business_type", "business_id");

-- CreateIndex
CREATE INDEX "task_settings_version_id_idx" ON "task"("settings_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_business_stage_round_key" ON "task"("business_type", "business_id", "stage", "round");

-- CreateIndex
CREATE UNIQUE INDEX "task_business_stage_entry_key" ON "task"("business_type", "business_id", "stage", "entry_key");

-- CreateIndex
CREATE INDEX "task_history_time_idx" ON "task_history"("task_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "task_history_command_key" ON "task_history"("task_id", "action", "command_key");

-- CreateIndex
CREATE INDEX "deadline_event_time_idx" ON "deadline_event"("task_id", "occurred_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "deadline_event_command_key" ON "deadline_event"("task_id", "event_type", "command_key");

-- CreateIndex
CREATE INDEX "scheduler_run_job_name_started_at_idx" ON "scheduler_run"("job_name", "started_at");

-- CreateIndex
CREATE INDEX "scheduler_run_status_started_at_idx" ON "scheduler_run"("status", "started_at");

-- CreateIndex
CREATE INDEX "scheduler_failure_run_id_occurred_at_idx" ON "scheduler_failure"("run_id", "occurred_at");

-- CreateIndex
CREATE INDEX "scheduler_failure_task_id_idx" ON "scheduler_failure"("task_id");

-- AddForeignKey
ALTER TABLE "store_setting_head" ADD CONSTRAINT "store_setting_head_current_version_id_version_fkey" FOREIGN KEY ("current_version_id", "version") REFERENCES "store_setting_version"("id", "version_number") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "store_setting_version" ADD CONSTRAINT "store_setting_version_created_by_employee_id_fkey" FOREIGN KEY ("created_by_employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_cursor_id_business_type_business_id_stage_fkey" FOREIGN KEY ("cursor_id", "business_type", "business_id", "stage") REFERENCES "task_stage_cursor"("id", "business_type", "business_id", "stage") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_settings_version_id_fkey" FOREIGN KEY ("settings_version_id") REFERENCES "store_setting_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_history" ADD CONSTRAINT "task_history_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_history" ADD CONSTRAINT "task_history_actor_employee_id_fkey" FOREIGN KEY ("actor_employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_history" ADD CONSTRAINT "task_history_from_assignee_id_fkey" FOREIGN KEY ("from_assignee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_history" ADD CONSTRAINT "task_history_to_assignee_id_fkey" FOREIGN KEY ("to_assignee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deadline_event" ADD CONSTRAINT "deadline_event_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deadline_event" ADD CONSTRAINT "deadline_event_actor_employee_id_fkey" FOREIGN KEY ("actor_employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduler_failure" ADD CONSTRAINT "scheduler_failure_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "scheduler_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduler_failure" ADD CONSTRAINT "scheduler_failure_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma模型之外的字段底线与部分唯一索引必须随正式迁移交付。
ALTER TABLE store_setting_head
 ADD CONSTRAINT store_setting_head_singleton CHECK (id = 1),
 ADD CONSTRAINT store_setting_head_pointer_valid CHECK (
  (version = 0 AND current_version_id IS NULL) OR (version > 0 AND current_version_id IS NOT NULL));

ALTER TABLE store_setting_version
 ADD CONSTRAINT store_setting_version_number_positive CHECK (version_number > 0),
 ADD CONSTRAINT store_setting_reason_valid CHECK (char_length(btrim(reason)) > 0),
 ADD CONSTRAINT store_setting_money_valid CHECK (
  shipping_fee_cents BETWEEN 0 AND 1000000 AND free_shipping_threshold_cents BETWEEN 0 AND 100000000),
 ADD CONSTRAINT store_setting_address_valid CHECK (
  char_length(btrim(return_receiver)) > 0 AND char_length(btrim(return_province)) > 0
  AND char_length(btrim(return_city)) > 0 AND char_length(btrim(return_district)) > 0
  AND char_length(btrim(return_detail)) > 0),
 ADD CONSTRAINT store_setting_phone_valid CHECK (
  char_length(return_phone) BETWEEN 3 AND 30 AND return_phone ~ '^\+?[0-9][0-9 -]*$'
  AND char_length(service_phone) BETWEEN 3 AND 30 AND service_phone ~ '^\+?[0-9][0-9 -]*$'),
 ADD CONSTRAINT store_setting_deadlines_valid CHECK (
  payment_minutes BETWEEN 1 AND 1440 AND auto_receipt_days BETWEEN 1 AND 365
  AND after_sale_window_days BETWEEN 1 AND 365 AND review_workdays BETWEEN 1 AND 30
  AND supplement_days BETWEEN 1 AND 90 AND return_ship_days BETWEEN 1 AND 90
  AND inspection_workdays BETWEEN 1 AND 30 AND refund_workdays BETWEEN 1 AND 30);

ALTER TABLE task_stage_cursor
 ADD CONSTRAINT task_stage_cursor_round_valid CHECK (last_round >= 0),
 ADD CONSTRAINT task_stage_business_valid CHECK (
  (business_type = 'INVENTORY_ADJUSTMENT' AND stage IN ('INVENTORY_POST', 'INVENTORY_RECONCILE')) OR
  (business_type = 'ORDER' AND stage IN ('SHIPMENT_PROCESS', 'HANDOVER_VERIFY', 'PHYSICAL_VERIFY',
   'STOCK_EXCEPTION_VERIFY', 'SHIPMENT_EXCEPTION_VERIFY', 'CUSTOMER_CONTACT', 'ADMIN_STOCK_REVIEW', 'PROXY_INPUT')) OR
  (business_type = 'AFTER_SALE' AND stage IN ('AFTER_SALE_REVIEW', 'SUPPLEMENT_FOLLOW', 'RETURN_FOLLOW',
   'RETURN_RECEIVE', 'RETURN_INSPECT', 'INSPECTION_EXCEPTION_CONTACT', 'REFUND_PROCESS', 'ADMIN_DISPUTE')) OR
  (business_type = 'OFFLINE_CASE' AND stage IN ('OFFLINE_FOLLOW', 'ADMIN_DISPUTE')) OR
  (business_type = 'CUSTODY_ARRANGEMENT' AND stage = 'CUSTODY_EXECUTE'));

ALTER TABLE task
 ADD CONSTRAINT task_round_version_valid CHECK (round > 0 AND version >= 0),
 ADD CONSTRAINT task_entry_key_valid CHECK (char_length(btrim(entry_key)) > 0),
 ADD CONSTRAINT task_assignee_status_valid CHECK (
  (status = 'CLAIMED' AND assignee_id IS NOT NULL) OR (status <> 'CLAIMED' AND assignee_id IS NULL)),
 ADD CONSTRAINT task_closed_status_valid CHECK (
  (status IN ('COMPLETED', 'CANCELLED') AND closed_at IS NOT NULL AND closed_at >= started_at) OR
  (status IN ('OPEN', 'CLAIMED', 'SUSPENDED') AND closed_at IS NULL)),
 ADD CONSTRAINT task_deadline_valid CHECK (
  (due_at IS NULL OR due_at >= started_at) AND
  (original_due_at IS NULL OR (original_due_at >= started_at AND due_at IS NOT NULL AND due_at >= original_due_at))),
 ADD CONSTRAINT task_overdue_valid CHECK (
  (ever_overdue AND first_overdue_at IS NOT NULL AND first_overdue_at >= started_at) OR
  (NOT ever_overdue AND first_overdue_at IS NULL)),
 ADD CONSTRAINT task_permissions_valid CHECK (CASE WHEN jsonb_typeof(required_permissions) = 'array' THEN
  jsonb_array_length(required_permissions) BETWEEN 1 AND 52
  AND NOT jsonb_path_exists(required_permissions, '$[*] ? (@.type() != "string")')
  AND NOT jsonb_path_exists(required_permissions, '$[*] ? (!(@ like_regex "^[a-z][a-z0-9.-]{0,99}$"))')
  ELSE false END),
 ADD CONSTRAINT task_rule_snapshot_valid CHECK (jsonb_typeof(rule_snapshot) = 'object');

CREATE UNIQUE INDEX task_one_active_stage_key ON task(business_type, business_id, stage)
 WHERE status IN ('OPEN', 'CLAIMED', 'SUSPENDED');

ALTER TABLE task_history
 ADD CONSTRAINT task_history_actor_valid CHECK (
  (actor_type = 'EMPLOYEE' AND actor_employee_id IS NOT NULL) OR
  (actor_type = 'SYSTEM' AND actor_employee_id IS NULL)),
 ADD CONSTRAINT task_history_assignees_valid CHECK (
  (CASE WHEN before_status = 'CLAIMED' THEN from_assignee_id IS NOT NULL ELSE from_assignee_id IS NULL END) AND
  (CASE WHEN after_status = 'CLAIMED' THEN to_assignee_id IS NOT NULL ELSE to_assignee_id IS NULL END)),
 ADD CONSTRAINT task_history_values_valid CHECK (
  char_length(btrim(command_key)) > 0 AND char_length(btrim(request_id)) > 0
  AND (reason IS NULL OR char_length(btrim(reason)) > 0)),
 ADD CONSTRAINT task_history_reason_required CHECK (
  action NOT IN ('RELEASED', 'TRANSFERRED', 'QUALIFICATION_LOST', 'DEADLINE_CHANGED') OR reason IS NOT NULL);

ALTER TABLE deadline_event
 ADD CONSTRAINT deadline_event_actor_valid CHECK (
  (actor_type = 'EMPLOYEE' AND actor_employee_id IS NOT NULL) OR
  (actor_type = 'SYSTEM' AND actor_employee_id IS NULL)),
 ADD CONSTRAINT deadline_event_values_valid CHECK (
  char_length(btrim(command_key)) > 0 AND char_length(btrim(request_id)) > 0
  AND (reason IS NULL OR char_length(btrim(reason)) > 0) AND detected_at >= occurred_at),
 ADD CONSTRAINT deadline_event_type_valid CHECK (
  (event_type = 'OVERDUE' AND new_due_at IS NULL AND occurred_at = deadline_at) OR
  (event_type = 'EXTENDED' AND new_due_at IS NOT NULL AND new_due_at > deadline_at
   AND new_due_at > occurred_at AND reason IS NOT NULL) OR
  (event_type = 'DEADLINE_ASSIGNED' AND new_due_at IS NOT NULL AND new_due_at = deadline_at
   AND new_due_at > occurred_at AND reason IS NOT NULL));

CREATE UNIQUE INDEX deadline_event_one_overdue_key ON deadline_event(task_id, deadline_at)
 WHERE event_type = 'OVERDUE';

ALTER TABLE scheduler_run
 ADD CONSTRAINT scheduler_run_values_valid CHECK (
  char_length(btrim(job_name)) > 0 AND char_length(btrim(instance_id)) > 0 AND char_length(btrim(request_id)) > 0),
 ADD CONSTRAINT scheduler_run_counts_valid CHECK (scanned_count >= 0 AND changed_count >= 0 AND failed_count >= 0),
 ADD CONSTRAINT scheduler_run_lifecycle_valid CHECK (
  (status = 'RUNNING' AND finished_at IS NULL) OR
  (status <> 'RUNNING' AND finished_at IS NOT NULL AND finished_at >= started_at));

ALTER TABLE scheduler_failure
 ADD CONSTRAINT scheduler_failure_values_valid CHECK (
  char_length(btrim(error_code)) > 0 AND char_length(btrim(sanitized_message)) > 0);

-- 只建立未配置锁锚点，不猜测经营地址、电话，不创建演示任务或业务单。
INSERT INTO store_setting_head (id, current_version_id, version) VALUES (1, NULL, 0);

COMMIT;
