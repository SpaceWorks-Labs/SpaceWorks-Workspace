<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Space Works Workspace agent guide

## Product at a glance

Space Works Workspace is the self-hosted, **internal**, invite-only workspace
of the Space Works maker community (it started inside TinkerSpace Kochi).
Members coordinate projects on kanban boards, talk in channels and direct
messages, keep shared docs and files, track the community kitty (finance),
coordinate internal meetings and shifts, and ask the Space Works Assistant
about their work. Integrations: Google (Calendar, Gmail,
Drive, Search Console), a GitHub App and a Telegram bot. It is an original
Space Works product, licensed AGPL-3.0-or-later.

Stack: Next.js 16 App Router (`output: "standalone"`), React 19, TypeScript,
PostgreSQL 16 with Prisma 6, Auth.js v5 (JWT sessions, credentials + optional
Google/instance OIDC, TOTP MFA), Tailwind CSS 4 + Radix primitives, Redis (rate limits and
realtime fan-out), S3-compatible private storage (Silo locally, Cloudflare R2
in the cloud), Nodemailer through an outbox, Vitest and Playwright.

"Internal" means: every route needs a session except `/login`, `/setup`
(first run only), `/forgot-password`, `/reset-password/[token]`,
`/invite/[token]`, opted-in status pages, public forms, personal feed and
heartbeat capabilities, integration webhooks and health endpoints.
Tenancy is strict: `Workspace` is the tenant boundary.

## Repository map

| Path | Purpose |
| --- | --- |
| `app/` | App Router pages, layouts, route handlers |
| `app/w/[workspaceSlug]/` | Everything inside a workspace (one folder per product area) |
| `app/actions/` | Server Actions, one file per domain |
| `app/admin/`, `app/admin-mfa/` | Instance super-admin (TOTP step-up) |
| `app/api/` | Health, outbox, files, realtime SSE, auth, account export |
| `components/ui/` | Brand primitives: button, field, select, choice, dialog, menu, tabs, table, display |
| `components/chrome/` | App shell, auth frame, simple shell, colour-mode toggle |
| `components/<area>/` | Feature UI for work, chat, knowledge, people, operations, collaboration, services, reviews and integrations |
| `lib/` | Area services; `lib/search` live access checks, `lib/notify` routing, `lib/shell` platform services and retention writers |
| `scripts/seed/` | Automatically loaded per-area demo seed modules |
| `docs/areas/` | Implemented area contracts, operations and known limits |
| `prisma/` | `schema.prisma` (complete for every phase) and migrations |
| `scripts/` | Prisma wrapper, seed, storage init, backups, production preflight, scheduler, VPS install/update/backup/restore |
| `Dockerfile`, `compose.production.yml`, `docker/vps/`, `install.sh` | Container image and the single-VPS stack (see `docs/DEPLOYMENT_VPS.md`) |
| `charts/`, `render.yaml`, `.do/`, `deploy/cloudflare-cron/` | Kubernetes, Render, DigitalOcean and the cron Worker (`docs/DEPLOYMENT_*.md`) |
| `tests/unit`, `tests/integration`, `tests/e2e` | Vitest unit, PostgreSQL integration (`*.db.test.ts`), Playwright |
| `design-kit/` | Git submodule (SpaceWorks-Labs/Design-Kit): source of truth for tokens and fonts; `npm run tokens:sync` regenerates `app/styles/palette.css`, `motion.css`, the token fixture and `public/brand/fonts`. Never needed by builds or CI |
| `docs/` | `DESIGN.md` (brand and UI), `ARCHITECTURE.md` (services and flows), `ROADMAP-BUILD.md` (area ownership for parallel builds) |

`prisma/schema.prisma` is authoritative for the data model. It already holds
the models for every planned area (work, chat, knowledge, community,
operations, assistant, integrations, SEO, boardroom) plus the platform
extension (teams, people, approvals, service catalogue, vault, CRM, assets,
money requests, meetings, polls, goals, rota, forms, the Services monitor and
messaging + notification routing). Read it before adding anything.

## Working conventions

- Server Components by default. Add `"use client"` only for state, effects,
  event handlers or browser APIs. Business rules live in `lib/`, and server
  modules start with `import "server-only"`.
- Read the relevant guide in `node_modules/next/dist/docs/` before touching
  Next.js APIs (Next 16: `proxy.ts` replaces middleware, `params` is a
  Promise, `PageProps<"/route">` / `LayoutProps` / `RouteContext` are global
  generated types; run `npx next typegen` after adding routes).
- **Server Action pattern** (`app/actions/<domain>.ts`):
  auth → resolve the workspace from the slug server-side
  (`getWorkspaceForAction(slug, minRole)`) → capability check
  (`lib/roles.ts`) → rate limit (`isActionRateLimited`) → `zod.safeParse` →
  Prisma (transaction when several rows change) → `recordAuditEvent` →
  `revalidatePath` → return `ActionResult` (`{ ok: true, data? }` or
  `{ ok: false, error, fieldErrors? }`, see `lib/actionResult.ts`).
  Never trust a `workspaceId` from the client. Every query on tenant data
  filters by `workspaceId`. A `"use server"` file may export only async functions.
- **Pages** inside a workspace call `await requireWorkspace(workspaceSlug, minRole)`
  themselves (layouts do not re-run on client navigation;
  `tests/unit/page-guards.test.ts` enforces it). Every `app/admin/**/page.tsx`
  calls `await requireSuperAdminMfa()`.
- Process-wide singletons (Prisma, Redis, S3 client, realtime emitter, outbox
  worker) live on `globalThis` under `Symbol.for("sww.*")`.
- Every schema change ships a migration (`npm run db:migrate -- --name <area>`),
  never `db push`. If a later phase must change the schema, append fields or
  models at the end of the relevant section and name the migration after the area.
- Validate all inputs with Zod (`lib/validation.ts` has shared schemas).
  Errors are short, UI-safe sentences: say what happened, then what to do.
- Dates: `lib/format/datetime.ts` with the workspace time zone. Money: integer
  minor units, formatted by `lib/format/money.ts` (INR default).
- **300-line file limit.** Every hand-written file (`.ts`, `.tsx`, `.js`,
  `.mjs`, `.css`, including tests, scripts and seed modules) stays at or below
  300 lines. ESLint `max-lines` and `tests/unit/file-size.test.ts` enforce it.
  Split by responsibility: queries, mutations, validation, mappers, view
  sections, one test file per behaviour. Turn `lib/area/service.ts` into
  `lib/area/service/` with an `index.ts` re-export so import paths stay stable.
  Never meet the limit by joining lines, packing statements together or
  deleting useful comments. Exempt: generated files (`frontend/` catalog and
  types, `lib/views/generated/`, `lib/frontend/{registry,resources}.ts`),
  `prisma/schema.prisma`, migrations and lockfiles.
- Write "Space Works" in copy, `SpaceWorks` only in code identifiers. No emoji
  in UI chrome. Assistant tools exposed over MCP use the `sw_` prefix
  (e.g. `sw_list_tasks`).

## Design system

Follow [docs/DESIGN.md](docs/DESIGN.md). Colours come only from tokens
(`app/styles/tokens.css` mapped in `app/globals.css`): `bg-canvas`,
`bg-panel`, `bg-primary`, `bg-sidebar`, `sw-*` brand colours, etc. Never
hard-code hex in components. Outfit for text, Gilroy ExtraBold only for display
headings; Unbounded (`font-accent`) only
for one accent phrase on auth/empty-state heroes, never in app chrome. Teal
primary actions, Workshop Orange only as a fill with an ink label (and never
in the app chrome as a button), Citron text-only sidebar with a teal active
item, flat cards with 1px lines, 44px controls with 10px radius, status pills
always carry a word, underline tabs. Empty states: one short line plus one
action, e.g. "No projects yet. Start one for the next build night."

## Security and tenancy rules

- Non-members, suspended members and unknown or archived workspaces all get
  the same `notFound()`: a slug never reveals that a workspace exists.
- Roles: OWNER > ADMIN > MEMBER > GUEST. GUEST reads and comments, chats only
  in channels they were added to, never sees finance or settings. MEMBER
  creates tasks, docs, messages, files; sees the finance summary
  only when `financeVisibleToMembers`. ADMIN manages members, invites, labels,
  channels, finance, API tokens and integrations. OWNER can also delete
  the workspace and transfer ownership. Use the helpers in `lib/roles.ts`.
- A workspace always keeps one ACTIVE owner (`lib/membership.ts` locks owner
  rows). Admins never act on other admins or owners.
- Super-admin is the user whose email equals `SUPER_ADMIN_EMAIL`, plus a fresh
  TOTP step-up (`/admin-mfa`, 10 minutes). Everyone else gets `notFound()`.
- Bearer capabilities (invitation, password reset, API tokens, OAuth state,
  account link codes, heartbeat tokens, calendar feed tokens) are random and
  stored only as SHA-256 hashes. Never log
  them, put them in audit metadata, or render them back.
- Secrets at rest: MFA seeds (`MFA_ENCRYPTION_KEY`), instance settings
  (HKDF subkey of it), integration OAuth tokens (`INTEGRATION_ENCRYPTION_KEY`,
  see `lib/integrationSecrets.ts`), and one `encryptSecret` purpose per new
  encrypted column (messaging, notification, cloud and monitor secrets,
  emergency contacts, SSO). Vault items use envelope encryption under
  `VAULT_MASTER_KEY`. Write-only in every UI; vault secrets never reach
  search, activity, notifications, logs or assistant tools.
- Files are private. Upload with `uploadWorkspaceFile` (type allow-list, size
  limit, image decode check) and serve only through `/api/files/[id]`, which
  checks membership, admin-only docs and finance visibility.
- Realtime events carry ids and kinds only, never message bodies; set
  `audience` for private channels and DMs.
- Do not read, print or commit `.env`. Do not loosen CSP nonces, security
  headers, trusted proxy handling or Redis fail-closed rate limits.

## Shared services (use these; don't re-implement)

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for signatures. In short:
`lib/permissions.ts` (`requireAuth`, `requireWorkspace`, `getWorkspaceForAction`,
`requireSuperAdminMfa`), `lib/roles.ts` (capabilities), `lib/realtime.ts`
(`publish`, `publishToUser`, `subscribe`) + `components/realtime/useRealtime.ts`,
`lib/storage` (`uploadWorkspaceFile`, `fileUrl`, `deleteObjects`),
`lib/notifications.ts` (`createNotifications`; new features notify through
`lib/notify` `dispatch()` instead), `lib/audit.ts`
(`recordAuditEvent`), `lib/outbox.ts` (`enqueueEmail` and friends),
`lib/counters.ts` (`nextWorkspaceSequence`), `lib/workspaces.ts`
(`createDefaultBoardColumns`, `joinDefaultChannels`), `lib/nav.ts` (the one
navigation config), `lib/instanceSettings.ts` (`getAssistantSettings`,
`getEmailSettings`, `getGoogleSsoSettings`), `lib/notify` (`dispatch`,
`setScopedDestinations`, the event catalogue and destination adapters),
`lib/search/documents.ts`, `lib/activity.ts`, `lib/teamAccess.ts` and
`lib/scheduled/<area>.ts` (periodic jobs).

Tasks: every task write (app, assistant, MCP, REST) goes through
`lib/tasks/service` and its single gate `loadEditableTask(actor, id, { action })`
with the rules in `lib/tasks/capabilities.ts` (`restrictTaskEdits`, claim,
unclaim). Assignment changes use `assignTask` / `unassignTask` / `claimTask` /
`unclaimTask` / `setAssignees` (row lock, real diffs only); never write
`TaskAssignee` directly. Assistant and API callers build the actor with
`principalToActor` (`lib/assistant/tools/tasks/actor.ts`) so history records
the source.

Design tokens: never edit `app/styles/palette.css`, `motion.css` or
`tests/fixtures/design-tokens.json` by hand; update the `design-kit` submodule
(`git submodule update --init --depth 1 design-kit`) and run
`npm run tokens:sync`.

Parallel builds: [docs/ROADMAP-BUILD.md](docs/ROADMAP-BUILD.md) lists, per
area, the routes, models and helpers it owns and the shared core nobody
else edits.

## Verification

```bash
npm run lint
npm run typecheck              # next typegen && tsc --noEmit
npm run test:unit
npm run db:test:prepare        # migrate the disposable TEST_DATABASE_URL
npm run test:integration       # wipes data in TEST_DATABASE_URL
npm run build
```

`npm run typecheck` needs `NODE_OPTIONS=--max-old-space-size=8192` on Node 26.
Local Playwright runs (`npx playwright test`) need `AUTH_URL=http://127.0.0.1:3100`
(the e2e server's origin); the first logins against a cold dev server can flake,
so use `--retries=2` like CI.
The files integration test needs local Silo: `docker compose up -d --wait silo silo-init`
(creates the `sww-dev` and `sww-docsfiles` buckets).

Run lint, typecheck and unit tests before every hand-off, integration tests
for data or permission changes, and a build at least once per phase. Report
anything you did not run.

## Branching

- `main` is production; only @Shaan-Shoukath merges to it. Never push to `main`.
- `dev` is the integration branch. Each feature goes on `feat/<short-name>`
  (or `fix/<short-name>`) from the latest `dev` and lands through a pull request.
- Commit in small logical steps with conventional messages
  (`feat(tasks): …`, `test(chat): …`) and explicit paths. Push or delete
  branches only when asked.
- Parallel sessions: prefer a separate worktree per feature branch and keep to
  your own area's folders (`app/w/[workspaceSlug]/<area>`, `app/actions/<area>.ts`,
  `components/<area>/`, `lib/<area>*`).
