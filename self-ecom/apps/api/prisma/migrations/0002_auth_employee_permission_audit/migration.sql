-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SubjectType" AS ENUM ('EMPLOYEE', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "EmployeeRole" AS ENUM ('SUPER_ADMIN', 'MERCH_WAREHOUSE', 'CUSTOMER_SERVICE');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('NORMAL', 'TRADE_RESTRICTED', 'LOGIN_FROZEN');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('EMPLOYEE', 'CUSTOMER', 'SYSTEM');

-- CreateTable
CREATE TABLE "employee" (
    "id" UUID NOT NULL,
    "username" VARCHAR(32) NOT NULL,
    "display_name" VARCHAR(40) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "EmployeeRole" NOT NULL,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "permission_version" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer" (
    "id" UUID NOT NULL,
    "phone" VARCHAR(11) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "nickname" VARCHAR(40) NOT NULL,
    "status" "CustomerStatus" NOT NULL DEFAULT 'NORMAL',
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_session" (
    "id" UUID NOT NULL,
    "subject_type" "SubjectType" NOT NULL,
    "employee_id" UUID,
    "customer_id" UUID,
    "token_version" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoke_reason" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission_definition" (
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" TEXT NOT NULL,
    "admin_only" BOOLEAN NOT NULL,
    "dependencies" JSONB NOT NULL,

    CONSTRAINT "permission_definition_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "role" "EmployeeRole" NOT NULL,
    "permission_code" VARCHAR(100) NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("role","permission_code")
);

-- CreateTable
CREATE TABLE "employee_extra_permission" (
    "employee_id" UUID NOT NULL,
    "permission_code" VARCHAR(100) NOT NULL,
    "granted_by_id" UUID NOT NULL,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_extra_permission_pkey" PRIMARY KEY ("employee_id","permission_code")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_employee_id" UUID,
    "actor_customer_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "target_type" VARCHAR(80) NOT NULL,
    "target_id" VARCHAR(100) NOT NULL,
    "reason" VARCHAR(500),
    "before_data" JSONB,
    "after_data" JSONB,
    "request_id" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_guard" (
    "key" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_guard_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_username_key" ON "employee"("username");

-- CreateIndex
CREATE INDEX "employee_status_role_idx" ON "employee"("status", "role");

-- CreateIndex
CREATE INDEX "employee_created_at_id_idx" ON "employee"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_phone_key" ON "customer"("phone");

-- CreateIndex
CREATE INDEX "customer_status_created_at_id_idx" ON "customer"("status", "created_at", "id");

-- CreateIndex
CREATE INDEX "auth_session_employee_id_expires_at_idx" ON "auth_session"("employee_id", "expires_at");

-- CreateIndex
CREATE INDEX "auth_session_customer_id_expires_at_idx" ON "auth_session"("customer_id", "expires_at");

-- CreateIndex
CREATE INDEX "auth_session_expires_at_idx" ON "auth_session"("expires_at");

-- CreateIndex
CREATE INDEX "audit_log_target_type_target_id_created_at_idx" ON "audit_log"("target_type", "target_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_actor_employee_id_created_at_idx" ON "audit_log"("actor_employee_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_action_created_at_idx" ON "audit_log"("action", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_request_id_idx" ON "audit_log"("request_id");

-- AddForeignKey
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_code_fkey" FOREIGN KEY ("permission_code") REFERENCES "permission_definition"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_extra_permission" ADD CONSTRAINT "employee_extra_permission_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_extra_permission" ADD CONSTRAINT "employee_extra_permission_permission_code_fkey" FOREIGN KEY ("permission_code") REFERENCES "permission_definition"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_extra_permission" ADD CONSTRAINT "employee_extra_permission_granted_by_id_fkey" FOREIGN KEY ("granted_by_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_employee_id_fkey" FOREIGN KEY ("actor_employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_customer_id_fkey" FOREIGN KEY ("actor_customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 主体输入、版本与时间的数据库底线；业务层仍需独立校验。
ALTER TABLE employee ADD CONSTRAINT employee_username_format CHECK (username ~ '^[a-z][a-z0-9_]{3,31}$'),
 ADD CONSTRAINT employee_versions_nonnegative CHECK (token_version >= 0 AND permission_version >= 0 AND version >= 0),
 ADD CONSTRAINT employee_display_name_valid CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 40),
 ADD CONSTRAINT employee_lifecycle_valid CHECK (updated_at >= created_at AND (last_login_at IS NULL OR last_login_at >= created_at));
ALTER TABLE customer ADD CONSTRAINT customer_phone_format CHECK (phone ~ '^1[3-9][0-9]{9}$'),
 ADD CONSTRAINT customer_version_nonnegative CHECK (token_version >= 0),
 ADD CONSTRAINT customer_nickname_valid CHECK (char_length(btrim(nickname)) BETWEEN 1 AND 40),
 ADD CONSTRAINT customer_lifecycle_valid CHECK (updated_at >= created_at AND (last_login_at IS NULL OR last_login_at >= created_at));
ALTER TABLE auth_session ADD CONSTRAINT auth_session_subject_valid CHECK (
 (subject_type = 'EMPLOYEE' AND employee_id IS NOT NULL AND customer_id IS NULL) OR
 (subject_type = 'CUSTOMER' AND customer_id IS NOT NULL AND employee_id IS NULL)),
 ADD CONSTRAINT auth_session_version_nonnegative CHECK (token_version >= 0),
 ADD CONSTRAINT auth_session_time_valid CHECK (expires_at > created_at AND (revoked_at IS NULL OR revoked_at >= created_at));
ALTER TABLE audit_log ADD CONSTRAINT audit_log_actor_valid CHECK (
 (actor_type = 'EMPLOYEE' AND actor_employee_id IS NOT NULL AND actor_customer_id IS NULL) OR
 (actor_type = 'CUSTOMER' AND actor_customer_id IS NOT NULL AND actor_employee_id IS NULL) OR
 (actor_type = 'SYSTEM' AND actor_employee_id IS NULL AND actor_customer_id IS NULL));
ALTER TABLE permission_definition ADD CONSTRAINT permission_dependencies_array CHECK (jsonb_typeof(dependencies) = 'array');
-- 稳定锁锚点随迁移创建；本阶段不创建账号或权限目录数据。
INSERT INTO system_guard (key) VALUES ('ADMIN_AVAILABILITY') ON CONFLICT (key) DO NOTHING;
