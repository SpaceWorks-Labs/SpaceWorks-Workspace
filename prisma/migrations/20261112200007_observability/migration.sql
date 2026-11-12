-- CreateTable
CREATE TABLE "WorkspaceAnalyticsConnection" (
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT NOT NULL DEFAULT 'inherit',
    "publicConfig" JSONB NOT NULL DEFAULT '{}',
    "secretEnc" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceAnalyticsConnection_pkey" PRIMARY KEY ("workspaceId","provider")
);

-- AddForeignKey
ALTER TABLE "WorkspaceAnalyticsConnection" ADD CONSTRAINT "WorkspaceAnalyticsConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
