/**
 * View shapes for the instance admin dashboard (`/admin`). Pure and
 * client-safe: every value is a plain number, string, boolean or array, so
 * the view crosses the split-frontend boundary unchanged. Dates are ISO strings.
 */

export const DASHBOARD_RANGES = [30, 90] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

export const ORG_SORTS = ["members", "storage", "projects", "tasks", "emails", "assistant"] as const;
export type OrgSort = (typeof ORG_SORTS)[number];

export type OrgStatusKey = "ACTIVE" | "PENDING" | "SUSPENDED" | "REJECTED";

/** A count in this period and in the period of the same length just before it. */
export type Trend = { current: number; previous: number };

export type SeriesPoint = { start: string; value: number };

export type DashboardKpis = {
  orgs: Record<OrgStatusKey, number>;
  users: { total: number; disabled: number; active7: number; active30: number };
  signUps: Trend;
  newOrgs: Trend;
  activeMembers: Trend;
  invitesSent: Trend;
  invitesAccepted: Trend;
  pendingRequests: number;
};

export type GrowthSeries = { bucketDays: number; newOrgs: SeriesPoint[]; newUsers: SeriesPoint[]; activeMembers: SeriesPoint[] };

export type LimitKey = "members" | "guests" | "projects" | "storage" | "assistant" | "emails";
export type LimitUse = { key: LimitKey; used: number; max: number; ratio: number };

export type OrgUsageRow = {
  id: string;
  name: string;
  slug: string;
  status: OrgStatusKey;
  plan: string | null;
  members: number;
  guests: number;
  projects: number;
  storageBytes: number;
  /** Tasks created in the selected period. */
  tasks: number;
  /** Campaign emails sent this calendar month (the limit window). */
  emailsMonth: number;
  /** Assistant tokens used this calendar month (the limit window). */
  assistantMonth: number;
  /** Limits at or above the near-limit threshold, highest first. */
  near: LimitUse[];
};

export type ModuleAdoption = { key: string; label: string; on: number; off: number; optIn: boolean };

export type PaymentRow = { provider: "STRIPE" | "RAZORPAY"; currency: string; paidCount: number; paidMinor: number; refundedMinor: number };

export type UsageTotals = {
  campaignSent: Trend;
  transactionalSent: Trend;
  transactionalByKind: Array<{ kind: string; count: number }>;
  assistantUsed: Trend;
  tasksCreated: Trend;
  storageBytes: number;
  openProjects: number;
  payments: PaymentRow[];
  paymentLinks: Array<{ status: string; count: number }>;
};

export type OrgUsageView = {
  sort: OrgSort;
  top: OrgUsageRow[];
  nearLimit: OrgUsageRow[];
  nearLimitTotal: number;
  /** Live (non-archived, ACTIVE) organisations the adoption counts cover. */
  activeOrgs: number;
  adoption: ModuleAdoption[];
};

export type QueueHealth = { name: string; waiting: number; active: number; delayed: number; failed: number; paused: boolean };
export type Heartbeat = { key: string; label: string; lastSucceededAt: string | null; fresh: boolean };

export type SystemHealth = {
  version: string;
  database: { ok: boolean; latencyMs: number | null };
  redis: { configured: boolean; reachable: boolean };
  queues: QueueHealth[] | null;
  outbox: { pending: number; processing: number; failed: number; sent: number; oldestPendingAt: string | null };
  heartbeats: Heartbeat[];
  storageConfigured: boolean;
  emailConfigured: boolean;
};

export type PlatformStatus = {
  id: string;
  title: string;
  enabled: boolean;
  configured: boolean;
  missing: string[];
  /** Latest console test (audit `admin.observability_tested`). */
  lastTest: { ok: boolean; at: string } | null;
  /** Provider dashboard, only when a non-secret setting names it. */
  dashboardUrl: string | null;
  detail: string | null;
};

export type RecentActivity = {
  audit: Array<{ id: string; action: string; at: string; actor: { name: string | null; email: string } | null; org: { id: string; name: string } | null }>;
  requests: Array<{ id: string; kind: string; status: string; name: string | null; at: string; requester: { name: string | null; email: string } }>;
  signUps: Array<{ id: string; name: string | null; email: string; at: string; verified: boolean }>;
};

export type MetabaseEmbed = { embedUrl: string | null; linkUrl: string | null; reason: string | null } | null;

export type AdminDashboardView = {
  range: DashboardRange;
  generatedAt: string;
  kpis: DashboardKpis;
  growth: GrowthSeries;
  usage: OrgUsageView;
  totals: UsageTotals;
  health: SystemHealth;
  platforms: PlatformStatus[];
  recent: RecentActivity;
  metabase: MetabaseEmbed;
};
