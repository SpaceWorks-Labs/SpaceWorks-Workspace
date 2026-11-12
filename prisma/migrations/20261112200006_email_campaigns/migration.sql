-- CreateEnum
CREATE TYPE "MailingListVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "OptInMode" AS ENUM ('SINGLE', 'DOUBLE');

-- CreateEnum
CREATE TYPE "SubscriberStatus" AS ENUM ('ACTIVE', 'BLOCKLISTED');

-- CreateEnum
CREATE TYPE "ListSubscriptionStatus" AS ENUM ('UNCONFIRMED', 'CONFIRMED', 'UNSUBSCRIBED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'CANCELLED', 'FINISHED');

-- CreateEnum
CREATE TYPE "CampaignContentType" AS ENUM ('RICHTEXT', 'MARKDOWN', 'HTML', 'PLAIN');

-- CreateEnum
CREATE TYPE "CampaignMessageStatus" AS ENUM ('PENDING', 'CLAIMED', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "BounceKind" AS ENUM ('SOFT', 'HARD', 'COMPLAINT');

-- CreateEnum
CREATE TYPE "EngagementKind" AS ENUM ('OPEN', 'CLICK');

-- CreateTable
CREATE TABLE "MailingList" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "visibility" "MailingListVisibility" NOT NULL DEFAULT 'PRIVATE',
    "optIn" "OptInMode" NOT NULL DEFAULT 'DOUBLE',
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailingList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscriber" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailDomain" TEXT,
    "name" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "status" "SubscriberStatus" NOT NULL DEFAULT 'ACTIVE',
    "blocklistedAt" TIMESTAMP(3),
    "blocklistReason" TEXT,
    "contactId" TEXT,
    "source" TEXT,
    "bounceCount" INTEGER NOT NULL DEFAULT 0,
    "publicToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListSubscription" (
    "subscriberId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "status" "ListSubscriptionStatus" NOT NULL DEFAULT 'UNCONFIRMED',
    "confirmTokenHash" TEXT,
    "confirmTokenExpiresAt" TIMESTAMP(3),
    "consentSource" TEXT NOT NULL,
    "consentText" TEXT,
    "consentIp" TEXT,
    "consentUserAgent" TEXT,
    "subscribedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),
    "unsubscribeSource" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListSubscription_pkey" PRIMARY KEY ("subscriberId","listId")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT,
    "bodyHtml" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "fromEmail" TEXT,
    "replyTo" TEXT,
    "contentType" "CampaignContentType" NOT NULL DEFAULT 'RICHTEXT',
    "bodySource" TEXT NOT NULL DEFAULT '',
    "bodyHtml" TEXT NOT NULL DEFAULT '',
    "bodyText" TEXT NOT NULL DEFAULT '',
    "templateId" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "totalRecipients" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "lastSubscriberId" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "pausedReason" TEXT,
    "trackOpens" BOOLEAN NOT NULL DEFAULT false,
    "trackClicks" BOOLEAN NOT NULL DEFAULT false,
    "individualTracking" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignList" (
    "campaignId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,

    CONSTRAINT "CampaignList_pkey" PRIMARY KEY ("campaignId","listId")
);

-- CreateTable
CREATE TABLE "CampaignMessage" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "subscriberId" TEXT,
    "emailSnapshot" TEXT NOT NULL,
    "status" "CampaignMessageStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "lastError" TEXT,
    "token" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3),
    "firstClickedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignLink" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "urlHash" TEXT NOT NULL,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "uniqueClickCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CampaignLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignEngagement" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "messageId" TEXT,
    "linkId" TEXT,
    "kind" "EngagementKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignEngagement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignBounce" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "subscriberId" TEXT,
    "campaignId" TEXT,
    "messageId" TEXT,
    "kind" "BounceKind" NOT NULL,
    "source" TEXT NOT NULL,
    "diagnostic" TEXT,
    "providerEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignBounce_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignSettings" (
    "workspaceId" TEXT NOT NULL,
    "trackOpens" BOOLEAN NOT NULL DEFAULT false,
    "trackClicks" BOOLEAN NOT NULL DEFAULT false,
    "individualTracking" BOOLEAN NOT NULL DEFAULT false,
    "recordConsentIp" BOOLEAN NOT NULL DEFAULT false,
    "sendPerMinute" INTEGER NOT NULL DEFAULT 60,
    "batchSize" INTEGER NOT NULL DEFAULT 50,
    "maxErrors" INTEGER NOT NULL DEFAULT 20,
    "softBounceLimit" INTEGER NOT NULL DEFAULT 3,
    "domainBlocklist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "footerAddress" TEXT,
    "bounceWebhookSecretEnc" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignSettings_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateIndex
CREATE UNIQUE INDEX "MailingList_workspaceId_slug_key" ON "MailingList"("workspaceId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Subscriber_publicToken_key" ON "Subscriber"("publicToken");

-- CreateIndex
CREATE INDEX "Subscriber_workspaceId_status_idx" ON "Subscriber"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Subscriber_workspaceId_emailDomain_idx" ON "Subscriber"("workspaceId", "emailDomain");

-- CreateIndex
CREATE UNIQUE INDEX "Subscriber_workspaceId_email_key" ON "Subscriber"("workspaceId", "email");

-- CreateIndex
CREATE INDEX "ListSubscription_workspaceId_listId_status_idx" ON "ListSubscription"("workspaceId", "listId", "status");

-- CreateIndex
CREATE INDEX "ListSubscription_confirmTokenHash_idx" ON "ListSubscription"("confirmTokenHash");

-- CreateIndex
CREATE INDEX "EmailTemplate_workspaceId_idx" ON "EmailTemplate"("workspaceId");

-- CreateIndex
CREATE INDEX "Campaign_workspaceId_status_idx" ON "Campaign"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Campaign_status_scheduledAt_idx" ON "Campaign"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignMessage_token_key" ON "CampaignMessage"("token");

-- CreateIndex
CREATE INDEX "CampaignMessage_campaignId_status_nextAttemptAt_idx" ON "CampaignMessage"("campaignId", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "CampaignMessage_workspaceId_sentAt_idx" ON "CampaignMessage"("workspaceId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignMessage_campaignId_subscriberId_key" ON "CampaignMessage"("campaignId", "subscriberId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignLink_campaignId_urlHash_key" ON "CampaignLink"("campaignId", "urlHash");

-- CreateIndex
CREATE INDEX "CampaignEngagement_campaignId_kind_createdAt_idx" ON "CampaignEngagement"("campaignId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "CampaignEngagement_workspaceId_createdAt_idx" ON "CampaignEngagement"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "CampaignBounce_workspaceId_createdAt_idx" ON "CampaignBounce"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "CampaignBounce_workspaceId_subscriberId_idx" ON "CampaignBounce"("workspaceId", "subscriberId");

-- CreateIndex
CREATE INDEX "CampaignBounce_campaignId_idx" ON "CampaignBounce"("campaignId");

-- AddForeignKey
ALTER TABLE "MailingList" ADD CONSTRAINT "MailingList_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscriber" ADD CONSTRAINT "Subscriber_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscriber" ADD CONSTRAINT "Subscriber_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListSubscription" ADD CONSTRAINT "ListSubscription_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListSubscription" ADD CONSTRAINT "ListSubscription_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "Subscriber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListSubscription" ADD CONSTRAINT "ListSubscription_listId_fkey" FOREIGN KEY ("listId") REFERENCES "MailingList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EmailTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignList" ADD CONSTRAINT "CampaignList_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignList" ADD CONSTRAINT "CampaignList_listId_fkey" FOREIGN KEY ("listId") REFERENCES "MailingList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMessage" ADD CONSTRAINT "CampaignMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMessage" ADD CONSTRAINT "CampaignMessage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMessage" ADD CONSTRAINT "CampaignMessage_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "Subscriber"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLink" ADD CONSTRAINT "CampaignLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLink" ADD CONSTRAINT "CampaignLink_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignEngagement" ADD CONSTRAINT "CampaignEngagement_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignEngagement" ADD CONSTRAINT "CampaignEngagement_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignBounce" ADD CONSTRAINT "CampaignBounce_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSettings" ADD CONSTRAINT "CampaignSettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
