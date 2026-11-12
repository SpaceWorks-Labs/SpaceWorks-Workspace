import type { PersonalChannel, WorkspaceRole } from "@prisma/client";
import type { EventType } from "./event-payloads";

export type { EventPayloads, EventType } from "./event-payloads";

/**
 * Event catalogue for `dispatch()` (pure and client-safe, so routing UIs can
 * list event types). Every area that notifies anyone adds nothing here at
 * runtime: the full catalogue ships now so later phases only call
 * `dispatch(workspaceId, { type, ..., data })` with a typed payload.
 *
 * Naming: lowercase dot-separated segments, `<area>.<subject>[.<verb>]`.
 * Rules match exact types, `<prefix>.*` or `*`.
 *
 * Payloads carry ids and small facts only (they are stored on the event and
 * sent to webhook destinations). Never put secrets or private message
 * bodies in `data`; human text goes in the event's title/body.
 */

export type Severity = "info" | "warning" | "critical";

/** BROADCAST = routed by workspace/scoped rules; PERSONAL = sent to `recipients`. */
export type EventAudience = "broadcast" | "personal" | "both";

export const NOTIFY_CATEGORIES = {
  services: { label: "Services", defaultChannels: ["IN_APP"] },
  incidents: { label: "Incidents", defaultChannels: ["IN_APP", "EMAIL"] },
  tasks: { label: "Tasks", defaultChannels: ["IN_APP"] },
  mentions: { label: "Mentions and messages", defaultChannels: ["IN_APP"] },
  announcements: { label: "Announcements", defaultChannels: ["IN_APP"] },
  digests: { label: "Digests", defaultChannels: ["IN_APP", "EMAIL"] },
  finance: { label: "Money and approvals", defaultChannels: ["IN_APP", "EMAIL"] },
  github: { label: "GitHub", defaultChannels: ["IN_APP"] },
  people: { label: "People and rota", defaultChannels: ["IN_APP"] },
  operations: { label: "Operations", defaultChannels: ["IN_APP", "EMAIL"] },
  collaboration: { label: "Meetings, polls and goals", defaultChannels: ["IN_APP"] },
  assistant: { label: "Assistant", defaultChannels: ["IN_APP"] },
  security: { label: "Security", defaultChannels: ["IN_APP", "EMAIL"] },
} as const satisfies Record<string, { label: string; defaultChannels: readonly PersonalChannel[] }>;

export type NotifyCategory = keyof typeof NOTIFY_CATEGORIES;

export type EventSpec = {
  category: NotifyCategory;
  severity: Severity;
  audience: EventAudience;
  /** Short label for rule editors and the preference matrix. */
  label: string;
  /** Recipients below this role never receive it (dispatch re-checks membership). */
  minRole?: WorkspaceRole;
};

const s = (category: NotifyCategory, label: string, audience: EventAudience, severity: Severity = "info", minRole?: WorkspaceRole): EventSpec =>
  minRole ? { category, label, audience, severity, minRole } : { category, label, audience, severity };

export const EVENT_CATALOG = {
  "analytics.assumption_due": s("finance", "Forecast assumption due", "personal", "info", "ADMIN"),
  "people.responsibility_review_due": s("people", "Responsibility review due", "personal", "info", "MEMBER"),
  "marketing.publish_due": s("operations", "Content publish date", "personal", "info", "MEMBER"),
  "marketing.follow_up_due": s("operations", "Outreach follow-up", "personal", "info", "ADMIN"),
  "it.review_due": s("security", "Access review due", "personal", "warning", "ADMIN"),
  "it.restore_due": s("security", "Restore test due", "personal", "warning", "ADMIN"),
  "product_ops.reminder": s("operations", "Product work due", "personal", "warning", "MEMBER"),
  "product_ops.estimate_due": s("finance", "Funding estimate due", "personal", "warning", "ADMIN"),
  "finance.recurring.due": s("finance", "Recurring cost due", "personal", "warning", "MEMBER"),
  "project.update_due": s("tasks", "Weekly project update due", "personal", "info", "MEMBER"),
  "moneycontrols.reminder": s("finance", "Internal control due", "personal", "warning", "MEMBER"),
  "ops.people_changed": s("operations", "People tool update", "personal", "info", "MEMBER"),
  "ops.reminder": s("operations", "People and service reminder", "personal", "info", "MEMBER"),
  "ops.ticket_changed": s("operations", "Help desk update", "personal", "info", "MEMBER"),
  "ops.ticket_due": s("operations", "Help desk target overdue", "personal", "warning", "MEMBER"),
  "ops.safety_changed": s("operations", "Confidential safety report update", "personal", "info", "MEMBER"),
  "ops.hours_submitted": s("operations", "Volunteer hours to review", "personal", "info", "MEMBER"),
  "ops.hours_reviewed": s("operations", "Volunteer hours reviewed", "personal", "info", "MEMBER"),

  "social.comment.received": s("operations", "Social comment received", "broadcast", "info", "MEMBER"),
  "social.reply.failed": s("operations", "Social reply failed", "broadcast", "warning", "MEMBER"),
  "social.token.expiring": s("operations", "Social connection expiring", "broadcast", "warning", "ADMIN"),
  "documents.receivable.due": s("finance", "Receivable follow-up", "personal", "warning", "ADMIN"),
  "funding.reminder": s("finance", "Funding deadline", "personal", "warning", "ADMIN"),
  "funding.pledge_due": s("finance", "Pledge instalment due", "personal", "warning", "ADMIN"),
  "funding.thank_you_due": s("finance", "Donation thank-you due", "personal", "info", "ADMIN"),
  "governance.review_due": s("operations", "Governance review", "personal", "warning", "ADMIN"),
  "doc.review_due": s("operations", "Document review", "personal", "warning", "MEMBER"),
  "safeguarding.review_due": s("operations", "Confidential case review", "personal", "warning", "MEMBER"),
  "governance.reminder": s("operations", "Governance deadline", "personal", "warning", "ADMIN"),
  "finance.bill.overdue": s("finance", "Supplier bill overdue", "personal", "warning", "ADMIN"),
  "finance.receipt.missing": s("finance", "Receipt needed", "personal", "warning", "ADMIN"),
  "finance.month.review_due": s("finance", "Monthly spending review due", "personal", "info", "ADMIN"),
  "finance.disbursement.due": s("finance", "Disbursement due", "personal", "warning", "ADMIN"),
  "app_review.received": s("operations", "App review received", "broadcast", "info", "MEMBER"),
  "app_review.replied": s("operations", "App review reply published", "broadcast", "info", "MEMBER"),
  "app_review.reply_failed": s("operations", "App review reply failed", "broadcast", "warning", "MEMBER"),
  "monitor.down": s("services", "Monitor down", "broadcast", "critical", "MEMBER"),
  "monitor.degraded": s("services", "Monitor degraded", "broadcast", "warning", "MEMBER"),
  "monitor.up": s("services", "Monitor recovered", "broadcast", "info", "MEMBER"),
  "monitor.test": s("services", "Test alert", "broadcast", "info", "MEMBER"),
  "heartbeat.missed": s("services", "Heartbeat missed", "broadcast", "critical", "MEMBER"),
  "cert.expiring": s("services", "Certificate expiring", "broadcast", "warning", "MEMBER"),
  "domain.expiring": s("services", "Domain expiring", "broadcast", "warning", "MEMBER"),
  "cloud.resource_unhealthy": s("services", "Cloud resource unhealthy", "broadcast", "warning", "MEMBER"),
  "cloud.alarm": s("services", "Cloud alarm", "broadcast", "warning", "MEMBER"),
  "cost.threshold_exceeded": s("services", "Cloud cost threshold", "broadcast", "warning", "ADMIN"),
  "checker.offline": s("services", "Checker offline", "broadcast", "critical", "ADMIN"),

  "incident.opened": s("incidents", "Incident opened", "both", "critical", "MEMBER"),
  "incident.updated": s("incidents", "Incident updated", "both", "info", "MEMBER"),
  "incident.acknowledged": s("incidents", "Incident acknowledged", "both", "info", "MEMBER"),
  "incident.escalated": s("incidents", "Incident escalated", "both", "critical", "MEMBER"),
  "incident.resolved": s("incidents", "Incident resolved", "both", "info", "MEMBER"),
  "oncall.page": s("incidents", "On-call page", "personal", "critical", "MEMBER"),
  "maintenance.scheduled": s("incidents", "Maintenance scheduled", "both", "info", "MEMBER"),
  "maintenance.started": s("incidents", "Maintenance started", "both", "info", "MEMBER"),
  "maintenance.ended": s("incidents", "Maintenance ended", "both", "info", "MEMBER"),

  "task.assigned": s("tasks", "Task assigned to you", "both"),
  "task.unassigned": s("tasks", "Task unassigned from you", "personal"),
  "task.due": s("tasks", "Task due soon", "personal"),
  "task.overdue": s("tasks", "Task overdue", "personal", "warning"),
  "task.commented": s("tasks", "Comment on your task", "personal"),
  "task.status_changed": s("tasks", "Task moved", "both"),
  "task.unblocked": s("tasks", "Task unblocked", "personal"),

  mention: s("mentions", "Mentioned you", "personal"),
  "message.dm": s("mentions", "Direct message", "personal"),
  "thread.reply": s("mentions", "Reply in your thread", "personal"),

  "announcement.published": s("announcements", "Announcement published", "both"),
  "member.joined": s("people", "Member joined", "both"),

  "digest.ready": s("digests", "Digest ready", "both"),
  "assistant.job.completed": s("assistant", "Assistant job finished", "both", "info", "MEMBER"),
  "boardroom.summary_ready": s("assistant", "Boardroom summary ready", "both", "info", "MEMBER"),
  "seo.report_ready": s("assistant", "SEO report ready", "both", "info", "ADMIN"),

  "finance.approval.requested": s("finance", "Spend approval needed", "both", "info", "MEMBER"),
  "finance.approval.decided": s("finance", "Spend approval decided", "personal", "info", "MEMBER"),
  "finance.reimbursement.paid": s("finance", "Reimbursement paid", "personal", "info", "MEMBER"),
  "invoice.overdue": s("finance", "Invoice overdue", "broadcast", "warning", "ADMIN"),
  "budget.threshold": s("finance", "Budget threshold reached", "both", "warning", "MEMBER"),
  "approval.requested": s("operations", "Approval needed", "personal", "info", "MEMBER"),
  "approval.decided": s("operations", "Approval decided", "personal", "info", "MEMBER"),

  "github.pr.opened": s("github", "Pull request opened", "broadcast", "info", "MEMBER"),
  "github.review.requested": s("github", "Review requested", "personal", "info", "MEMBER"),
  "github.ci.failed": s("github", "CI failed", "both", "warning", "MEMBER"),
  "github.release.published": s("github", "Release published", "broadcast", "info", "MEMBER"),
  "github.issue.opened": s("github", "Issue opened", "broadcast", "info", "MEMBER"),

  "team.member_added": s("people", "Added to a team", "both"),
  "onboarding.task_due": s("people", "Checklist item due", "personal", "info", "MEMBER"),
  "offboarding.started": s("people", "Offboarding started", "both", "info", "ADMIN"),
  "availability.changed": s("people", "Teammate away", "both", "info", "MEMBER"),
  "certification.expiring": s("people", "Sign-off expiring", "personal", "info", "MEMBER"),
  "shift.reminder": s("people", "Shift reminder", "personal", "info", "MEMBER"),
  "shift.unfilled": s("people", "Shift unfilled", "both", "warning", "MEMBER"),
  "shift.swap_requested": s("people", "Shift swap requested", "both", "info", "MEMBER"),
  "shift.swap_accepted": s("people", "Shift swap accepted", "personal", "info", "MEMBER"),

  "renewal.due": s("operations", "Renewal due", "both", "warning", "MEMBER"),
  "asset.maintenance_due": s("operations", "Maintenance due", "both", "info", "MEMBER"),
  "form.submitted": s("operations", "Form submitted", "both", "info", "MEMBER"),
  "vault.access.requested": s("security", "Vault access requested", "personal", "info", "MEMBER"),
  "vault.item_revealed": s("security", "Vault secret revealed", "both", "warning", "ADMIN"),
  "secrets.rotation_due": s("security", "Application secret rotation due", "personal", "warning", "MEMBER"),
  "vault.rotation_due": s("security", "Credential rotation due", "both", "warning", "MEMBER"),
  "catalogue.gap": s("operations", "Service catalogue gaps", "both", "info", "ADMIN"),
  "contact.follow_up_due": s("operations", "Contact follow-up due", "personal", "info", "MEMBER"),
  "deal.stage_changed": s("operations", "Sponsor deal moved", "both", "info", "MEMBER"),

  "cycle.started": s("collaboration", "Cycle started", "both", "info", "MEMBER"),
  "cycle.completed": s("collaboration", "Cycle completed", "both", "info", "MEMBER"),
  "meeting.scheduled": s("collaboration", "Meeting scheduled", "personal"),
  "meeting.updated": s("collaboration", "Meeting updated", "personal"),
  "meeting.cancelled": s("collaboration", "Meeting cancelled", "personal"),
  "meeting.reminder": s("collaboration", "Meeting reminder", "personal"),
  "calendar.reminder": s("collaboration", "Calendar reminder", "personal"),
  "meeting.agenda_reminder": s("collaboration", "Add agenda items", "personal"),
  "meeting.summary_published": s("collaboration", "Meeting summary", "both"),
  "poll.opened": s("collaboration", "Poll opened", "both"),
  "poll.closing_soon": s("collaboration", "Poll closing soon", "personal"),
  "poll.closed": s("collaboration", "Poll closed", "both"),
  "signature.requested": s("collaboration", "Signature requested", "personal"),
  "goal.check_in_due": s("collaboration", "Goal check-in due", "personal", "info", "MEMBER"),

  "export.ready": s("security", "Export ready", "personal", "info", "ADMIN"),
  "import.finished": s("operations", "Import finished", "personal", "info", "MEMBER"),
  "security.new_login": s("security", "New sign-in", "personal", "warning"),
  "destination.failing": s("security", "Notification destination failing", "personal", "warning", "ADMIN"),
  "org.request_decided": s("operations", "Organisation request decided", "personal", "info"),
  "campaign.finished": s("operations", "Email campaign finished", "both", "info", "MEMBER"),
  "campaign.paused": s("operations", "Email campaign paused", "both", "warning", "MEMBER"),
  "finance.invoice.paid": s("finance", "Invoice paid online", "both", "info", "ADMIN"),
  "finance.payment.failed": s("finance", "Online payment failed", "both", "warning", "ADMIN"),
  "finance.payment.refunded": s("finance", "Online payment refunded", "both", "info", "ADMIN"),
  "system.destination_failed": s("security", "Notification destination failed", "personal", "warning", "ADMIN"),
  "asset.downtime_started": s("operations", "Machine down", "both", "warning", "MEMBER"),
  "stock.reorder": s("operations", "Stock below reorder level", "both", "warning", "MEMBER"),
  "notification.test": s("security", "Test notification", "broadcast"),
} as const satisfies Record<EventType, EventSpec>;

export const EVENT_TYPES = Object.keys(EVENT_CATALOG) as EventType[];

export function isEventType(value: string): value is EventType {
  return Object.prototype.hasOwnProperty.call(EVENT_CATALOG, value);
}

export function eventSpec(type: EventType): EventSpec {
  return EVENT_CATALOG[type];
}

/** Event types grouped by category, for rule editors and the preference matrix. */
export function eventTypesByCategory(): Record<NotifyCategory, EventType[]> {
  const grouped = Object.fromEntries(Object.keys(NOTIFY_CATEGORIES).map((key) => [key, [] as EventType[]])) as Record<NotifyCategory, EventType[]>;
  for (const type of EVENT_TYPES) grouped[EVENT_CATALOG[type].category].push(type);
  return grouped;
}

export const audienceIncludesBroadcast = (audience: EventAudience) => audience !== "personal";
export const audienceIncludesPersonal = (audience: EventAudience) => audience !== "broadcast";
