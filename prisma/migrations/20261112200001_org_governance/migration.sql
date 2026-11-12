-- CreateEnum
CREATE TYPE "WorkspaceStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "OrgRequestKind" AS ENUM ('NEW_ORG', 'MORE_LIMIT', 'FEATURE', 'OTHER');

-- CreateEnum
CREATE TYPE "OrgRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "status" "WorkspaceStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "statusReason" TEXT,
ADD COLUMN     "suspendedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WorkspaceLimits" (
    "workspaceId" TEXT NOT NULL,
    "maxMembers" INTEGER,
    "maxGuests" INTEGER,
    "maxProjects" INTEGER,
    "maxStorageBytes" BIGINT,
    "maxFileBytes" INTEGER,
    "maxApiTokens" INTEGER,
    "maxWebhooks" INTEGER,
    "assistantEnabled" BOOLEAN,
    "assistantMonthlyTokens" INTEGER,
    "monthlyEmailCap" INTEGER,
    "disabledModules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabledModules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "plan" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceLimits_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateTable
CREATE TABLE "OrgRequest" (
    "id" TEXT NOT NULL,
    "kind" "OrgRequestKind" NOT NULL,
    "status" "OrgRequestStatus" NOT NULL DEFAULT 'PENDING',
    "workspaceId" TEXT,
    "requestedById" TEXT NOT NULL,
    "requestedName" TEXT,
    "requestedSlug" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "message" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgRequest_status_createdAt_idx" ON "OrgRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "OrgRequest_requestedById_idx" ON "OrgRequest"("requestedById");

-- CreateIndex
CREATE INDEX "OrgRequest_workspaceId_idx" ON "OrgRequest"("workspaceId");

-- AddForeignKey
ALTER TABLE "WorkspaceLimits" ADD CONSTRAINT "WorkspaceLimits_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgRequest" ADD CONSTRAINT "OrgRequest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgRequest" ADD CONSTRAINT "OrgRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgRequest" ADD CONSTRAINT "OrgRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
