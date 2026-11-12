# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.10.0] - 2026-11-12

A large release: organisations with super-admin approval, limits and module switches; more sign-in options; payments, email campaigns, bank import, statements and accounting exports; makerspace stock and operations; connected analytics; and a board and task upgrade. Run the migrations before starting the new version. Every new feature is off until an admin turns it on. Operators: read [Upgrading to 0.10.0](docs/production-operations.md#upgrading-to-0100) first.

### Added

- Organisations: users request a new organisation and the instance super admin approves or rejects it; a user can belong to several organisations with a role in each.
- Super-admin console: `/admin/organisations` and `/admin/requests` with suspend and reactivate, ownership transfer, per-organisation limits and feature modules, and silent access that is recorded only in the instance audit log.
- Limits per organisation: members, guests, projects, storage, file size, API tokens, webhooks, assistant on or off with monthly tokens, and a monthly email cap, with instance defaults (`LIMITS_*`, `MODULES_DISABLED_BY_DEFAULT`).
- Owner **Plan & limits** page with usage bars, "Request more" and "Request access" for disabled modules.
- Public landing page at `/` for signed-out visitors: product tour, install guide, docs, FAQ and GitHub links. Signed-in people still go straight to their workspace.
- Super-admin dashboard at `/admin`, showing:
  - organisations by status, people and active people, sign-ups and invitations, with trends;
  - growth charts;
  - top organisations by usage and those near their limits;
  - module adoption;
  - system health;
  - the status of every analytics platform;
  - recent activity.
- Roles defined in one place (`docs/ROLES.md`). The sidebar, settings tabs, command palette and home widgets come from the same role and module map as the page guards, and a test keeps them in step. The super admin lands on the `/admin` console.
- Sign-in to workspace journey:
  - a prompt to turn on two-step verification after first-run setup;
  - sign-in returns you to the page you asked for;
  - confirming your email signs you in;
  - clear messages for used, withdrawn or expired invitation links;
  - guided "no workspace yet" screen;
  - organisation requests with a live address check, editing while pending, and a "request received" email.
- Sign-in with username or email and password, email verification, GitHub, Google and Apple providers, connected accounts, and an optional self sign-up flag.
- Observability, all off by default: Sentry, PostHog, Clarity and Firebase Analytics with a consent banner, `/api/metrics` for Prometheus and Grafana, Metabase reporting views and signed embeds, and per-workspace connected analytics (`/admin/observability`).
- Per-workspace SMTP, per-destination notification rate limits and destination failure alerts.
- Online payment for invoices through your own Stripe or Razorpay account, with payment links and webhooks.
- Email campaigns: subscriber lists, double opt-in, campaigns and templates, throttled sending, bounce handling and one-click unsubscribe. Open and click tracking is off by default.
- Finance: bank statement import (CSV and OFX) with matching; Tally, Xero, QuickBooks and journal exports; Receipts and Payments, Income and Expenditure and fund statements by financial year; donations posted to the ledger; FCRA fund checks and a quarterly report; in-kind gifts recorded as assets.
- Makerspace operations: machine downtime with a cost report, maintenance reminders, required inductions with a sign-off matrix, and consumables stock with reorder alerts.
- Tasks: an archived tab with permanent delete, column colours and WIP limits, a creator filter, a sortable list with sticky headers, swimlanes, saved views, density, due-date quick picks, `/` search and `j`/`k` shortcuts, copy link, a stale-edit warning, and images in descriptions. The MCP server and REST API match.
- Tasks: one-click **Assign to me** / **Unassign me** on cards, the task drawer (`i`) and list rows; the assignee picker lists you first.
- Tasks: per-project **Restrict task edits** (creator, assignees, project owner and admins edit; any member can still take an unassigned task; comments stay open).
- Tasks: assignment history records who assigned whom; people removed from a task are notified (`task.unassigned`).
- Tasks: per-project task types (icon, tone, default) with a type filter and type chips on cards and list rows.
- Tasks: move a task (with its subtasks) to another project; old links redirect to the new key.
- My Tasks tabs: Assigned to me, Assigned by me, My team (direct reports) and Created by me, with a quick add that assigns to you.
- List view: inline editing of status, priority, assignees and due date, and bulk edit of up to 50 tasks with per-task results.
- Board: accessible drag and drop (pointer, touch and keyboard with screen-reader announcements), a per-card "Move to…" menu, rapid quick add and the `c` shortcut; each project remembers its view and filters.
- Activity entries show where a change came from (web, assistant, MCP or API).
- MCP tools `sw_add_comment`, `sw_archive_task`, `sw_move_task` (columns or another project), `sw_assign_task` and `sw_claim_task`; `sw_create_task` / `sw_update_task` accept `type` and `assignees`.
- REST: `POST /api/v1/tasks/{ref}/comments|assignees|archive|move|transfer` and `POST`/`DELETE /api/v1/tasks/{ref}/claim`.
- Design-Kit is a git submodule (`design-kit/`); `npm run tokens:sync` regenerates the palette, motion tokens, token fixture and brand fonts.
- `npm run loc` and the codebase audit in `docs/AUDIT-2026-11.md`; new light and dark README banners.
- Collapsible groups everywhere: sidebar groups, list-view groups, board columns and My Tasks sections, each remembered per browser.
- Loading skeletons for every major page, a route progress bar, and token-driven motion for dialogs, drawers, menus, toasts, cards and rows (off under reduced motion).
- Project task lists and My Tasks in the README screenshots.

### Changed

- A suspended organisation shows its owners and admins only the plan page and settings home, with the reason.
- Workspace pages and Server Actions are gated by feature module automatically; API routes outside a workspace name their module.
- Design tokens follow Design-Kit 0.12.0: solid-black dark palette, scrim overlay and motion tokens (durations, easing, reduced motion).
- Typography follows Design-Kit: Outfit for body and UI, Gilroy ExtraBold for display headings, Unbounded for one accent phrase. PDFs use Gilroy Light and ExtraBold.
- MCP/REST task writes now go through the same services as the app (archived projects reject writes, disabled members can't be assigned, tasks keep board order, dates use the workspace time zone, completing unblocks dependants).
- README, docs index, CONTRIBUTING and package READMEs rewritten; Node is pinned to 22.18 or newer (`engines`, `.nvmrc`).
- Sidebar regrouped around daily work: personal items first, then Work, Chat, Knowledge, Community and People; Operations, Support & IT, Outreach, Finance, Settings and Preferences collapse by default. Clearer labels (Organisation, Companies, Blockers, Notification rules, Volunteer hours, Official documents).
- Task filters ordered by use with view options separated; project tabs put Board and Timeline together; project settings grouped into Basics, Ownership and Task rules.
- Light mode is the default; the sidebar shows "Workspace" under the Space Works lockup; Inbox and the top-bar notifications are icons.

### Fixed

- Concurrent assignee edits no longer overwrite each other (assignments lock the task and apply only real changes).
- Backups restore the `reporting` views together with the application schema, both on a VPS and with `npm run db:restore`.
- The split website forwards payment webhooks, bounce webhooks, one-click unsubscribe and Sign in with Apple posts to the backend.
- Grafana alerts for the database and Redis read only the web process, so worker and beat no longer raise false alerts.
- Invitations can no longer be accepted into a suspended or pending organisation.
- A person whose only organisation is suspended lands on its plan page (owners and admins) instead of a missing page; suspended and pending organisations no longer appear in the workspace switcher.
- Calendar and Payroll navigation now match their page rules, and settings tabs follow role, module switches and organisation status.
- The stock page passes quantities as plain values, so it renders once a workspace has stock items.
- Form labels are linked to their controls when a form is rendered on the server.

### Security

- The super admin reaches organisations without a membership row; that access is audited in the instance log only and never written into an organisation's own log.
- Payment keys, SMTP passwords, analytics secrets and provider secrets are encrypted at rest and write-only in every UI.
- Reporting views expose aggregates only (no names, titles or emails) and exclude private teams.
- Public campaign, payment and metrics endpoints use hashed bearer tokens or signatures, and `/api/metrics` returns an empty 404 without the token.
- Server Actions check the module switches themselves, so a switched-off module can't be reached by posting from another page. The `finance.payroll` sub-area is enforced the same way.
- A suspended, pending or rejected organisation is closed to API tokens, MCP, file downloads, public forms, webhooks, inbound messaging and scheduled jobs, not only to pages.
- Confirming a self sign-up needs the password chosen at sign-up, so nobody can pre-register someone else's address. A password reset also confirms the email.
- Workspace SMTP connects to the IP checked at resolve time, re-resolved every minute, only on ports 25, 465, 587 and 2525. Errors are reported by category, never with the server's text.
- Campaigns: public sign-ups always use double opt-in and never undo an unsubscribe. Members can test-send only to workspace members. There are per-address and per-workspace limits on confirmation emails, and confirmation links are not kept in the outbox. The bounce webhook secret is accepted only in a header.
- Payment webhooks are de-duplicated per organisation, and a refund can be requested once a minute per payment.

### Removed

- Unlicensed Gilroy Regular, Medium, SemiBold and Bold font files.

## [0.6.7] - 2026-10-29

### Fixed

- Recheck current notification and email access after account, membership, role or destination changes.
- Start and drain the complete local web, worker and scheduler stack with durable Redis and local service guards.
- Preserve Sharp native companions in standalone builds and use Linux line endings for deployment scripts.
- Keep generated frontend fingerprints stable across line endings, pin the migration CLI dependency fix, and bound container build workers.
- Exercise encrypted database, private-file and key recovery plus queued SMTP delivery in the installer acceptance suite.
- Restore the public schema transactionally without newer-table residue, and keep serving processes stopped when recovery fails after the database commits.
- Exercise task, chat, document and private file-version journeys in both production browser layouts.
- Align the Helm chart release and default application image with the current patch version.
- Preserve upload and presence headers through split hosting, validate the authenticated frontend origin, and render SVG chart titles as single strings.
- Remove unused global npm tooling from runtime and staging migration images while retaining Node and the isolated Prisma CLI.
- Pin the refreshed Silo server/client and build the standard Caddy edge with patched Go, dependencies and Alpine packages in setup and upgrades.

## [0.6.6] - 2026-10-23

### Changed

- Development tooling updated to clear dependency advisories: vitest and its coverage plugin 4.1.12 (with vite 8.3.5), brace-expansion 1.1.21 and 5.0.12, and eslint-config-next 16.4.2 to match Next.js.

## [0.6.5] - 2026-10-22

### Added

- Projects: milestones, a timeline with blockers, weekly status updates and printable project reports.
- People and organisation: departments, reporting lines and an org chart, a responsibilities register, attendance, escalation paths, leave balances, hiring, volunteer hours, a confidential help desk and a safety log.
- Money: funds and cost centres, supplier bills, month-end close, payroll records and disbursements, spend review, petty cash, deposits, depreciation and TDS registers.
- Recurring costs: rent ledgers and deposits, utilities and maintenance contracts, PF, ESI, PT and TDS remittances, staff advances, loan EMIs, insurance premiums and one upcoming-dues list.
- Funding: grants, CSR, donations, campaigns, pledges, donor receipts and impact reports.
- Documents: GST invoices and notes, receipts, 80G and utilisation certificates, and letters.
- Governance: compliance calendar, board meetings and resolutions, vendors and contracts, insurance and registers, risks and drills, safeguarding cases and board packs.
- Product, marketing and IT: roadmap, releases with approvals, issues and QA, BOM cost estimates for funding proposals, prototype tests, change log, content calendar, brand assets, proposals, device and licence registers, security incidents and access reviews.
- Secrets: application secrets by project and environment with envelope encryption, rotation, snapshots, masked reveal, approvals, machine identities, one-time share links, and the `sww` CLI and Node SDK published with each release.
- Reports and analytics across every area, with drill-down, a cash-flow forecast and management and board packs.
- A team calendar with recurring meetings, invitations, Google Calendar sync and Google Meet links.
- Background jobs on a BullMQ worker and beat; reminders reach email and every linked messaging account by default.

### Fixed

- Workspace row locks no longer block foreign-key inserts in other connections.
- The demo seed runs on a fresh database and can be re-run.
- `sanitize-html` updated to clear a moderate advisory.
- Global search matches text before running per-record access checks, so workspaces with many records and secrets search quickly.
- Closing a poll while a vote arrives no longer fails: serializable retries back off instead of colliding.

## [0.1.0] - 2026-10-20

### Removed

- Equipment lending and reservations, community events and responses, shoutouts,
  and blog publishing, because Workspace is the internal operations tool;
  member-facing events, bookings and publishing live in the other Space Works products.
  Internal assets, physical access records, meetings, rota and personal feeds remain.

### Added

- Projects, kanban boards, recurring tasks, dependencies, cycles and personal tasks.
- Channels, direct messages, threads, reactions, pins and live updates.
- Nested rich-text docs, revisions, verification, private files and versions.
- Announcements and private personal feeds for internal work.
- Community kitty, invoices and finance categories.
- Assistant conversations, workspace tools, memory, skills, scheduled digests, boardroom, MCP and scoped machine APIs.
- Google, GitHub, SEO, messaging connections, account linking, channel bridges and signed webhooks.
- Service checks, incidents, maintenance, on-call, public status pages, cloud inventory and costs.
- Member profiles, teams, onboarding, certifications, availability, rota, contacts, organisations and pipeline.
- Service catalogue, subscriptions, encrypted vault, internal assets, physical access records, budgets, purchases, reimbursements, approvals and forms.
- Meetings, decisions, goals, key results, polls, ideas, templates, changelog and sign-offs.
- My day, global search, activity, pinned links, command palette, notification centre, preferences, exports, imports, legal hold and retention.
- App-store review inbox, replies, triage, insights, task links and notification routing.
- Instance OIDC providers for existing active members with verified emails, stable subject linking and local MFA completion. The v2 session cookie requires a fresh sign-in after upgrading.
- Project cycles settings, GitHub pull requests and issues on project overviews, and role-aware services and app-review summaries on My day.
- Shared retention writers for chat content, activity, notifications and deliveries, monitor raw results, assistant conversations, audit, inbound events and completed outbox jobs; legal hold protects workspace records.

### Fixed

- Notification-rule rating filters survive editor saves and combine with minimum severity during delivery planning.
- Global search checks app reviews and incidents against live tenant and role access; decisions also require access to their parent meeting.
- Outbox retry tests claim their own jobs; integration cleanup removes tenant jobs before deleting their ownership records.
- All completed areas and settings are reachable through role-aware navigation, with pinned links in the sidebar.
- Removed unused variables and retired the unused feature placeholder.

### Foundation

- Foundation: Next.js 16 / Prisma 6 / Auth.js v5 project scaffold, tooling and tests.
- Complete data model for every product area with committed migrations, with
  generated full-text search columns on tasks, messages and docs.
- Space Works brand: tokens, Gilroy and Unbounded fonts, logos, light and dark
  colour modes, and the shared UI primitives in `components/ui`.
- First-run setup that creates the instance owner, the first workspace and the
  default channels (#general, #announcements, #random).
- Invite-only sign-in with email and password, optional Google sign-in for
  invited members, TOTP two-step verification with recovery codes, password
  reset by email and invitation acceptance.
- Workspace shell with grouped text-only navigation by role, workspace
  switcher, notifications and a home dashboard.
- Workspace settings: general details, members (roles, suspension, removal with
  last-owner protection), invitations, labels and the audit log.
- Account area: profile and skills, password, two-step verification, colour
  mode, sign out everywhere and a JSON data export.
- Instance admin with TOTP step-up: encrypted instance settings (SMTP, Google,
  assistant key), workspaces, users and email outbox health.
- Shared services across features: realtime SSE fan-out over Redis, private
  file storage with an authorised download route, notifications, audit log,
  email outbox, rate limits and per-workspace counters.
- Health, readiness and outbox scheduler endpoints; demo seed for
  "TinkerSpace Kochi".
