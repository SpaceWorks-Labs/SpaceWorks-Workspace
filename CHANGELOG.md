# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
