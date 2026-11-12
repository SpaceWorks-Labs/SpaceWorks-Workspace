# Roles and access

The single definition of who sees and does what. Code is authoritative:
`lib/roles.ts` (role and capability helpers), `lib/nav.ts` (sidebar),
`lib/settingsTabs.ts` (settings tabs), `lib/navContext.ts` (the context both
are filtered with), `lib/modules.ts` (module switches) and each page's
`requireWorkspace(slug, minRole)`. `tests/unit/role-guards.test.ts` fails when
a sidebar item or settings tab asks for a different role than its page, and
`tests/unit/role-views.test.ts` pins each role's view.
`tests/e2e/role-views.spec.ts` signs in as the demo owner, admin, member and
guest and opens every visible link. Hiding a link is never authorization:
pages, Server Actions and API routes check again.

## The roles

| Role | Who | Home | Sees |
| --- | --- | --- | --- |
| Super admin | The user whose email is `SUPER_ADMIN_EMAIL`, with a TOTP step-up (`/admin-mfa`, 10 minutes) | `/admin` console | The instance console only (Overview, Instance settings, Organisations, Requests, Users, Sign-in, SSO, Backups, Jobs, Observability, Email outbox). Every organisation silently, as a synthetic OWNER |
| OWNER | Workspace owner (at least one active per workspace) | Last workspace | Everything an admin sees, plus Plan & limits, deleting the workspace and transferring ownership |
| ADMIN | Workspace administrator | Last workspace | Every work area plus administration: settings, members, finance, governance, hiring, funding, money controls, official documents, SEO |
| MEMBER | Regular member | Last workspace | Work areas: tasks, projects, chat and DMs, docs, files, assistant, operations, support, outreach. No settings |
| GUEST | Outside collaborator | Last workspace | Read and comment in workspace-wide areas, chat only in channels they were added to |

Order: OWNER > ADMIN > MEMBER > GUEST (`hasRoleAtLeast`). Admins never act on
other admins or owners (`canActOnMember`); only owners create owners or admins
(`assignableRoles`).

### Super admin

- Not a workspace role. `requireSuperAdmin` / `requireSuperAdminMfa` guard
  `/admin/**`; everyone else gets `notFound()`.
- Full silent access to every ACTIVE organisation: `requireWorkspace` and
  `getWorkspaceForAction` return a synthetic OWNER membership with
  `viaSuperAdmin: true` (never stored, `id` ""). Per-area helpers use
  `activeMemberOrSuperAdmin`. The access is audited in the instance audit log
  only (`admin.workspace_accessed`, once per 12 hours per organisation).
- Payroll: `viaSuperAdmin` counts as a full payroll grant.
- Shell: the switcher labels the role "Super admin" and has an "Instance admin"
  entry; the account menu and command palette link to `/admin` too. The
  console's back link goes to the last workspace (or the account page).
- Landing: `homePathFor` in `lib/homePath.ts` returns `/admin` for the super
  admin, otherwise the last (or first) workspace.

## Sidebar by role

`yes` visible, `–` hidden, `setting` only when *Finance visible to members* is
on, `grant` only with a payroll grant. Each item also disappears when its
module (last column) is switched off. The page guard always matches the item;
the one documented exception is Money controls, whose page also admits members
to acknowledge their own custodian handovers (reached from the notification).

| Area | GUEST | MEMBER | ADMIN | OWNER | Module |
| --- | --- | --- | --- | --- | --- |
| Home `/` | yes | yes | yes | yes | `core` |
| My tasks `/my-tasks` | – | yes | yes | yes | `core` |
| Calendar `/calendar` | yes | yes | yes | yes | `core` |
| Notepad `/notepad` | yes | yes | yes | yes | `core` |
| Search `/search` | yes | yes | yes | yes | `core` |
| Reports & analytics `/analytics` | – | yes | yes | yes | `analytics` |
| **Work** | | | | | |
| Projects `/projects` | yes | yes | yes | yes | `projects` |
| Blockers `/projects/blockers` | yes | yes | yes | yes | `projects` |
| Cycles `/cycles` | – | yes | yes | yes | `projects` |
| Goals `/goals` | – | yes | yes | yes | `projects` |
| Meetings `/meetings` | yes | yes | yes | yes | `meetings` |
| Decisions `/meetings/decisions` | yes | yes | yes | yes | `meetings` |
| Sign-offs `/sign` | yes | yes | yes | yes | `meetings` |
| Product and engineering `/product-ops` | – | yes | yes | yes | `projects` |
| **Chat** | | | | | |
| Channels `/chat` | yes | yes | yes | yes | `chat` |
| Direct messages `/dm` | – | yes | yes | yes | `chat` |
| Assistant `/assistant` | – | yes | yes | yes | `assistant` |
| Boardroom `/boardroom` | – | yes | yes | yes | `assistant` |
| **Knowledge** | | | | | |
| Docs `/docs` | yes | yes | yes | yes | `knowledge` |
| Files `/files` | yes | yes | yes | yes | `knowledge` |
| Templates `/templates` | – | yes | yes | yes | `knowledge` |
| Forms `/forms` | – | yes | yes | yes | `knowledge` |
| Links `/links` | yes | yes | yes | yes | `knowledge` |
| Official documents `/documents` | – | – | yes | yes | `knowledge` |
| **Community** | | | | | |
| Announcements `/announcements` | yes | yes | yes | yes | `community` |
| Activity `/activity` | yes | yes | yes | yes | `community` |
| Changelog `/changelog` | yes | yes | yes | yes | `community` |
| Polls `/polls` | – | yes | yes | yes | `community` |
| Ideas `/ideas` | – | yes | yes | yes | `community` |
| **People** | | | | | |
| Members `/members` | yes | yes | yes | yes | `core` |
| Teams `/teams` | yes | yes | yes | yes | `people` |
| Organisation `/organisation` | – | yes | yes | yes | `people` |
| Onboarding `/onboarding` | yes | yes | yes | yes | `people` |
| **Operations** | | | | | |
| Safety & facilities `/safety` | – | yes | yes | yes | `operations` |
| Safeguarding `/safeguarding` | – | yes | yes | yes | `operations` |
| Governance `/governance` | – | – | yes | yes | `operations` |
| Rota `/rota` | – | yes | yes | yes | `people` |
| Leave `/leave` | – | yes | yes | yes | `people` |
| Volunteer hours `/volunteering` | – | yes | yes | yes | `people` |
| Hiring `/hiring` | – | – | yes | yes | `people` |
| **Support & IT** | | | | | |
| Help desk `/helpdesk` | – | yes | yes | yes | `helpdesk` |
| Requests `/requests` | – | yes | yes | yes | `helpdesk` |
| Services `/services` | – | yes | yes | yes | `services` |
| Service catalogue `/catalogue` | – | yes | yes | yes | `services` |
| Assets `/assets` | – | yes | yes | yes | `services` |
| IT administration `/it` | – | yes | yes | yes | `services` |
| Stock `/stock` | – | yes | yes | yes | `services` |
| Vault `/vault` | – | yes | yes | yes | `vault` |
| Secrets `/secrets` | – | yes | yes | yes | `secrets` |
| **Outreach** | | | | | |
| Contacts `/contacts` | – | yes | yes | yes | `outreach` |
| Companies `/contacts/organisations` | – | yes | yes | yes | `outreach` |
| Pipeline `/contacts/pipeline` | – | yes | yes | yes | `outreach` |
| Marketing `/marketing` | – | yes | yes | yes | `outreach` |
| Email campaigns `/campaigns` | – | yes | yes | yes | `campaigns` |
| Social `/social` | – | yes | yes | yes | `social` |
| App reviews `/app-reviews` | – | yes | yes | yes | `social` |
| SEO `/seo` | – | – | yes | yes | `social` |
| **Finance** | | | | | |
| Finance `/finance` | – | setting | yes | yes | `finance` |
| Staff advances `/finance/advances` | – | yes | yes | yes | `finance` |
| Payroll `/finance/payroll` | – | grant | grant | grant | `finance` |
| Subscriptions `/subscriptions` | – | yes | yes | yes | `finance` |
| Funding and impact `/funding` | – | – | yes | yes | `finance` |
| Money controls `/money-controls` | – | – | yes | yes | `finance` |
| **Settings** | | | | | |
| Workspace `/settings` | – | – | yes | yes | `core` |
| Integrations `/settings/integrations` | – | – | yes | yes | `integrations` |
| Messaging `/settings/messaging` | – | – | yes | yes | `integrations` |
| Notification rules `/settings/notifications` | – | – | yes | yes | `core` |
| Webhooks `/settings/notifications#webhooks` | – | – | yes | yes | `integrations` |
| Cloud accounts `/settings/cloud-accounts` | – | – | yes | yes | `integrations` |
| Retention `/settings/retention` | – | – | yes | yes | `core` |
| App review settings `/app-reviews/settings` | – | – | yes | yes | `social` |
| Onboarding templates `/settings/onboarding` | – | – | yes | yes | `people` |
| Plan & limits `/settings/plan` | – | – | – | yes | `core` |
| Payments `/settings/payments` | – | – | yes | yes | `core` |
| Email sending `/settings/email` | – | – | yes | yes | `core` |
| Connected analytics `/settings/analytics` | – | – | yes | yes | `analytics` |
| **Preferences** | | | | | |
| Notification preferences `/notifications/preferences` | yes | yes | yes | yes | `core` |
| Connected accounts `/notifications/accounts` | – | yes | yes | yes | `core` |
| Personal calendar feed `/calendar/subscribe` | yes | yes | yes | yes | `core` |
## Settings tabs

All settings tabs need ADMIN (the settings layout requires it) except Plan &
limits (OWNER). Tabs follow module switches like the sidebar: Social and App
reviews (`social`), Integrations, Webhooks, Messaging, Cloud accounts
(`integrations`), Onboarding (`people`) and Connected analytics (`analytics`).
Members and guests have no settings tabs and no Settings group. Export, Import
and Retention are admin data controls (`canExportWorkspace` is ADMIN).

## Capabilities beyond the role

Role gates first, then record-level rules in each area's `lib`:

| Capability | Rule |
| --- | --- |
| Finance summary | `canViewFinance`: admins; members when `financeVisibleToMembers`; never guests |
| Payroll | `canViewPayroll` / `canManagePayroll`: an explicit `FinancePayrollGrant` (view or manage), or the super admin. Role alone never grants it, owners included. Off for everyone when `finance.payroll` is switched off |
| Costs | `canViewCosts`: admins; members when `costsVisibleToMembers` |
| Incidents | `canAckIncidents`: admins; members when `membersCanAckIncidents` |
| Private teams | `lib/teamAccess.ts`: PRIVATE team records (projects, channels, meetings, shifts, links, monitors) are visible to team members and admins only |
| Docs | `lib/docs/rules.ts`: guests read WORKSPACE docs; ADMINS-only docs need ADMIN |
| Vault | `canUseVault` (MEMBER) opens it; each item still needs a grant |
| Secrets | `canUseSecrets` (MEMBER) plus explicit environment access |
| Safeguarding | Handlers are appointed by owners and see only assigned cases (`canHandleSafeguarding`) |
| Money controls | `canReadMoneyControl`: admins, or the person named on their own handover or assignment |
| Staff advances | Payroll managers, or the person the advance belongs to |
| Project plans | `canManageProjectPlan`: admins or the project lead |
| Meetings | Creators, facilitators and admins manage; guests only respond to invitations |
| Emergency contacts | Admins and the person themselves; every view is audited |

## Guests

Guests read and comment; they never create tasks, docs, files or polls, never
see finance, settings, operations, support, outreach or the assistant, and
cannot use DMs. Scope:

- Chat: only channels they were added to (`lib/chat/policy.ts`).
- Calendar: meetings they are invited to and their own entries
  (`lib/calendar/access.ts`).
- Projects, docs, files, meetings, announcements, teams: the workspace-wide
  records outside private teams, read-only.
- Members: the directory without email addresses (`canSeeMemberEmails`).
- Home: no task, shift or services widgets; quick-create actions hidden.

## Organisation status and module switches

- PENDING and REJECTED organisations are `notFound()` for everyone.
- SUSPENDED organisations open only `/settings` and `/settings/plan` to owners
  and admins (`passesWorkspaceGate`). The sidebar and settings tabs then show
  only those two entries; members and guests get `notFound()`.
- Modules (`lib/modules.ts`) are switched per organisation by the super admin.
  A switched-off module hides its sidebar items, settings tabs, palette
  commands and home widgets, and its pages, actions and API routes return
  `notFound()` or an error. `finance.payroll` switches only payroll off.

## One map, every surface

`navContextFor(workspace, membership)` builds the context (role, modules,
status, payroll grant). The sidebar (`lib/appShell.ts`), the settings tabs
(`app/w/[workspaceSlug]/settings/layout.tsx`), the command palette
(`lib/shell/tools.ts`) and the home widgets (`lib/dashboard.ts`, `show`) all
filter from it, so a role never sees a link that would 404.

When adding a page: add the item to `lib/nav.ts` (or `lib/settingsTabs.ts`)
with the same `minRole` the page passes to `requireWorkspace`, put its route
in `lib/modules.ts`, and run `tests/unit/role-guards.test.ts`.
