-- 作用：新增文件、引用、沟通及状态历史基础，保留已有账号与审计数据。
-- CreateEnum
CREATE TYPE "FilePurpose" AS ENUM ('CUSTOMER_AVATAR', 'PRODUCT_IMAGE', 'AFTER_SALE_EVIDENCE', 'INVENTORY_EVIDENCE', 'FULFILLMENT_EVIDENCE', 'INSPECTION_EVIDENCE', 'COMMUNICATION_EVIDENCE');

-- CreateEnum
CREATE TYPE "FileAssetState" AS ENUM ('STAGED', 'RETAINED', 'PURGE_PENDING', 'PURGED');

-- CreateEnum
CREATE TYPE "FileVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "FileOwnerType" AS ENUM ('CUSTOMER_AVATAR', 'PRODUCT', 'AFTER_SALE_MATERIAL', 'INVENTORY_ADJUSTMENT', 'INVENTORY_SOURCE', 'FULFILLMENT_CHECK', 'RETURN_RECEIPT', 'RETURN_INSPECTION', 'COMMUNICATION', 'OFFLINE_CASE');

-- CreateEnum
CREATE TYPE "FileAudience" AS ENUM ('PUBLIC', 'CUSTOMER_VISIBLE', 'INTERNAL');

-- CreateEnum
CREATE TYPE "CommunicationScopeType" AS ENUM ('ORDER', 'AFTER_SALE');

-- CreateEnum
CREATE TYPE "CommunicationChannel" AS ENUM ('PHONE', 'EXTERNAL_MESSAGE', 'IN_PERSON', 'OTHER');

-- CreateEnum
CREATE TYPE "BusinessAggregateType" AS ENUM ('ORDER', 'FULFILLMENT', 'AFTER_SALE');

-- AlterTable
ALTER TABLE "customer" ADD COLUMN     "avatar_asset_id" UUID;

-- CreateTable
CREATE TABLE "file_asset" (
    "id" UUID NOT NULL,
    "uploader_type" "SubjectType" NOT NULL,
    "uploader_employee_id" UUID,
    "uploader_customer_id" UUID,
    "purpose" "FilePurpose" NOT NULL,
    "state" "FileAssetState" NOT NULL DEFAULT 'STAGED',
    "visibility" "FileVisibility" NOT NULL DEFAULT 'PRIVATE',
    "storage_key" VARCHAR(255) NOT NULL,
    "original_name" VARCHAR(200) NOT NULL,
    "mime_type" VARCHAR(32) NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purge_started_at" TIMESTAMPTZ(3),
    "purged_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "file_asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_reference" (
    "id" UUID NOT NULL,
    "file_asset_id" UUID NOT NULL,
    "owner_type" "FileOwnerType" NOT NULL,
    "owner_id" UUID NOT NULL,
    "slot" VARCHAR(50) NOT NULL,
    "audience" "FileAudience" NOT NULL,
    "created_by_type" "SubjectType" NOT NULL,
    "created_by_employee_id" UUID,
    "created_by_customer_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_reference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication" (
    "id" UUID NOT NULL,
    "scope_type" "CommunicationScopeType" NOT NULL,
    "scope_id" UUID NOT NULL,
    "author_employee_id" UUID NOT NULL,
    "channel" "CommunicationChannel" NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "result" TEXT NOT NULL,
    "next_step" VARCHAR(1000),
    "public_text" VARCHAR(2000),
    "corrects_id" UUID,
    "correction_reason" VARCHAR(500),
    "request_id" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_state_history" (
    "id" UUID NOT NULL,
    "aggregate_type" "BusinessAggregateType" NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "dimension" VARCHAR(50) NOT NULL,
    "command_key" VARCHAR(150) NOT NULL,
    "from_state" VARCHAR(80),
    "to_state" VARCHAR(80) NOT NULL,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_employee_id" UUID,
    "actor_customer_id" UUID,
    "reason" VARCHAR(500),
    "public_text" VARCHAR(2000),
    "request_id" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_state_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "file_asset_storage_key_key" ON "file_asset"("storage_key");

-- CreateIndex
CREATE INDEX "file_asset_state_expires_at_id_idx" ON "file_asset"("state", "expires_at", "id");

-- CreateIndex
CREATE INDEX "file_asset_uploader_customer_id_state_idx" ON "file_asset"("uploader_customer_id", "state");

-- CreateIndex
CREATE INDEX "file_asset_uploader_employee_id_state_idx" ON "file_asset"("uploader_employee_id", "state");

-- CreateIndex
CREATE INDEX "file_reference_owner_type_owner_id_idx" ON "file_reference"("owner_type", "owner_id");

-- CreateIndex
CREATE INDEX "file_reference_created_by_employee_id_idx" ON "file_reference"("created_by_employee_id");

-- CreateIndex
CREATE INDEX "file_reference_created_by_customer_id_idx" ON "file_reference"("created_by_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "file_reference_asset_owner_slot_key" ON "file_reference"("file_asset_id", "owner_type", "owner_id", "slot");

-- CreateIndex
CREATE INDEX "communication_scope_type_scope_id_created_at_id_idx" ON "communication"("scope_type", "scope_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "communication_author_employee_id_created_at_idx" ON "communication"("author_employee_id", "created_at");

-- CreateIndex
CREATE INDEX "communication_corrects_id_idx" ON "communication"("corrects_id");

-- CreateIndex
CREATE INDEX "business_state_history_aggregate_time_idx" ON "business_state_history"("aggregate_type", "aggregate_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "business_state_history_actor_employee_id_idx" ON "business_state_history"("actor_employee_id");

-- CreateIndex
CREATE INDEX "business_state_history_actor_customer_id_idx" ON "business_state_history"("actor_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "business_state_history_command_key" ON "business_state_history"("aggregate_type", "aggregate_id", "dimension", "command_key");

-- CreateIndex
CREATE INDEX "customer_avatar_asset_id_idx" ON "customer"("avatar_asset_id");

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_avatar_asset_id_fkey" FOREIGN KEY ("avatar_asset_id") REFERENCES "file_asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_asset" ADD CONSTRAINT "file_asset_uploader_employee_id_fkey" FOREIGN KEY ("uploader_employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_asset" ADD CONSTRAINT "file_asset_uploader_customer_id_fkey" FOREIGN KEY ("uploader_customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_reference" ADD CONSTRAINT "file_reference_file_asset_id_fkey" FOREIGN KEY ("file_asset_id") REFERENCES "file_asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_reference" ADD CONSTRAINT "file_reference_created_by_employee_id_fkey" FOREIGN KEY ("created_by_employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_reference" ADD CONSTRAINT "file_reference_created_by_customer_id_fkey" FOREIGN KEY ("created_by_customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication" ADD CONSTRAINT "communication_author_employee_id_fkey" FOREIGN KEY ("author_employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication" ADD CONSTRAINT "communication_corrects_id_fkey" FOREIGN KEY ("corrects_id") REFERENCES "communication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_state_history" ADD CONSTRAINT "business_state_history_actor_employee_id_fkey" FOREIGN KEY ("actor_employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_state_history" ADD CONSTRAINT "business_state_history_actor_customer_id_fkey" FOREIGN KEY ("actor_customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma不能声明的数据库底线随增量迁移交付；跨表业务资格仍由事务服务负责。
ALTER TABLE file_asset
 ADD CONSTRAINT file_asset_uploader_valid CHECK (
  (uploader_type = 'EMPLOYEE' AND uploader_employee_id IS NOT NULL AND uploader_customer_id IS NULL) OR
  (uploader_type = 'CUSTOMER' AND uploader_customer_id IS NOT NULL AND uploader_employee_id IS NULL)),
 ADD CONSTRAINT file_asset_public_purpose_valid CHECK (
  visibility = 'PRIVATE' OR purpose IN ('CUSTOMER_AVATAR', 'PRODUCT_IMAGE')),
 ADD CONSTRAINT file_asset_bytes_valid CHECK (byte_size BETWEEN 1 AND 5242880),
 ADD CONSTRAINT file_asset_dimensions_valid CHECK (
  width BETWEEN 1 AND 10000 AND height BETWEEN 1 AND 10000 AND width::bigint * height::bigint <= 40000000),
 ADD CONSTRAINT file_asset_mime_valid CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
 ADD CONSTRAINT file_asset_digest_valid CHECK (sha256 ~ '^[0-9a-f]{64}$'),
 ADD CONSTRAINT file_asset_storage_key_valid CHECK (char_length(btrim(storage_key)) > 0),
 ADD CONSTRAINT file_asset_version_nonnegative CHECK (version >= 0),
 ADD CONSTRAINT file_asset_expiration_valid CHECK (expires_at IS NULL OR expires_at > created_at),
 ADD CONSTRAINT file_asset_lifecycle_valid CHECK (
  (state = 'STAGED' AND visibility = 'PRIVATE' AND expires_at IS NOT NULL
   AND purge_started_at IS NULL AND purged_at IS NULL) OR
  (state = 'RETAINED' AND expires_at IS NULL AND purge_started_at IS NULL AND purged_at IS NULL) OR
  (state = 'PURGE_PENDING' AND visibility = 'PRIVATE' AND expires_at IS NOT NULL
   AND purge_started_at IS NOT NULL AND purge_started_at >= expires_at AND purged_at IS NULL) OR
  (state = 'PURGED' AND visibility = 'PRIVATE' AND expires_at IS NOT NULL
   AND purge_started_at IS NOT NULL AND purge_started_at >= expires_at
   AND purged_at IS NOT NULL AND purged_at >= purge_started_at));

ALTER TABLE file_reference
 ADD CONSTRAINT file_reference_creator_valid CHECK (
  (created_by_type = 'EMPLOYEE' AND created_by_employee_id IS NOT NULL AND created_by_customer_id IS NULL) OR
  (created_by_type = 'CUSTOMER' AND created_by_customer_id IS NOT NULL AND created_by_employee_id IS NULL)),
 ADD CONSTRAINT file_reference_slot_valid CHECK (char_length(btrim(slot)) > 0),
 ADD CONSTRAINT file_reference_public_owner_valid CHECK (
  audience <> 'PUBLIC' OR owner_type IN ('CUSTOMER_AVATAR', 'PRODUCT'));

ALTER TABLE communication
 ADD CONSTRAINT communication_result_valid CHECK (char_length(result) BETWEEN 1 AND 4000 AND char_length(btrim(result)) > 0),
 ADD CONSTRAINT communication_correction_valid CHECK (
  (corrects_id IS NULL AND correction_reason IS NULL) OR
  (corrects_id IS NOT NULL AND corrects_id <> id AND correction_reason IS NOT NULL
   AND char_length(btrim(correction_reason)) > 0)),
 -- 与固定的录入时刻比较，不使用随时间变化的now()作为CHECK依据。
 ADD CONSTRAINT communication_occurred_at_valid CHECK (occurred_at <= created_at + interval '5 minutes'),
 ADD CONSTRAINT communication_request_id_valid CHECK (char_length(btrim(request_id)) > 0);

ALTER TABLE business_state_history
 ADD CONSTRAINT business_state_history_actor_valid CHECK (
  (actor_type = 'EMPLOYEE' AND actor_employee_id IS NOT NULL AND actor_customer_id IS NULL) OR
  (actor_type = 'CUSTOMER' AND actor_customer_id IS NOT NULL AND actor_employee_id IS NULL) OR
  (actor_type = 'SYSTEM' AND actor_employee_id IS NULL AND actor_customer_id IS NULL)),
 ADD CONSTRAINT business_state_history_values_valid CHECK (
  char_length(btrim(dimension)) > 0 AND char_length(btrim(command_key)) > 0
  AND char_length(btrim(to_state)) > 0 AND (from_state IS NULL OR char_length(btrim(from_state)) > 0)),
 ADD CONSTRAINT business_state_history_request_id_valid CHECK (char_length(btrim(request_id)) > 0);

