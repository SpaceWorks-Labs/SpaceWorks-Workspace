-- AlterTable
ALTER TABLE "FinanceAccount" ADD COLUMN     "externalCode" TEXT;

-- AlterTable
ALTER TABLE "FinanceCategory" ADD COLUMN     "externalCode" TEXT;

-- AlterTable
ALTER TABLE "FinanceFund" ADD COLUMN     "fcra" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "FundingRecord" ADD COLUMN     "ledgerEntryId" TEXT;

-- CreateTable
CREATE TABLE "FinanceBankStatement" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "importedById" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fileHash" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "fromDate" DATE,
    "toDate" DATE,
    "openingMinor" INTEGER,
    "closingMinor" INTEGER,

    CONSTRAINT "FinanceBankStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceBankLine" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "postedOn" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "balanceMinor" INTEGER,
    "lineHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNMATCHED',
    "ledgerEntryId" TEXT,
    "matchedAt" TIMESTAMP(3),
    "matchedById" TEXT,

    CONSTRAINT "FinanceBankLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinanceBankStatement_workspaceId_accountId_importedAt_idx" ON "FinanceBankStatement"("workspaceId", "accountId", "importedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceBankStatement_workspaceId_accountId_fileHash_key" ON "FinanceBankStatement"("workspaceId", "accountId", "fileHash");

-- CreateIndex
CREATE INDEX "FinanceBankLine_workspaceId_accountId_status_postedOn_idx" ON "FinanceBankLine"("workspaceId", "accountId", "status", "postedOn");

-- CreateIndex
CREATE INDEX "FinanceBankLine_statementId_idx" ON "FinanceBankLine"("statementId");

-- CreateIndex
CREATE INDEX "FinanceBankLine_workspaceId_ledgerEntryId_idx" ON "FinanceBankLine"("workspaceId", "ledgerEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceBankLine_workspaceId_accountId_lineHash_key" ON "FinanceBankLine"("workspaceId", "accountId", "lineHash");

-- CreateIndex
CREATE UNIQUE INDEX "FundingRecord_workspaceId_ledgerEntryId_key" ON "FundingRecord"("workspaceId", "ledgerEntryId");

-- AddForeignKey
ALTER TABLE "FinanceBankStatement" ADD CONSTRAINT "FinanceBankStatement_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceBankStatement" ADD CONSTRAINT "FinanceBankStatement_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinanceAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceBankLine" ADD CONSTRAINT "FinanceBankLine_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceBankLine" ADD CONSTRAINT "FinanceBankLine_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "FinanceBankStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceBankLine" ADD CONSTRAINT "FinanceBankLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinanceAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
