-- CreateEnum
CREATE TYPE "TaskTypeIcon" AS ENUM ('TASK', 'BUG', 'FEATURE', 'DOCS', 'CHORE', 'MILESTONE', 'IDEA', 'RISK');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "typeId" TEXT;

-- CreateTable
CREATE TABLE "ProjectTaskType" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tone" "LabelTone" NOT NULL DEFAULT 'NEUTRAL',
    "icon" "TaskTypeIcon" NOT NULL DEFAULT 'TASK',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectTaskType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectTaskType_workspaceId_projectId_position_idx" ON "ProjectTaskType"("workspaceId", "projectId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTaskType_projectId_name_key" ON "ProjectTaskType"("projectId", "name");

-- CreateIndex
CREATE INDEX "Task_typeId_idx" ON "Task"("typeId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "ProjectTaskType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTaskType" ADD CONSTRAINT "ProjectTaskType_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTaskType" ADD CONSTRAINT "ProjectTaskType_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

