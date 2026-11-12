// Copy for the public landing page. Every claim comes from README.md,
// CHANGELOG.md [0.10.0], install.sh or docs/; keep it true when they change.

export const REPO_URL = "https://github.com/SpaceWorks-Labs/SpaceWorks-Workspace";
export const repoFile = (path: string) => `${REPO_URL}/blob/main/${path}`;
export const INSTALL_COMMAND = "curl -fsSL https://raw.githubusercontent.com/SpaceWorks-Labs/SpaceWorks-Workspace/main/install.sh | bash";

/** The release this landing describes. tests/unit/landing-page.test.ts keeps it in step with package.json. */
export const RELEASE = { version: "0.10.0", date: "12 Nov 2026" } as const;

/** Section links shared by the header and the footer. */
export const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "Install", href: "#install" },
  { label: "Docs", href: "#docs" },
  { label: "FAQ", href: "#faq" },
] as const;

export type Tone = "sky" | "citron" | "yellow" | "orange" | "line";
export type Area = { id: string; title: string; tone: Tone; items: [string, string][] };

/** 04: the product areas, as disclosure rows. */
export const AREAS: Area[] = [
  { id: "tasks", title: "Projects and tasks", tone: "sky", items: [
    ["Boards", "with column colours, WIP limits, swimlanes and saved views"],
    ["Assign to me", "and Unassign me on cards, in the task drawer and on list rows"],
    ["List view", "inline editing and bulk edit of up to 50 tasks"],
    ["Drag and drop", "by pointer, touch or keyboard, plus a Move to menu"],
    ["My Tasks", "assigned to me, assigned by me, my team and created by me"],
    ["Task rules", "per-project task types and a Restrict task edits switch"],
    ["Planning", "timeline, milestones, cycles and weekly status updates"],
  ] },
  { id: "together", title: "Docs, files and chat", tone: "citron", items: [
    ["Docs", "with revisions, review reminders and controlled access"],
    ["Files", "private, with versions"],
    ["Chat", "channels, direct messages, threads, reactions and mentions"],
    ["Team calendar", "meetings, goals, polls and ideas"],
  ] },
  { id: "finance", title: "Finance", tone: "yellow", items: [
    ["Books", "income and expenses, funds, budgets, supplier bills and reimbursements"],
    ["Donations", "posted to the ledger; in-kind gifts recorded as assets"],
    ["Bank import", "CSV and OFX statements with matching"],
    ["Statements", "Receipts and Payments, Income and Expenditure and fund statements by financial year"],
    ["Accounting export", "Tally, Xero, QuickBooks and journal exports"],
    ["FCRA", "fund checks and a quarterly report"],
  ] },
  { id: "payments", title: "Online payments", tone: "orange", items: [
    ["Payment links", "for invoices through your own Stripe or Razorpay account"],
    ["Webhooks", "signed, de-duplicated per organisation, with refunds"],
    ["Keys", "encrypted at rest and write-only in every screen"],
  ] },
  { id: "campaigns", title: "Email campaigns", tone: "line", items: [
    ["Lists", "subscriber lists with double opt-in"],
    ["Campaigns", "templates and throttled sending"],
    ["Hygiene", "bounce handling and one-click unsubscribe"],
    ["Privacy", "open and click tracking off by default"],
  ] },
  { id: "makerspace", title: "Makerspace operations", tone: "line", items: [
    ["Downtime", "machine downtime with a cost report"],
    ["Maintenance", "reminders when upkeep is due"],
    ["Inductions", "required inductions with a sign-off matrix"],
    ["Stock", "consumables with reorder alerts"],
  ] },
  { id: "people", title: "People and governance", tone: "line", items: [
    ["People", "profiles, org chart, onboarding, skills, leave and attendance"],
    ["Support", "hiring, rota and a confidential help desk"],
    ["Governance", "compliance calendar, board packs, registers and safeguarding cases"],
  ] },
  { id: "reports", title: "Reports and monitoring", tone: "line", items: [
    ["Report desk", "money, people, work and operations in one place"],
    ["Drill-down", "CSV export and printable packs"],
    ["Monitoring", "HTTP, TCP, DNS, TLS and heartbeat checks with status pages"],
  ] },
  { id: "assistant", title: "Assistant, API and secrets", tone: "line", items: [
    ["Assistant", "searches and acts with the caller's permissions"],
    ["MCP server", "at /api/mcp with OAuth or API-key scopes"],
    ["REST API", "at /api/v1 with scoped tokens"],
    ["Secrets", "envelope encryption, audited reveal and the sww command line"],
  ] },
];

/** 07: what every install gets. */
export const FOUNDATIONS: [string, string][] = [
  ["Sign in your way", "Username or email with a password and email verification, GitHub, Google and Apple, connected accounts and optional OIDC. Self sign-up is a switch the operator turns on."],
  ["Organisations, approved", "People request a new organisation and the instance super admin approves or rejects it. One account can belong to several organisations, with a role in each."],
  ["Limits and modules", "Per-organisation limits on members, guests, projects, storage, file size, API tokens, webhooks, assistant tokens and monthly email, plus feature modules switched per organisation."],
  ["A super-admin console", "Approve, suspend and reactivate organisations, transfer ownership and open any organisation, with that access recorded in the instance audit log."],
  ["Per-workspace SMTP", "Each organisation can send from its own mail server, with encrypted credentials and a fixed list of SMTP ports."],
  ["Notification channels", "In-app, email, WhatsApp, Telegram, Slack, Discord, Mattermost and webhooks, with per-destination rate limits and an alert when a destination keeps failing."],
  ["Connected analytics", "Sentry, PostHog, Clarity and Firebase Analytics behind a consent banner, Prometheus metrics with a Grafana dashboard, and Metabase reporting views."],
  ["Off until you turn it on", "Every new feature in this release, and all analytics, stays off until an admin turns it on."],
  ["Roles and isolation", "Owner, admin, member and guest roles, strict workspace isolation and private teams that hide their projects, channels and files."],
  ["Secrets stay secret", "Payment keys, SMTP passwords and analytics and provider secrets are encrypted at rest and write-only in every screen."],
  ["Audit and protection", "An audit log, rate limits, CSP nonces, two-step verification and session revocation."],
  ["Backups and updates", "The installer updates, rolls back, takes encrypted backups and recovers from the same menu."],
];
