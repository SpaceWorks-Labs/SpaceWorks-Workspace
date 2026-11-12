type AppReviewPayload = { app: string; platform: "APPLE" | "GOOGLE"; rating: number; author: string; excerpt: string; link: string };

type Id = string;
type Iso = string;
type IncidentRef = { incidentId: Id; number: number; status: string; monitorIds: Id[] };
type TaskRef = { taskId: Id; taskNumber: number; projectId: Id | null };
type ApprovalRef = { approvalRequestId: Id; subjectType: string; subjectId: Id };
type Decision = "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";
type MaintenanceRef = { maintenanceWindowId: Id; startsAt: Iso | null; endsAt: Iso | null };
type PollRef = { pollId: Id; closesAt: Iso | null };
type GithubRef = { repoId: Id; number: number; url: string };

/** Typed `data` payload per event type. */
export interface EventPayloads {
  "secrets.rotation_due": { secretId: Id; environmentId: Id };
  "analytics.assumption_due": { adjustmentId: Id; dueOn: Iso };
  "people.responsibility_review_due": { responsibilityId: Id; reviewOn: Iso };
  "marketing.publish_due": { recordId: Id; dueOn: Iso };
  "marketing.follow_up_due": { recordId: Id; dueOn: Iso };
  "it.review_due": { recordId: Id; dueOn: Iso };
  "it.restore_due": { recordId: Id; dueOn: Iso };

  "product_ops.reminder": { recordId: Id; dueOn: Iso };
  "product_ops.estimate_due": { recordId: Id; dueOn: Iso };
  "finance.recurring.due": { recordId: Id; dueOn: Iso };
  "project.update_due": { projectId: Id; dueAt: Iso };
  "moneycontrols.reminder": { recordId: Id; dueOn: Iso };
  "documents.receivable.due": { documentId: Id };
  "ops.people_changed": { recordId: Id };
  "ops.reminder": { recordId: Id };
  "ops.ticket_changed": { recordId: Id };
  "ops.ticket_due": { recordId: Id };
  "ops.safety_changed": { recordId: Id };
  "ops.hours_submitted": { recordId: Id };
  "ops.hours_reviewed": { recordId: Id };

  "social.comment.received": { accountId: string; commentId: string };
  "social.reply.failed": { accountId: string; commentId: string };
  "social.token.expiring": { accountId: string };
  "funding.reminder": { recordId: Id; dueOn: Iso; reason: string };
  "funding.pledge_due": { recordId: Id; dueOn: Iso; reason: string };
  "funding.thank_you_due": { recordId: Id; dueOn: Iso; reason: string };
  "governance.review_due": { recordId: Id; dueOn: Iso; kind: string };
  "doc.review_due": { docId: Id; dueOn: Iso };
  "safeguarding.review_due": { caseId: Id; dueOn: Iso };
  "governance.reminder": { recordId: Id; dueOn: Iso; kind: string };
  "app_review.received": AppReviewPayload;
  "app_review.replied": AppReviewPayload;
  "app_review.reply_failed": AppReviewPayload;
  // Services
  "monitor.down": { monitorId: Id; incidentId: Id | null; statusCode: number | null; error: string | null };
  "monitor.degraded": { monitorId: Id; latencyMs: number | null };
  "monitor.up": { monitorId: Id; incidentId: Id | null; downtimeSec: number | null };
  "monitor.test": { monitorId: Id };
  "heartbeat.missed": { monitorId: Id; lastPingAt: Iso | null; expectedAt: Iso };
  "cert.expiring": { monitorId: Id; host: string; daysLeft: number; validTo: Iso };
  "domain.expiring": { monitorId: Id; domain: string; daysLeft: number; expiresAt: Iso };
  "cloud.resource_unhealthy": { connectionId: Id; resourceId: Id; status: string };
  "cloud.alarm": { connectionId: Id; alarmName: string; state: string };
  "cost.threshold_exceeded": { costBudgetId: Id; connectionId: Id | null; thresholdPct: number; spentMinor: number; limitMinor: number; currency: string };
  "checker.offline": { lastHeartbeatAt: Iso | null };
  // Incidents and maintenance
  "incident.opened": IncidentRef;
  "incident.updated": IncidentRef;
  "incident.acknowledged": IncidentRef & { acknowledgedById: Id };
  "incident.escalated": IncidentRef & { step: number };
  "incident.resolved": IncidentRef & { durationSec: number | null };
  "oncall.page": { incidentId: Id; scheduleId: Id | null };
  "maintenance.scheduled": MaintenanceRef;
  "maintenance.started": MaintenanceRef;
  "maintenance.ended": MaintenanceRef;
  // Tasks
  "task.assigned": TaskRef;
  "task.unassigned": TaskRef;
  "task.due": TaskRef & { dueAt: Iso };
  "task.overdue": TaskRef & { dueAt: Iso };
  "task.commented": TaskRef & { commentId: Id };
  "task.status_changed": TaskRef & { fromColumnId: Id | null; toColumnId: Id | null };
  "task.unblocked": TaskRef & { blockerTaskId: Id };
  // Mentions and chat
  mention: { sourceType: "message" | "task_comment" | "doc" | "meeting"; sourceId: Id; channelId: Id | null };
  "message.dm": { channelId: Id; messageId: Id };
  "thread.reply": { channelId: Id; messageId: Id; parentId: Id };
  // Community
  "announcement.published": { announcementId: Id };
  "member.joined": { userId: Id };
  // Digests and assistant
  "digest.ready": { frequency: "hourly" | "daily" | "weekly" | "custom"; jobId: Id | null };
  "assistant.job.completed": { jobId: Id | null; conversationId: Id | null; status: "ok" | "failed" };
  "boardroom.summary_ready": { sessionId: Id };
  "seo.report_ready": { siteId: Id; auditId: Id | null };
  // Manual finance reminders carry record ids, never payroll data.
  "finance.bill.overdue": { billId: Id; dueOn: Iso };
  "finance.receipt.missing": { entryId: Id };
  "finance.month.review_due": { month: string };
  "finance.disbursement.due": { disbursementId: Id };
  // Money and approvals
  "finance.approval.requested": ApprovalRef & { amountMinor: number | null; currency: string | null };
  "finance.approval.decided": ApprovalRef & { decision: Decision };
  "finance.reimbursement.paid": { reimbursementId: Id; amountMinor: number; currency: string };
  "invoice.overdue": { invoiceId: Id; number: string; dueOn: Iso };
  "budget.threshold": { budgetId: Id; thresholdPct: number; spentMinor: number; amountMinor: number; currency: string };
  "approval.requested": ApprovalRef;
  "approval.decided": ApprovalRef & { decision: Decision };
  // GitHub
  "github.pr.opened": GithubRef;
  "github.review.requested": GithubRef;
  "github.ci.failed": { repoId: Id; runId: string; branch: string | null; url: string };
  "github.release.published": { repoId: Id; tag: string; url: string };
  "github.issue.opened": GithubRef;
  // People and rota
  "team.member_added": { teamId: Id; userId: Id };
  "onboarding.task_due": { runId: Id; itemId: Id; dueAt: Iso };
  "offboarding.started": { runId: Id; subjectUserId: Id };
  "availability.changed": { availabilityId: Id; userId: Id };
  "certification.expiring": { certificationId: Id; certTypeId: Id; expiresAt: Iso };
  "shift.reminder": { shiftId: Id; startsAt: Iso };
  "shift.unfilled": { shiftId: Id; startsAt: Iso; openSpots: number };
  "shift.swap_requested": { swapRequestId: Id; shiftId: Id };
  "shift.swap_accepted": { swapRequestId: Id; shiftId: Id };
  // Operations
  "renewal.due": { subscriptionId: Id; renewsAt: Iso; daysLeft: number };
  "asset.maintenance_due": { assetId: Id; dueAt: Iso; maintenanceLogId?: Id };
  "form.submitted": { formId: Id; submissionId: Id };
  "vault.access.requested": { accessRequestId: Id; itemId: Id };
  "vault.item_revealed": { itemId: Id; byUserId: Id };
  "vault.rotation_due": { itemId: Id; dueAt: Iso };
  "catalogue.gap": { serviceIds: Id[] };
  "contact.follow_up_due": { contactId: Id; dueAt: Iso };
  "deal.stage_changed": { dealId: Id; organisationId: Id; stage: string };
  // Work and collaboration
  "cycle.started": { cycleId: Id; projectId: Id | null };
  "cycle.completed": { cycleId: Id; projectId: Id | null };
  "meeting.scheduled": { meetingId: Id; startsAt: Iso };
  "meeting.updated": { meetingId: Id; startsAt: Iso };
  "meeting.cancelled": { meetingId: Id; startsAt: Iso };
  "meeting.reminder": { meetingId: Id; startsAt: Iso };
  "calendar.reminder": { entryId: Id };
  "meeting.agenda_reminder": { meetingId: Id; startsAt: Iso };
  "meeting.summary_published": { meetingId: Id };
  "poll.opened": PollRef;
  "poll.closing_soon": PollRef;
  "poll.closed": PollRef;
  "signature.requested": { signatureRequestId: Id; docId: Id };
  "goal.check_in_due": { goalId: Id };
  // Platform and security
  "export.ready": { exportJobId: Id };
  "import.finished": { importJobId: Id; created: number; updated: number; skipped: number; errors: number };
  "security.new_login": { userId: Id };
  "destination.failing": { destinationId: Id; error: string };
  "org.request_decided": { requestId: Id; kind: string; status: "APPROVED" | "REJECTED"; workspaceId: Id | null };
  "campaign.finished": { campaignId: Id; sent: number; failed: number; skipped: number };
  "campaign.paused": { campaignId: Id; reason: string };
  "finance.invoice.paid": { invoiceId: Id; paymentId: Id; amountMinor: number; currency: string; provider: string };
  "finance.payment.failed": { invoiceId: Id; paymentId: Id | null; provider: string; reason: string };
  "finance.payment.refunded": { invoiceId: Id; paymentId: Id; refundedMinor: number; currency: string; provider: string };
  "system.destination_failed": { destinationId: Id; channel: string; error: string };
  "asset.downtime_started": { assetId: Id; downtimeId: Id; reason: string };
  "stock.reorder": { itemId: Id; onHand: string; reorderLevel: string };
  "notification.test": { destinationId: Id };
}

export type EventType = keyof EventPayloads;
