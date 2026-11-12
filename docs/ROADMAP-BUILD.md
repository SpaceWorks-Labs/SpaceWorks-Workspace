# Build roadmap and ownership

The platform extension (migration `platform_extension`) finished the data
model, navigation and shared core for every remaining area. The twelve build
areas below can now run **in parallel**: each owns its own folders and models,
and none of them needs a schema, navigation or shared-core edit.

Read [AGENTS.md](../AGENTS.md) and [ARCHITECTURE.md](ARCHITECTURE.md) first.
This file says who owns what.

## Ground rules for every area

1. **Never edit shared core** (list below). If you find a gap (a missing
   column, a missing event type, a capability you need), work around it inside
   your area and report it to the coordinator. Never touch
   `prisma/schema.prisma` or add a migration.
2. **Own only your folders**: your route folders, `app/actions/<area>*.ts`,
   your `lib/` and `components/` folders, your `lib/scheduled/<file>.ts`, and
   tests named `tests/{unit,integration}/<area>-*.test.ts` /
   `tests/e2e/<area>-*.spec.ts`. Placeholder pages are yours to replace in
   place (keep the `requireWorkspace(workspaceSlug, minRole)` call and the
   capability check).
3. **Write only your own models.** Reading another area's tables is fine
   (always filter by `workspaceId` and respect visibility). The few
   cross-area writes are listed under "Cross-area writes" and nowhere else.
4. **Notify only through `dispatch()`** (`lib/notify`). Use the event types in
   `lib/notify/events.ts`, put entity ids in `scope` (keys in
   `SCOPE_KEYS`), and store an entity's "Send to" choice with
   `setScopedDestinations`. Never insert `Notification` rows or send
   email/Slack/etc. directly.
5. **Periodic work** goes in your `lib/scheduled/<file>.ts` `run(now)` (called
   about once a minute by every replica; keep it idempotent).
6. **Search and activity**: call `indexSearchDocument` / `removeSearchDocument`
   for your searchable entities and `recordActivity` for notable changes.
   Never index secrets.
7. **Secrets** use `encryptSecret(purpose, …)` with the purpose for your
   column (see `lib/crypto.ts`); the vault uses `sealEnvelope` /
   `openEnvelope` with `vaultMasterKey()`.
8. **Docs**: describe your area in a new `docs/areas/<area>.md`. Do not edit
   `docs/ARCHITECTURE.md`, `AGENTS.md`, `README.md` or `CHANGELOG.md`; the
   coordinator folds your notes in at merge.
9. **Dependencies** may be added (pin exact versions like the rest of
   `package.json`); say so in your report so the lockfile merge is expected.
10. **Audit actions** use your area's prefix (`monitor.created`,
    `vault.item_revealed`, …). **Counters** (`nextWorkspaceSequence`) in use:
    `"task"`, `"invoice"`, `"incident"`.
11. Keep the brand and voice rules in [DESIGN.md](DESIGN.md); copy says
    "Space Works", code says `SpaceWorks`; MCP tools use the `sw_` prefix.

### Shared core (coordinator-owned, do not edit)

`prisma/**` · `lib/nav.ts` · `lib/roles.ts` · `lib/permissions.ts` ·
`lib/notify/**` (except the provider adapter files listed under
integrations-messaging) · `lib/notifications.ts` · `lib/outbox.ts` ·
`lib/outboxWorker.ts` · `lib/scheduled/index.ts` · `lib/crypto.ts` ·
`lib/env.ts` · `.env.example` · `lib/search/documents.ts` · `lib/activity.ts` ·
`lib/teamAccess.ts` · `lib/realtime*.ts` · `lib/storage/**` · `lib/audit.ts` ·
`lib/db.ts` · `lib/redis.ts` · `lib/rateLimit.ts` · `lib/actionRateLimit.ts` ·
`components/ui/**` · `components/chrome/**` ·
`components/settings/SettingsTabs.tsx` · `app/w/[workspaceSlug]/layout.tsx` ·
`app/w/[workspaceSlug]/settings/layout.tsx` · `app/layout.tsx` · `app/globals.css` ·
`app/styles/**` · `proxy.ts` · `instrumentation.ts` · `next.config.ts` ·
`docs/ARCHITECTURE.md` · `docs/DESIGN.md` · `AGENTS.md` · `README.md` ·
`CHANGELOG.md`. Deployment files (`Dockerfile`, `docker-compose*`, `docker/`,
`deploy/`, `charts/`, `render.yaml`, `install.sh`, `scripts/*vps*`,
`docs/DEPLOYMENT_*`) belong to the deployment build.

### Shared contracts available now

| Need | Use | Where |
| --- | --- | --- |
| Notify anyone about anything | `dispatch(workspaceId, event, { tx? })` | `lib/notify` |
| Test send to a destination | `sendTest(workspaceId, destinationId, actorId)` | `lib/notify` |
| Store an entity's "Send to" | `setScopedDestinations(tx, { workspaceId, scopeType, scopeId, destinationIds, actorId })`, `getScopedDestinationIds`, `listPickableDestinations(workspaceId, role)` | `lib/notify/scopedRules.ts` |
| Event types, payload types, categories | `EVENT_CATALOG`, `EventPayloads`, `NOTIFY_CATEGORIES`, `eventTypesByCategory()` | `lib/notify/events.ts` (client-safe) |
| Destination adapter contract | `DestinationAdapter`, `SendResult`, `notConfiguredAdapter` | `lib/notify/adapters/types.ts` |
| Role gates | `canViewServices`, `canManageVault`, `canAckIncidents(m, ws)`, `canViewCosts(m, ws)`, … | `lib/roles.ts` |
| Private-team visibility | `userTeamIds`, `hiddenTeamIds`, `teamScopeFilter(hidden)` | `lib/teamAccess.ts` |
| Global search (write side) | `indexSearchDocument`, `removeSearchDocument` | `lib/search/documents.ts` |
| Activity feed (write side) | `recordActivity` | `lib/activity.ts` |
| Periodic jobs | `run(now)` in your file | `lib/scheduled/<file>.ts` |
| Encrypted columns | `encryptSecret` purposes `messaging-credentials`, `notification-secrets`, `cloud-credentials`, `monitor-secrets`, `member-emergency`, `sso-secrets`; vault: `sealEnvelope`, `openEnvelope`, `vaultMasterKey()` | `lib/crypto.ts` |
| Monitor in-process worker | `startMonitorWorker()` (dev, `MONITOR_WORKER_INPROCESS=true`) | `lib/monitor/worker.ts` |

`dispatch()` in one example:

```ts
const result = await prisma.$transaction(async (tx) => {
  const task = await tx.task.update({ where: { id }, data: { /* … */ } });
  return dispatch(workspace.id, {
    type: "task.assigned",
    title: `${actor.name ?? "Someone"} assigned you ${project.key}-${task.number}`,
    url: `/w/${workspace.slug}/projects/${project.key}/tasks/${task.number}`,
    actorId: actor.id,
    recipients: [assigneeId],               // only people who can see the task
    resource: { type: "task", id: task.id },
    scope: { projectId: project.id, taskId: task.id },
    data: { taskId: task.id, taskNumber: task.number, projectId: project.id },
  }, { tx });
});
await result.afterCommit();                 // realtime nudges after commit
```

## Area ownership

Routes are below `app/w/[workspaceSlug]/` unless they start with `/api`,
`/status`, `/f`, `/a` or `/ics`. "Writes" lists the models the area
owns; everything else is read-only for it.

### 1. tasks

- **Routes**: `projects/**` (list, board, task detail), `my-tasks/**`.
- **Actions / lib / components**: `app/actions/tasks.ts`, `app/actions/projects.ts`, `lib/tasks/`, `lib/projects/`, `components/tasks/`, `components/projects/`. Scheduled: `lib/scheduled/tasks.ts`.
- **Writes**: `Project` (incl. `teamId`, `cyclesEnabled`), `BoardColumn`, `Task` (except `cycleId`, which cycles sets), `TaskAssignee`, `TaskLabel`, `TaskComment`, `TaskActivity`, `TaskRecurrence`, `TaskOccurrence`, `TaskDependency`.
- **Emits**: `task.assigned`, `task.unassigned`, `task.due`, `task.overdue`, `task.commented`, `task.status_changed`, `task.unblocked`, `mention` (comments).
- **Notes**: recurring tasks, dependencies (cycle-free) and the repeat control live in the task editor. Team-scoped projects filter with `teamScopeFilter(await hiddenTeamIds(...))`. Labels are managed in settings (foundation); tasks only attach them. Task numbers: `nextWorkspaceSequence(tx, workspaceId, "task")`.

### 2. chat

- **Routes**: `chat/**`, `dm/**`.
- **Actions / lib / components**: `app/actions/chat.ts`, `lib/chat/`, `components/chat/`. Scheduled: `lib/scheduled/chat.ts`.
- **Writes**: `Channel`, `ChannelMember`, `Message`, `MessageReaction`, `MessageAttachment`.
- **Emits**: `mention`, `message.dm`, `thread.reply`.
- **Notes**: render `Message.origin = "notify"` (SYSTEM routing cards from `dispatch`) and `origin = "bridge:<id>"` (mirrored from Slack/Telegram/…) distinctly. Honour `Channel.teamId` with `lib/teamAccess`. Realtime: `message.created` on `channel:<id>` (ids only). Search messages through the existing `searchVector`.

### 3. docs-files

- **Routes**: `docs/**`, `files/**`.
- **Actions / lib / components**: `app/actions/docs.ts`, `app/actions/files.ts`, `lib/docs/`, `lib/files/` (the foundation `lib/files.ts` download check stays shared), `components/docs/`, `components/files/`. Scheduled: `lib/scheduled/docsFiles.ts`.
- **Writes**: `Doc` (incl. `verifiedUntil`, `verifiedById`), `DocRevision`, `FileObject` (incl. `currentVersion`), `FileVersion`.
- **Emits**: `mention` (in docs).
- **Notes**: knowledge templates for docs are stored by work-collaboration (`Template` kind `DOC`); docs only reads them for "New doc from template". Upload through `uploadWorkspaceFile`.

### 4. community

- **Routes**: `announcements/**`, `calendar/subscribe`; public `/ics/[token]` (calendar feeds).
- **Actions / lib / components**: `app/actions/community.ts`, `lib/community/`, `components/community/`. Scheduled: `lib/scheduled/community.ts`.
- **Writes**: `Announcement`, `CalendarFeedToken`.
- **Emits**: `announcement.published` (with a "Send to" scoped rule, scope `announcementId`).
- **Notes**: the ICS feed includes the user's meetings, shifts and task due dates by reading those tables. Members directory is people-relationships.

### 5. finance

- **Routes**: `finance/**`.
- **Actions / lib / components**: `app/actions/finance.ts`, `lib/finance/`, `components/finance/`. Scheduled: `lib/scheduled/finance.ts`.
- **Writes**: `FinanceCategory`, `LedgerEntry` (incl. `budgetId`), `Invoice`.
- **Emits**: `invoice.overdue`.
- **Notes**: ledger entries posted by ops-money carry `sourceType`/`sourceId` (unique); show them as linked, do not edit their source fields. Finance visibility: `canViewFinance`.

### 6. assistant

- **Routes**: `assistant/**`, `boardroom/**`, `settings/api-tokens/**`; `/api/mcp`, `/api/v1/**`.
- **Actions / lib / components**: `app/actions/assistant.ts`, `app/actions/boardroom.ts`, `app/actions/apiTokens.ts`, `lib/assistant/`, `lib/mcp/`, `lib/apiTokens/`, `components/assistant/`, `components/boardroom/`. Scheduled: `lib/scheduled/assistant.ts`.
- **Writes**: `AssistantConversation`, `AssistantMessage`, `AssistantMemory`, `AssistantSkill`, `ScheduledJob`, `BoardroomSession`, `BoardroomSeat`, `BoardroomTurn`, `ApiToken`.
- **Emits**: `digest.ready` (scoped rule `DIGEST` with the job id), `assistant.job.completed`, `boardroom.summary_ready` (scope `boardroomSessionId`).
- **Notes**: MCP tools (`sw_*`) read every area's tables directly with the caller's role and visibility, and never expose vault secrets, emergency contacts or other people's DMs. Write tools need confirmation. The messaging bot calls into `lib/assistant` as the linked user (integrations-messaging owns the transport).

### 7. integrations-messaging

- **Routes**: `settings/integrations/**`, `settings/messaging/**`, `settings/notifications/**` (destinations, workspace rules, delivery log, test send), `notifications/accounts/**` (link your accounts), `seo/**`; `/api/integrations/**` (Slack, Discord, Mattermost, Telegram, WhatsApp, Google and GitHub callbacks and webhooks).
- **Actions / lib / components**: `app/actions/integrations.ts`, `app/actions/messaging.ts`, `app/actions/notificationRouting.ts`, `app/actions/seo.ts`, `lib/integrations/`, `lib/messaging/`, `lib/seo/`, `components/integrations/`, `components/messaging/`, `components/notify/` (including the reusable `<DestinationPicker scopeType scopeId />`), and the provider adapters `lib/notify/adapters/{slack,discord,mattermost,telegram,whatsapp,webhook}.ts`. Scheduled: `lib/scheduled/integrations.ts`.
- **Writes**: `IntegrationConnection`, `OAuthState`, `GithubRepo`, `GithubEvent`, `SeoSite`, `SeoMetricDaily`, `SeoAudit`, `MessagingConnection`, `NotificationDestination`, `NotificationRule` (workspace rules; scoped rules go through `setScopedDestinations`), `NotificationRuleDestination`, `ExternalIdentityLink`, `LinkCode`, `BridgedChannel`, `BridgedMessage`, `InboundEvent`, `MessagingConversation`.
- **Emits**: `github.pr.opened`, `github.review.requested`, `github.ci.failed`, `github.release.published`, `github.issue.opened` (scope `githubRepoId`, `projectId`), `seo.report_ready`.
- **Notes**: replace a placeholder adapter by exporting a real `DestinationAdapter` from the same file; never edit `lib/notify/adapters/index.ts`. Webhook adapter: signed `X-SpaceWorks-Signature: v1=<hmac>` and an SSRF guard (`ALLOW_PRIVATE_WEBHOOK_TARGETS`). Telegram replaces the earlier plan: one `MessagingConnection` (provider `TELEGRAM`) per workspace, member links via `LinkCode` + `ExternalIdentityLink`. Members' DM channels unlock in `resolvePersonalChannels` as soon as a verified link exists.

### 8. monitor

- **Routes**: `services/**` (overview, monitors, incidents, maintenance, on-call, costs, status-page settings, `services/settings` for the workspace toggles), `settings/cloud-accounts/**`; public `/status/[workspaceSlug]/**` (page, `summary.json`, badges) and `/api/hb/[token]/**` (heartbeats).
- **Actions / lib / components**: `app/actions/services.ts`, `lib/monitor/` (incl. `worker.ts`, checks, SSRF-safe resolver, cloud adapters), `components/services/`. Scheduled: `lib/scheduled/monitor.ts`.
- **Writes**: `Monitor`, `MonitorCheck`, `MonitorRollup`, `HeartbeatPing`, `Incident` (incl. postmortem fields), `IncidentMonitor`, `IncidentUpdate`, `MaintenanceWindow`, `MaintenanceWindowMonitor`, `OnCallSchedule`, `EscalationPolicy`, `MonitorNetworkAllowlist`, `CloudConnection`, `CloudResource`, `CloudMetricSample`, `CostSnapshot`, `CostBudget`, `StatusPage`, `StatusPageComponent`; the workspace fields `membersCanAckIncidents`, `costsVisibleToMembers`, `monitorRetentionDays`.
- **Emits**: `monitor.*`, `heartbeat.missed`, `cert.expiring`, `domain.expiring`, `cloud.resource_unhealthy`, `cloud.alarm`, `cost.threshold_exceeded`, `checker.offline`, `incident.*`, `oncall.page`, `maintenance.*` — with `scope.monitorId` / `incidentId` / `cloudConnectionId` / `costBudgetId`, `dedupeKey`, `threadKey` (`incident:<id>`), and `useWorkspaceRules: monitor.useWorkspaceRules`.
- **Notes**: incident numbers `nextWorkspaceSequence(tx, ws, "incident")`. Gates: `canViewServices`, `canManageServices`, `canAckIncidents`, `canViewCosts`, `canManageCloudAccounts`; guests get 404. Heartbeat tokens: store only `sha256` + hint. Postmortem follow-up tasks: see cross-area writes.

### 9. people-relationships

- **Routes**: `members/**` (directory and profiles), `teams/**`, `rota/**`, `contacts/**` (contacts, organisations, sponsor pipeline), `onboarding/**` (checklist runs, "My onboarding"), `settings/onboarding/**` (templates).
- **Actions / lib / components**: `app/actions/people.ts`, `app/actions/teams.ts`, `app/actions/rota.ts`, `app/actions/contacts.ts`, `lib/people/`, `lib/teams/`, `lib/rota/`, `lib/contacts/`, `components/people/`, `components/teams/`, `components/rota/`, `components/contacts/`. Scheduled: `lib/scheduled/people.ts`.
- **Writes**: `Team`, `TeamMember`, `MemberProfile` (emergency contact via purpose `member-emergency`, views audited, gate `canViewEmergencyContact`), `MemberSkill`, `ChecklistTemplate`, `ChecklistRun`, `ChecklistRunItem`, `Availability`, `ShiftType`, `Shift`, `ShiftAssignment`, `ShiftSwapRequest`, `CertType`, `Certification`, `Organisation`, `Contact`, `ContactOrgRole`, `ContactInteraction`, `Deal`, `RecordLink` rows whose `fromType` is `contact` / `organisation`.
- **Emits**: `member.joined`, `team.member_added`, `onboarding.task_due`, `offboarding.started`, `availability.changed`, `certification.expiring`, `shift.*`, `contact.follow_up_due`, `deal.stage_changed`.
- **Notes**: owns the invitation-acceptance hook in `lib/invitations.ts` (start the onboarding run, emit `member.joined`). Offboarding reads vault grants/access logs, services, assets, access credentials, subscriptions and identity links to generate items (read-only). Team-scoped visibility helpers for others are already in `lib/teamAccess.ts`.

### 10. ops-money

- **Routes**: `catalogue/**`, `subscriptions/**`, `vault/**`, `assets/**`, `requests/**` (purchase requests, reimbursements, approvals inbox, budgets, approval policies), `forms/**`; public `/f/[publicSlug]` (public forms) and `/a/[tag]` (asset QR short link → sign in).
- **Actions / lib / components**: `app/actions/catalogue.ts`, `app/actions/subscriptions.ts`, `app/actions/vault.ts`, `app/actions/assets.ts`, `app/actions/requests.ts`, `app/actions/forms.ts`, `lib/catalogue/`, `lib/subscriptions/`, `lib/vault/`, `lib/assets/`, `lib/requests/`, `lib/approvals/` (the generic engine), `lib/forms/`, `components/catalogue/`, `components/vault/`, `components/assets/`, `components/requests/`, `components/forms/`; vault reveal route `/api/w/[workspaceSlug]/vault/items/[id]/reveal`. Scheduled: `lib/scheduled/opsMoney.ts`.
- **Writes**: `ServiceCatalogItem` (except `cachedStatus`), `ServiceLink`, `ServiceDependency`, `Subscription`, `VaultCollection`, `VaultItem`, `VaultItemVersion`, `VaultGrant`, `VaultAccessRequest`, `VaultAccessLog`, `Asset`, `AssetMaintenanceLog`, `AccessCredential`, `Budget`, `PurchaseRequest`, `Reimbursement`, `ApprovalPolicy`, `ApprovalRequest`, `ApprovalDecision`, `Form`, `FormSubmission`.
- **Emits**: `renewal.due` (scope `subscriptionId`, "Send to" on the subscription), `asset.*`, `form.submitted` (scope `formId`), `approval.requested`, `approval.decided`, `finance.approval.requested`, `finance.approval.decided`, `finance.reimbursement.paid`, `budget.threshold` (scope `budgetId`), `vault.access.requested`, `vault.item_revealed`, `vault.rotation_due`, `catalogue.gap`.
- **Notes**: the approvals engine (`requestApproval`, `decide`, per-subject hooks, no self-approval) is generic so other areas can use it once merged. Vault secrets never reach search, activity, notifications, logs or assistant tools; `VAULT_MASTER_KEY` is required to create items. Assets are internal records with maintenance notes; physical access holders are recorded separately.

### 11. work-collaboration

- **Routes**: `cycles/**`, `meetings/**` (incl. `meetings/decisions` log), `goals/**`, `polls/**`, `ideas/**`, `templates/**`, `changelog/**`; signing pages under `sign/**` (e-sign-lite).
- **Actions / lib / components**: `app/actions/cycles.ts`, `app/actions/meetings.ts`, `app/actions/goals.ts`, `app/actions/polls.ts`, `app/actions/ideas.ts`, `app/actions/templates.ts`, `app/actions/changelog.ts`, `lib/cycles/`, `lib/meetings/`, `lib/goals/`, `lib/polls/`, `lib/ideas/`, `lib/templates/`, `lib/changelog/`, `lib/signatures/`, matching `components/<folder>/`. Scheduled: `lib/scheduled/collaboration.ts`.
- **Writes**: `Cycle` and `Task.cycleId`, `Meeting`, `MeetingAttendee`, `AgendaItem`, `Decision`, `MeetingActionItem`, `Poll`, `PollOption`, `PollVote`, `PollBallotReceipt`, `Goal`, `KeyResult`, `Template`, `Idea`, `IdeaVote`, `ChangelogEntry`, `SignatureRequest`.
- **Emits**: `cycle.started`, `cycle.completed`, `meeting.agenda_reminder`, `meeting.summary_published` (scope `meetingId`, "Send to" on the meeting), `poll.opened`, `poll.closing_soon`, `poll.closed`, `signature.requested`, `goal.check_in_due`, plus `task.assigned` for action items.
- **Notes**: anonymous polls keep the voter only in `PollBallotReceipt`. Motions record their outcome as a `Decision`.

### 12. platform-shell

- **Routes**: home (`app/w/[workspaceSlug]/page.tsx`, `lib/dashboard.ts`), `search/**`, `notifications/**` (notification centre and `notifications/preferences` — the member's channel × category matrix, quiet hours, snooze, mutes), `activity/**`, `links/**`, `settings/export/**`, `settings/import/**`, `settings/retention/**`, `settings/audit/**`; super-admin `/admin/sso`, `/admin/backups`; PWA (`public/manifest.webmanifest`, service worker).
- **Actions / lib / components**: `app/actions/search.ts`, `app/actions/notificationPreferences.ts`, `app/actions/views.ts`, `app/actions/links.ts`, `app/actions/exports.ts`, `lib/search/query.ts` (the read side), `lib/shell/`, `components/command-palette/`, `components/notification-center/`, `components/saved-views/`, `components/importer/`. Scheduled: `lib/scheduled/shell.ts`.
- **Writes**: `NotificationPreference`, `NotificationUserSettings`, `NotificationMute`, `NotificationDigestItem` (`sentAt` when flushed), `Notification` read/archive state, `SavedView`, `Bookmark`, `LinkItem`, `ExportJob`, `ImportJob`, `RetentionPolicy`, `SsoProvider`, `BackupRun`; the workspace fields `legalHold`, `defaultLocale`.
- **Emits**: `export.ready`, `import.finished`, `security.new_login`, `digest.ready` for notification digests.
- **Notes**: the command palette searches `SearchDocument` (full text + trigram) with access filtering at query time (visibility, team via `lib/teamAccess`, project, channel membership). The digest flush sends one email/DM per user through `dispatch` or the email adapter.

### 13. app-reviews

| Routes | Actions / lib / components | Writes | Events |
| --- | --- | --- | --- |
| `app-reviews/**`; `/api/app-reviews/slack/events` | `app/actions/appReviews.ts`, `lib/appReviews/`, `components/appReviews/`, `lib/scheduled/appReviews.ts` | `AppStoreAccount`, `ReviewedApp`, `AppReview`, `AppReviewReplyAttempt`, `AppReviewSlackConfig`, `AppReviewSlackEvent`, `AppReviewSlackMember`; one `app_reviews` migration | `app_review.received`, `app_review.replied`, `app_review.reply_failed` |

This new area explicitly owns its appended schema and required shared hooks:
roles, nav entry, crypto purposes, notification catalogue/scope/rating matcher,
job registration and read-only assistant/API-scope registration. Members read,
triage and reply; admins manage credentials and routing. Its Create task action
may create `Task`, `TaskAssignee` and `TaskActivity` rows atomically with the
review link, using shared counters, task indexing and private-team checks.
Setup: [APP_REVIEWS.md](APP_REVIEWS.md). Area notes: [app-reviews](areas/app-reviews.md).

## Cross-area writes (the only exceptions)

| Writer | Writes | Contract |
| --- | --- | --- |
| work-collaboration | `Task` rows for meeting action items | `nextWorkspaceSequence(tx, ws, "task")`, `sourceMeetingId`, a `MeetingActionItem` row, then `dispatch("task.assigned")`. `projectId` may be null (shows in My tasks). |
| monitor | `Task` follow-ups from an incident postmortem | same as action items, with a `RecordLink` (`incident` → `task`). |
| monitor | `ServiceCatalogItem.cachedStatus` | worst-of linked monitors/cloud resources (`ServiceLink` MONITOR / CLOUD_RESOURCE). |
| ops-money | `LedgerEntry` from paid reimbursements and received purchases | `sourceType` `"reimbursement"` / `"purchase_request"`, `sourceId`, `budgetId`; unique per source, so retries are safe. |
| people-relationships | `lib/invitations.ts` acceptance hook | start onboarding, `member.joined`. |
| integrations-messaging | `Message` rows for inbound bridged messages | `origin = "bridge:<bridgedChannelId>"`, author = linked user or SYSTEM. |
| any area | `SearchDocument`, `ActivityEvent`, `RecordLink` rows for its own entities | through `lib/search/documents.ts`, `lib/activity.ts`, or direct `RecordLink` inserts with its own `fromType`. |
| any area | `NotificationRule` scoped to its own entity | only through `setScopedDestinations`. |

## Placeholder routes added by the platform extension

| Route | Min role + capability | Owner |
| --- | --- | --- |
| `teams` | GUEST | people-relationships |
| `polls`, `ideas`, `cycles`, `goals` | MEMBER + `canContribute` | work-collaboration |
| `meetings` | GUEST | work-collaboration |
| `forms` | MEMBER + `canContribute` | ops-money |
| `services` | MEMBER + `canViewServices` | monitor |
| `catalogue` | MEMBER + `canViewCatalogue` | ops-money |
| `vault` | MEMBER + `canUseVault` | ops-money |
| `contacts` | MEMBER + `canViewContacts` | people-relationships |
| `assets` | MEMBER + `canUseAssets` | ops-money |
| `requests` | MEMBER + `canSubmitRequests` | ops-money |
| `subscriptions` | MEMBER + `canViewSubscriptions` | ops-money |
| `rota` | MEMBER + `canUseRota` | people-relationships |
| `settings/notifications` | ADMIN + `canManageNotificationRouting` | integrations-messaging |
| `settings/messaging` | ADMIN + `canManageMessaging` | integrations-messaging |
| `settings/cloud-accounts` | ADMIN + `canManageCloudAccounts` | monitor |
| `settings/onboarding` | ADMIN + `canManageOnboarding` | people-relationships |
| `notifications/preferences` | GUEST | platform-shell |
| `notifications/accounts` | MEMBER + `canLinkExternalAccounts` | integrations-messaging |

The Phase 1 placeholders (announcements, members, personal feed settings,
projects, my-tasks, docs, files, chat, dm, finance, seo, assistant,
boardroom, settings/api-tokens, settings/integrations) belong to the areas
listed above.
