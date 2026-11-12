-- CreateTable
CREATE TABLE "WorkspaceEmailSettings" (
    "workspaceId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "secure" BOOLEAN NOT NULL DEFAULT false,
    "username" TEXT,
    "passwordEnc" TEXT,
    "fromEmail" TEXT NOT NULL,
    "fromName" TEXT,
    "replyTo" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceEmailSettings_pkey" PRIMARY KEY ("workspaceId")
);

-- AddForeignKey
ALTER TABLE "WorkspaceEmailSettings" ADD CONSTRAINT "WorkspaceEmailSettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
