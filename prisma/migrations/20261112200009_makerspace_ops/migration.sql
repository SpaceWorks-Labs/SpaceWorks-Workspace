-- CreateTable
CREATE TABLE "AssetDowntime" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "from" TIMESTAMP(3) NOT NULL,
    "to" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetDowntime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetCertRequirement" (
    "assetId" TEXT NOT NULL,
    "certTypeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,

    CONSTRAINT "AssetCertRequirement_pkey" PRIMARY KEY ("assetId","certTypeId")
);

-- CreateTable
CREATE TABLE "StockItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "unit" TEXT NOT NULL,
    "onHand" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "reorderLevel" DECIMAL(12,3),
    "reorderQty" DECIMAL(12,3),
    "preferredVendor" TEXT,
    "location" TEXT,
    "costMinor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "note" TEXT,
    "ledgerEntryId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssetDowntime_workspaceId_assetId_from_idx" ON "AssetDowntime"("workspaceId", "assetId", "from");

-- CreateIndex
CREATE INDEX "AssetDowntime_workspaceId_to_idx" ON "AssetDowntime"("workspaceId", "to");

-- CreateIndex
CREATE INDEX "AssetCertRequirement_workspaceId_certTypeId_idx" ON "AssetCertRequirement"("workspaceId", "certTypeId");

-- CreateIndex
CREATE INDEX "StockItem_workspaceId_archivedAt_idx" ON "StockItem"("workspaceId", "archivedAt");

-- CreateIndex
CREATE INDEX "StockMovement_workspaceId_itemId_createdAt_idx" ON "StockMovement"("workspaceId", "itemId", "createdAt");

-- AddForeignKey
ALTER TABLE "AssetDowntime" ADD CONSTRAINT "AssetDowntime_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetDowntime" ADD CONSTRAINT "AssetDowntime_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetCertRequirement" ADD CONSTRAINT "AssetCertRequirement_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetCertRequirement" ADD CONSTRAINT "AssetCertRequirement_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetCertRequirement" ADD CONSTRAINT "AssetCertRequirement_certTypeId_fkey" FOREIGN KEY ("certTypeId") REFERENCES "CertType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "StockItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
