# Architecture

How Space Works Workspace is put together, and the shared services every
feature should build on.

## Request flow

1. `proxy.ts` applies distributed rate limits (Server Actions, `/api/*`,
   Auth.js mutations) and adds a per-request CSP nonce and security headers to
   pages. It never authenticates.
2. Pages and route handlers authenticate: `requireAuth()` /
   `requireWorkspace(slug, minRole)` for pages, `getWorkspaceForAction(slug, minRole)`
   for Server Actions, `auth()` + `findWorkspaceForUser()` for route handlers.
3. Business rules live in `lib/`; Prisma is the only data access path.
4. `instrumentation.ts` validates the production environment at boot and
   starts timers only for Redis-free local development with `JOBS_INPROCESS=true`.
   Production worker and beat run separately through BullMQ; see
   [background jobs](areas/jobs-queue.md).

## Data model

`prisma/schema.prisma` covers every product area from the start:

| Area | Models |
| --- | --- |
| Auth and instance | `User`, `Account`, `Session`, `VerificationToken`, `MfaRecoveryCode`, `PasswordResetToken`, `EmailVerificationToken`, `InstanceSetting`, `OutboxMessage`, `OperationalHeartbeat`, `AuditEvent`, `Notification` |
| Tenancy | `Workspace`, `Membership`, `Invitation`, `ApiToken`, `WorkspaceCounter` |
| Work | `Project`, `BoardColumn`, `Task`, `TaskAssignee`, `Label`, `TaskLabel`, `TaskComment`, `TaskActivity` |
| Chat | `Channel`, `ChannelMember`, `Message`, `MessageReaction`, `MessageAttachment` |
| Knowledge | `Doc`, `DocRevision`, `FileObject` |
| Community | `Announcement` |
| Operations | `FinanceCategory`, `LedgerEntry`, `Invoice` |
| Assistant | `AssistantConversation`, `AssistantMessage`, `AssistantMemory`, `AssistantSkill`, `ScheduledJob` |
| Integrations | `IntegrationConnection`, `OAuthState`, `GithubRepo`, `GithubEvent` |
| SEO | `SeoSite`, `SeoMetricDaily`, `SeoAudit` |
| Boardroom | `BoardroomSession`, `BoardroomSeat`, `BoardroomTurn` |
| Foundations (extension) | `Team`, `TeamMember`, `ApprovalPolicy`, `ApprovalRequest`, `ApprovalDecision`, `RecordLink`, `SearchDocument`, `ActivityEvent`, `SavedView`, `Bookmark`, `LinkItem` |
| People | `MemberProfile`, `MemberSkill`, `ChecklistTemplate`, `ChecklistRun`, `ChecklistRunItem`, `Availability`, `ShiftType`, `Shift`, `ShiftAssignment`, `ShiftSwapRequest`, `CertType`, `Certification` |
| Operations (extension) | `ServiceCatalogItem`, `ServiceLink`, `ServiceDependency`, `Subscription`, `VaultCollection`, `VaultItem`, `VaultItemVersion`, `VaultGrant`, `VaultAccessRequest`, `VaultAccessLog`, `Asset`, `AssetMaintenanceLog`, `AccessCredential` |
| Relationships | `Organisation`, `Contact`, `ContactOrgRole`, `ContactInteraction`, `Deal` |
| Money (extension) | `Budget`, `PurchaseRequest`, `Reimbursement` |
| Work (extension) | `TaskRecurrence`, `TaskOccurrence`, `TaskDependency`, `Cycle`, `Form`, `FormSubmission`, `Goal`, `KeyResult`, `Template` |
| Collaboration | `Meeting`, `MeetingAttendee`, `AgendaItem`, `Decision`, `MeetingActionItem`, `Poll`, `PollOption`, `PollVote`, `PollBallotReceipt`, `CalendarFeedToken`, `SignatureRequest`, `Idea`, `IdeaVote`, `ChangelogEntry` |
| Platform | `FileVersion`, `ExportJob`, `ImportJob`, `BackupRun`, `RetentionPolicy`, `SsoProvider` |
| Services monitor | `Monitor`, `MonitorCheck`, `MonitorRollup`, `HeartbeatPing`, `Incident`, `IncidentMonitor`, `IncidentUpdate`, `MaintenanceWindow`, `MaintenanceWindowMonitor`, `OnCallSchedule`, `EscalationPolicy`, `MonitorNetworkAllowlist`, `CloudConnection`, `CloudResource`, `CloudMetricSample`, `CostSnapshot`, `CostBudget`, `StatusPage`, `StatusPageComponent` |
| Messaging and routing | `MessagingConnection`, `NotificationDestination`, `NotificationRule`, `NotificationRuleDestination`, `NotificationPreference`, `NotificationUserSettings`, `NotificationMute`, `NotificationEventRecord`, `NotificationDelivery`, `NotificationDigestItem`, `ExternalIdentityLink`, `LinkCode`, `BridgedChannel`, `BridgedMessage`, `InboundEvent`, `MessagingConversation` |

Who builds and owns each model, route and helper is in
[ROADMAP-BUILD.md](ROADMAP-BUILD.md).

Notes:

- Deleting a workspace cascades to all of its rows. Deleting a user removes
  their memberships and personal rows and sets authored content to `null`.
- Per-workspace numbers (task `number`, invoice `number`) come from
  `nextWorkspaceSequence(tx, workspaceId, "task" | "invoice")`.
- Money is an integer in minor units (`amountMinor`, `totalMinor`) plus an
  ISO currency code.
- Platform extension conventions: tenant roots cascade with their
  workspace and personal rows with their user; `createdById`, `ownerId`,
  `teamId` and similar actor/owner columns are plain ids (resolve names by
  lookup, show "Former member" when gone). Encrypted columns (`*Enc`) are
  `lib/crypto.ts` strings with a dedicated purpose; the vault uses envelope
  encryption under `VAULT_MASTER_KEY`. `Channel.teamId` / `Project.teamId`
  scope records to a team (private teams hide them, see `lib/teamAccess.ts`).
  `Message.origin` marks routing cards (`"notify"`) and bridged messages
  (`"bridge:<id>"`). `TelegramLink` was replaced by the generic
  `ExternalIdentityLink` + `LinkCode`.
- Global search across areas: `SearchDocument` has a generated
  `searchVector` (title A, body B) and a trigram index on `title`
  (`pg_trgm`), queried with `$queryRaw` like the per-table vectors below.
- Full-text search: `Task`, `Message` and `Doc` have a generated
  `searchVector tsvector` column (config `simple`) with a GIN index. Prisma
  maps it as `Unsupported`, so query it with raw SQL, always filtered by
  workspace:

  ```ts
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Message"
    WHERE "workspaceId" = ${workspaceId} AND "deletedAt" IS NULL
      AND "searchVector" @@ websearch_to_tsquery('simple', ${query})
    ORDER BY ts_rank("searchVector", websearch_to_tsquery('simple', ${query})) DESC
    LIMIT 50`;
  ```

## Shared services

### Permissions — `lib/permissions.ts`, `lib/roles.ts`

```ts
requireAuth(): Promise<SessionUser>                               // redirects to /login
requireWorkspace(slug, minRole = "GUEST"): Promise<{ user, workspace, membership }>  // notFound() otherwise
getWorkspaceForAction(slug, minRole = "GUEST"): Promise<WorkspaceContext | null>     // for Server Actions
findWorkspaceForUser(slug, userId): Promise<{ workspace, membership } | null>         // for route handlers
requireSuperAdmin() / requireSuperAdminMfa()
// lib/roles.ts (pure, client-safe)
hasRoleAtLeast(role, min); canContribute(m); canManageMembers(m); canManageLabels(m);
canManageChannels(m); canManageFinance(m); canViewFinance(m, workspace);
canManageApiTokens(m); canManageIntegrations(m); canViewAuditLog(m); canManageWorkspace(m);
canDeleteWorkspace(m); canTransferOwnership(m); assignableRoles(actor); canActOnMember(actor, targetRole)
// lib/tasks/capabilities.ts (pure): per-task rights, shared by services and DTOs
canPerformTaskAction("edit" | "claim" | "unclaim" | "contribute", { role, userId, restrictTaskEdits, projectOwnerId, creatorId, assigneeIds })
taskCapabilities(input) // { canEdit, canClaim, canUnclaim, isAssignedToMe }
// lib/tasks/service/helpers.ts: loadEditableTask(actor, taskId, { action, allowArchived? }) gates every task mutation
```

Task assignment (`lib/tasks/service/assignments.ts`) locks the `Task` row with
`SELECT ... FOR UPDATE`, re-reads the assignees in the transaction and decides
permission from that fresh set, so concurrent claims cannot both win. See
[tasks](areas/tasks.md).

### Realtime — `lib/realtime.ts`, `components/realtime/useRealtime.ts`

```ts
publish(workspaceId: string, channel: string, event: { type: string; data?: Record<string, string|number|boolean|null>; audience?: string[]; actorId?: string|null }): Promise<void>
publishToUser(workspaceId: string, userId: string, event: { type; data?; actorId? }): Promise<void>
subscribe(workspaceId: string, handler: (event: RealtimeEvent) => void): Promise<() => void>
// browser
useRealtime(workspaceSlug: string, onEvent: (event: RealtimeEvent) => void): void
```

- Transport: Redis pub/sub on `sww:rt:<workspaceId>`; in-process EventEmitter
  when `REDIS_URL` is unset. Publishing never throws.
- SSE endpoint: `GET /api/realtime/[workspaceSlug]` (members only, 404
  otherwise, 25 s heartbeat, reconnect every 10 minutes so revoked access
  ends promptly).
- Channel names: `"workspace"`, `"channel:<id>"`, `"project:<id>"`,
  `"task:<id>"`, `"doc:<id>"`, `"user:<id>"`. `user:` channels and `audience`
  lists are filtered per connection (`isEventVisibleTo`).
- Events carry ids and kinds, never content. Clients refetch.

### Storage — `lib/storage/index.ts`, `lib/storage/policy.ts`

```ts
uploadWorkspaceFile({ workspaceId, uploadedById, file: File, folder?, docId?, taskId?, allowedTypes?, maxBytes?, client? })
  : Promise<{ ok: true; file: FileObject } | { ok: false; error: string }>
fileUrl(fileId, { download? }): string          // "/api/files/<id>"
fileResponse(file, { download? }): Promise<Response>
putObject(key, body, contentType) / getObject(key) / deleteObjects(keys)
checkUpload({ size, type }, maxBytes?) / sanitizeFilename(name) / buildStorageKey(workspaceId, filename)
```

Keys are `workspaces/<workspaceId>/files/<uuid>/<name>`. Images are decoded
with sharp before storage. Downloads go through `GET /api/files/[id]`
(`lib/files.ts#findDownloadableFile`: active membership, admin-only docs,
finance receipts). Inline display only for raster images and PDFs, always
with `nosniff` and a sandboxing CSP. Without `S3_BUCKET` in development,
objects are written to `.data/storage`.

### Notifications — `lib/notifications.ts`

```ts
createNotifications(inputs: NotificationInput[], { client?, excludeUserId? }): Promise<number>
createNotification(input, options)
announceNotifications(rows)        // call after committing when you passed a transaction client
listNotifications(userId, { workspaceId?, unreadOnly?, take? })
countUnreadNotifications(userId, workspaceId?)
markNotificationsRead(userId, ids?)
// NotificationInput = { userId, workspaceId?, kind, title, body?, url? (app-relative) }
```

### Notification routing — `lib/notify`

```ts
dispatch(workspaceId, event: NotificationEvent<T>, { tx?, onlyDestinationIds?, test?, now? }): Promise<DispatchResult>
sendTest(workspaceId, destinationId, actorId)
setScopedDestinations(client, { workspaceId, scopeType, scopeId, destinationIds, actorId, eventTypes? })   // "Send to" picker data
getScopedDestinationIds(workspaceId, scopeType, scopeId) / listPickableDestinations(workspaceId, role)
EVENT_CATALOG / EventPayloads / NOTIFY_CATEGORIES (lib/notify/events.ts, client-safe)
```

- Every notification goes through `dispatch`. The event `type` must be in
  the catalogue and `data` matches its payload type. Broadcast events are
  routed by enabled rules (`eventTypes` exact / `area.*` / `*`, minimum
  severity, filters, scope): workspace rules unless `useWorkspaceRules:
  false`, plus the entity's scoped rule when `scope` carries its id
  (`SCOPE_KEYS`). Personal events go to `recipients` minus the actor who are
  active members at the catalogue's minimum role and have not muted the
  resource: always in-app, plus their preferred channels (member row →
  workspace default → catalogue default; DM channels need a verified
  `ExternalIdentityLink`; guests get in-app and email only).
- Quiet hours (rule or member), snooze and digests delay or hold
  non-critical deliveries; critical events bypass when allowed.
  `dedupeKey` drops repeats per target inside the rule window (personal:
  `dedupeWindowSec`, default 300 s); `reminderOf` bypasses dedupe;
  `threadKey` lets adapters reply in thread.
- In-app notifications (`Notification`, with `eventId`) and `IN_APP_USERS`
  destinations are written inline. Every other delivery is a
  `NotificationDelivery` plus an outbox row of kind `notify.deliver`; the
  outbox worker calls `processNotifyDelivery`, which renders a
  `RenderedMessage` and calls the adapter registered in
  `lib/notify/adapters/index.ts` (built in: email via `enqueueEmail`,
  workspace channel SYSTEM message; Slack, Discord, Mattermost, Telegram,
  WhatsApp and webhook are "not configured" placeholders replaced file by
  file). Retries back off 30 s → 6 h for six attempts; a shared destination
  that fails for good turns `ERROR` and admins get one
  `destination.failing` alert a day.
- With `{ tx }` the event commits with the caller's change; call
  `result.afterCommit()` after the transaction for realtime nudges.

### Shared extension hooks

```ts
indexSearchDocument(input, client?) / removeSearchDocument(entityType, entityId, client?)   // lib/search/documents.ts
recordActivity(input, client?)                                                                // lib/activity.ts
userTeamIds(workspaceId, userId) / hiddenTeamIds(workspaceId, member) / teamScopeFilter(hidden) // lib/teamAccess.ts
run(now)  // lib/scheduled/<area>.ts — called about once a minute by the outbox tick (idempotent)
sealEnvelope(masterKey, plaintext) / openEnvelope(masterKey, sealed) / vaultMasterKey()       // lib/crypto.ts
```

### Audit — `lib/audit.ts`

```ts
recordAuditEvent({ action, workspaceId?, actorId?, actorApiTokenId?, targetType?, targetId?, metadata?, client?, ip? })
listAuditEvents(workspaceId, { take?, cursor? })
```

Actions are dotted verbs (`member.role_changed`, `task.deleted`). Metadata is
small scalars only; never secrets, tokens or message bodies.

### Email — `lib/outbox.ts`, `lib/email/templates.ts`

```ts
enqueueEmail(client, { to, subject, html, text })        // any pre-rendered email (no bearer links)
enqueueInviteEmail(client, { to, workspaceName, inviterName, role, inviteUrl, expiresAt })
enqueuePasswordReset(client, { to, resetUrl, expiresAt })
enqueueEmailVerification(client, { to, verificationUrl, expiresAt })
renderNotificationEmail({ title, bodyHtml, actionUrl?, actionLabel? })   // brand layout for digests
```

Delivery: in-process worker every minute plus `POST /api/internal/outbox`
(`Authorization: Bearer $CRON_SECRET`). Capability emails are deleted after
delivery or terminal failure.

### Other helpers

- `lib/counters.ts`: `nextWorkspaceSequence(client, workspaceId, name)`.
- `lib/workspaces.ts`: `createWorkspaceWithDefaults`, `createDefaultBoardColumns(tx, projectId)`,
  `joinDefaultChannels(tx, workspaceId, userId)`, `listUserWorkspaces(userId)`.
- `lib/nav.ts`: the single sidebar config (`NAV_GROUPS`, `navForMember`).
- `lib/instanceSettings.ts`: `getAssistantSettings()` → `{ apiKey, model }`,
  `getEmailSettings()`, `getGoogleSsoSettings()`, `setInstanceSettings()`.
- `lib/integrationSecrets.ts`: `encryptIntegrationToken`, `decryptIntegrationToken`.
- `lib/crypto.ts`: `randomToken`, `sha256Hex`, `safeEqual`, `encryptSecret`, `decryptSecret`.
- `lib/rateLimit.ts` / `lib/actionRateLimit.ts`: buckets include `message`,
  `assistant`, `upload`, `search`, `apiRead`, `apiWrite`, `webhook`.
- `lib/format/datetime.ts`, `lib/format/money.ts`, `lib/slug.ts`, `lib/labels.ts`.
- `lib/actionResult.ts`, `lib/validation.ts`: action return shape and shared Zod schemas.

## Routes

| Route | Access |
| --- | --- |
| `/setup` | Only while the instance has no users |
| `/login`, `/forgot-password`, `/reset-password/[token]`, `/invite/[token]` | Public |
| `/` | Redirects: setup → login → last workspace → "no workspace yet" |
| `/w/[workspaceSlug]/…` | Members (per-page minimum role) |
| `/account` | Signed in |
| `/admin/…` | Super-admin + fresh TOTP (`/admin-mfa`) |
| `/api/health` | Public liveness |
| `/api/health/db` | `Bearer $HEALTHCHECK_SECRET` |
| `/api/internal/outbox` | `Bearer $CRON_SECRET` (POST) |
| `/api/files/[id]` | Members of the file's workspace |
| `/api/realtime/[workspaceSlug]` | Members (SSE) |
| `/api/account/export` | Signed in, own data only |

## Feature area index

The workspace navigation in `lib/nav.ts` is role-aware; every page and action independently checks access. These area guides describe the implemented services, routes and operational limits.

- [tasks](areas/tasks.md): Projects, kanban boards, recurring tasks, dependencies, cycles and personal tasks.
- [chat](areas/chat.md): Channels, direct messages, threads, reactions, pins and live updates.
- [docs-files](areas/docs-files.md): Nested rich-text docs, revisions, verification, private files and versions.
- [community](areas/community.md): Announcements and private personal feeds for internal meetings, shifts and task due dates.
- [finance](areas/finance.md): Community kitty, invoices and finance categories.
- [assistant](areas/assistant.md): Assistant conversations, workspace tools, memory, skills, scheduled digests, boardroom, MCP and scoped machine APIs.
- [integrations-messaging](areas/integrations-messaging.md): Google, GitHub, SEO, messaging connections, account linking, channel bridges and signed webhooks.
- [monitor](areas/monitor.md): Service checks, incidents, maintenance, on-call, public status pages, cloud inventory and costs.
- [people-relationships](areas/people-relationships.md): Member profiles, teams, onboarding, certifications, availability, rota, contacts, organisations and pipeline.
- [ops-money](areas/ops-money.md): Service catalogue, subscriptions, encrypted vault, internal asset and physical access registers, budgets, purchases, reimbursements, approvals and forms.
- [work-collaboration](areas/work-collaboration.md): Meetings, decisions, goals, key results, polls, ideas, templates, changelog and sign-offs.
- [platform-shell](areas/platform-shell.md): My day, global search, activity, pinned links, command palette, notification centre, preferences, exports, imports, legal hold and retention.
- [app-reviews](areas/app-reviews.md): App-store review inbox, replies, triage, insights, task links and notification routing.

- [Integration finish](areas/integration-finish.md): OIDC/MFA, navigation, cross-area panels, retention, search and verification.

Public entry points include opted-in status pages, public forms, asset sign-in redirects, hashed personal feed capabilities, heartbeat capabilities and authenticated integration webhooks. Internal routes require an active session and tenant membership.

## Identity and retention integration

`lib/auth.ts` loads enabled instance OIDC providers from `lib/shell/oidc.ts`. The sign-in callback requires an existing enabled user with active membership, a verified provider email, an allowed domain and a stable subject. The adapter refuses account creation and does not retain provider tokens. A user with MFA receives a five-minute signed challenge with no authenticated session user until TOTP or a recovery code succeeds. Session-version changes and disabled accounts invalidate both challenges and sessions.

`lib/shell/retention.ts` locks the workspace row before invoking registered writers. Legal hold stops all writers. Audit has no default purge. Inbound events default to 14 days and completed tenant outbox jobs to the instance period (30 days by default); pending work remains. Monitor raw checks retain at least `monitorRetentionDays`, and longer policies take precedence. Monitor summary and metric cleanup uses the same workspace lock. Unscoped legacy email jobs are conservatively retained while any workspace has a legal hold.

Global search uses `indexSearchDocument` on mutations and `lib/search/query.ts` for live source-record permission checks. An index row alone never authorises access. Private contacts remain owner/admin searchable; private chats and vault contents are excluded. App reviews require MEMBER, and team/project/channel restrictions are evaluated again on reads.
