# Integrations and messaging

Owns notification routing, messaging connections and transports, connected accounts, Google, GitHub and SEO. Setup: [INTEGRATIONS.md](../INTEGRATIONS.md).

## Routes and access

- Settings → Notifications: ADMIN destination CRUD, tests, workspace rules and the latest 100 deliveries with retry. Credentials never enter page props; blank secret fields retain encrypted values.
- Settings → Email sending (ADMIN): per-workspace SMTP (host, port, TLS, username, write-only password shown as "Saved", from, reply-to, enable). "Verify connection" (15 s timeout) and "Send test email" (to the current admin) run against the saved settings; hosts pass the monitor SSRF guard unless `MONITOR_ALLOW_PRIVATE_TARGETS=true`. The password is encrypted (`workspace-smtp`) and never in page props. Saving invalidates the cached transport.
- Settings → Messaging: ADMIN bot CRUD, verification and public, non-team channel bridges. One Telegram bot connection per workspace. WhatsApp has no channel bridges.
- Notifications → Connected accounts: MEMBER creates a single-use ten-minute capability or unlinks their own identity. Only hashes are stored, including in the inbound queue. WhatsApp linking records opt-in; unlink withdraws it.
- Settings → Integrations: ADMIN Google OAuth and GitHub App connections. Gmail, Calendar and Drive require a Google connection owned by the current admin. Search Console reports are shared with workspace admins.
- SEO: ADMIN sites, daily charts and equivalent data tables, top queries/pages, URL inspection, sitemap operations and HTML audits.

Every page resolves the workspace independently. Actions resolve the slug server-side, check capabilities, rate limit, validate, constrain foreign keys to the workspace and audit. Queries never accept a client-supplied tenant id.

## Exports for other areas

`components/notify/DestinationPicker.tsx` exports the controlled `DestinationPicker` and `PickableDestination` type. It takes `scopeType`, `scopeId`, `destinations`, `value`, `onChange`. The owning Server Component calls `listPickableDestinations(workspace.id, membership.role)` and `getScopedDestinationIds` from `lib/notify/scopedRules.ts`. The owning action must validate entity visibility, intersect submitted ids with `listPickableDestinations` for that role, then call `setScopedDestinations(tx, { workspaceId, scopeType, scopeId, destinationIds, actorId })` in its transaction. The picker never grants access to a resource or destination.

`components/integrations/GithubPullRequests.tsx` exports an async Server Component taking `workspaceSlug` and `projectId`. It checks workspace and private-team project visibility and lists open issues and pull requests for linked repositories. Tasks files are unchanged. Errors and empty repositories have readable states.

`lib/integrations/assistant.ts` exports `registerMessagingAssistantRunner(runner)` and `MessagingAssistantRunner`. The assistant area must register its runner at process startup; the runner accepts `{ workspaceId, userId, text, conversationId? }` and returns `{ text, conversationId }`. It must enforce its usual tool permissions and confirmation policy. This checkout has no `lib/assistant` runtime, so the transport returns an explicit unavailable message until registration. The bridge checks active membership, rate limits and conversation ownership before and after calling the runner. It stores external conversation mappings only after ownership validation. Replies containing assistant context are private (Discord ephemeral, other platforms DM).

## Delivery and scheduled work

`lib/email/workspaceTransport.ts` exports `getEmailTransportFor(workspaceId | null)`, `getFromFor(workspaceId | null)` (`{ from, replyTo? }`), `invalidateWorkspaceTransport(id)`, `loadWorkspaceSmtp`, `createSmtpTransport`. Enabled and decryptable workspace SMTP gives a pooled transport (cached on globalThis, keyed by `updatedAt`); anything else uses the instance transport. `sendRenderedEmail(to, email, messageId?, workspaceId?)` and the outbox pass the payload `workspaceId` for workspace-scoped kinds (`email`, `analytics.email`, `documents.email`); invite, reset and verification mail always stays on the instance transport.

Each destination (and each member and personal channel) has an outbound token bucket (`lib/notify/rateLimit.ts`, Redis Lua or memory): per minute Telegram 20, WhatsApp 30, Discord 25, Slack 50, Mattermost 60, webhook 60, email 120. Over the limit the delivery is rescheduled without using an attempt. When a destination's health first flips to ERROR, admins get one `system.destination_failed` notification (`{ destinationId, channel, error }`, error redacted and shortened); further failures while in ERROR do not alert again.

All notifications use `dispatch` / `sendTest` and the existing `notify.deliver` outbox handler. Provider adapters implement Slack Block Kit, Discord embeds with no allowed mentions, Mattermost escaping, Telegram HTML, WhatsApp service-window/template selection, and timestamped HMAC webhooks. Retry-After feeds the existing bounded retry machinery. HTTP uses a timeout, bounded reads and manual redirects. Errors exclude provider response text, URLs and tokens.

Signed inbound requests store normalised `InboundEvent` rows with a unique provider/connection/event key and acknowledge before processing. The existing outbox scheduler calls `lib/scheduled/integrations.ts`, which drains this durable inbound queue, mirrors outbound messages, dispatches GitHub feed events, issues reminders and syncs Search Console. No new outbox kind is used because the shared registry is coordinator-owned. Inbound leases recover after five minutes; processing stops after six failed attempts. Provider sends are at least once: process death after a provider accepts a message can cause a repeat. Inbound events expire after 14 days; expired link codes and OAuth state are purged.

Bridges write only public non-team channels, preserve linked authors or use SYSTEM, record `BridgedMessage` pairs, and exclude messages with `Message.origin` on outbound sends. Bot echoes are ignored. Discord `/post` slash interactions bridge text inbound; ordinary Discord messages require a separate optional gateway. Attachments and edit/delete mirroring are not implemented in this area task's basic text bridge.

Reminder intervals repeat the latest warning/critical event in a thread until superseded by a newer original event, for at most seven days. Quiet hours and critical bypass apply. Rule disabling or destination removal stops reminders. Producers must send recovery/status updates with the same thread key. Events without a thread key do not repeat.

Search Console sync imports site totals, query rows and page rows separately, initially 30 complete reporting days and then the latest seven days, allowing a three-day publication lag. CTR is clicks/impressions and position is weighted by impressions. API top-row limits and anonymised queries mean query/page sums may differ from site totals. Daily sync uses a compare-and-set lease; a failed daily pass retries the next day, or an admin can sync immediately.

## Constraints and hand-off

No schema, shared scheduler registry, navigation or task-area changes. Two existing notification test files were updated because they asserted that provider adapters were placeholders. Added exact dependency `undici@7.30.1` for DNS validation at socket connection time (Node 22 compatible). Demo module: `scripts/seed/integrations-messaging.mjs` exports `seedIntegrationsMessaging` and creates only safe local routing and synthetic SEO rows; it stores no credentials and sends nothing.

The shared notification event envelope and matcher have no rating field or rating predicate. Rating filters cannot be implemented truthfully without a coordinator-owned event/matcher change. Project, monitor and tag filters work. The assistant runner registration is the other required cross-area integration.

User-supplied URLs reject private addresses by default, refuse credentials and unexpected ports, resolve all DNS answers, and never follow redirects. Self-hosters can enable `ALLOW_PRIVATE_WEBHOOK_TARGETS=true`. Guarded requests use a fresh Undici agent that validates every DNS answer at socket connection time and connects to an approved address, preventing DNS rebinding.

## Verification — 19 October 2026

- Applied both existing migrations to sww_integrations and sww_integrations_test; demo seeding passed.
- npm run lint: passed. npm run typecheck: passed with a 3 GB Node heap allowance for the generated Prisma types.
- npm run test:unit -- --maxWorkers=1: 371 passed, one existing Redis-gated test skipped (TEST_REDIS_URL unset).
- npm run test:integration: 119 passed, including 20 integrations/messaging database tests. Provider fetches are mocked.
- npm run build: passed with Next.js 16.4.2. Verified generated .next output removed afterwards.
- Both required branding greps and an additional scan of the new files printed nothing; git diff --check passed.
- Browser QA at 375px and keyboard interaction remains unverified: Chromium launch is denied by the sandbox's Mach port policy and the browser connector has no available browser.
- Git commits are blocked by sandbox denial when creating the worktree's Git index.lock. Existing commits are retained; feature edits remain in the working tree.
