-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "restrictTaskEdits" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TaskAssignee" ADD COLUMN     "assignedById" TEXT;

-- CreateIndex
CREATE INDEX "TaskAssignee_assignedById_idx" ON "TaskAssignee"("assignedById");

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
