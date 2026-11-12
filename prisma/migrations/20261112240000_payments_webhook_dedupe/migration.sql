-- Webhook de-duplication is per organisation, so one organisation's events can never shadow another's.
DROP INDEX "PaymentWebhookEvent_provider_eventId_key";
CREATE UNIQUE INDEX "PaymentWebhookEvent_workspaceId_provider_eventId_key" ON "PaymentWebhookEvent"("workspaceId", "provider", "eventId");
