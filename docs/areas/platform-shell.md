# Platform shell

This area provides the member's daily overview, permission-filtered search and activity, personal notifications, saved views, links, portable exports, CSV link imports, platform retention, offline fallback and operator views.

## Routes and interaction

- `/w/[workspaceSlug]`: My day, assigned tasks with overdue words, upcoming shifts, meetings and events, community announcements via `lib/community/summary`, mentions, finance when visible, monitor state counts and a 260px activity rail at desktop widths. Quick creation calls the existing tasks and docs actions; events use the community editor.
- `/search`: PostgreSQL full-text and trigram matches grouped by type, result type filters and pagination. The palette supports Cmd/Ctrl+K, arrows, Enter, Escape, recent queries in per-user/per-workspace session storage, creation, navigation, switching workspace and theme. Only search terms are stored locally.
- `/activity`: a chronological, paginated feed using the same current-record access checks as search.
- `/notifications`: unread, mentions and all tabs, event-category filters, individual/all read state, archive and resource mute. Preferences include the category/channel matrix, included event names, linked messaging channels, digest frequency, quiet hours with starting weekdays and time zone, critical bypass, snooze and unmute.
- `/links`: title/tag filters, create/edit/remove, personal bookmarks and reusable views. URLs accept HTTP(S) without embedded credentials. Links open with an accessible new-tab label.
- `/settings/export`, `/settings/import`, `/settings/retention`: ADMIN and OWNER data controls. ADMIN exports are allowed; `canExportWorkspace` in `lib/roles.ts` says the same (see `docs/ROLES.md`). Export downloads repeat authorization and expire after seven days.
- `/admin/sso` and `/admin/backups`: instance operator plus fresh MFA. SSO secrets are encrypted with `sso-secrets`, never returned to a form. Backup posture shows reported successes, age and sizes, with locations and raw errors withheld.

The new workspace `template.tsx` hosts the palette, dropdown bell, navigation focus helper and offline registration without editing the shared layout or chrome. Its tools action re-resolves membership from the slug; it receives no trusted workspace ID from the browser. Pinned links now appear in the app sidebar; search and the dropdown bell remain in the toolbar. The existing sidebar bell remains the coordinator's direct link.

## Access and search contracts

`lib/search/query.ts` uses parameterised SQL for all user values. The static registry is a deny-by-default list of supported source types. Every result requires an active member, enabled user, active workspace, matching tenant and current role. Visibility metadata, private teams, project scope and channel membership apply before ranking or pagination. Current source rows are checked as well: stale index entries cannot expose archived projects, administrator-only docs, deleted messages, private conversations or private-team records. Unknown source types and vault content are excluded. Adding another searchable type requires an explicit access predicate and integration tests.

Activity applies the same registry before returning summaries. Private docs are checked even when old activity metadata says workspace-visible. Permissions apply to titles as well as bodies.

Notifications are scoped to workspace and recipient. Archive removes an item from counts and lists, and marks it read for compatibility with the shared sidebar count. Realtime events contain no notification text; the dropdown refetches through the authenticated action. Mutes are created only from the caller's own notification and require current access to the referenced resource. Personal preference rows take precedence over workspace defaults and catalogue defaults; DM choices require a verified linked account on an active connection. In-app remains enabled by the shared dispatcher contract.

## Reusable saved views

`saveView(slug, input)`, `deleteView(slug, id)` and `listSavedViews(actor, entityType)` provide generic, tenant-bound persistence. A view stores `{ filters, sort?, groupBy?, columns? }`, layout, owner, PRIVATE/TEAM/WORKSPACE sharing and pin state. Only the owner edits or removes it. Sharing requires contributor rights; TEAM writes require membership in that tenant's team. Private views remain owner/admin-visible. Query values are data, never SQL or executable code.

`components/saved-views/SavedViews` integrates into search and links, the lists owned here. Other areas can pass their validated current filters and implement their own query interpretation. Their pages were not modified.

## Background jobs and storage

`lib/scheduled/shell.ts` is already registered by the shared scheduler. Each tick processes an export, an import, one digest batch, expired export cleanup and configured platform retention. The standard outbox worker/internal scheduler endpoint drives it; disabling that worker requires an external scheduler as usual.

Export/import rows are claimed with row locks and `SKIP LOCKED`. Work and final state commit together, so an interrupted database transaction leaves the job queued. Requester access is checked again at execution. Imports also lock their workspace to serialize duplicate-URL checks across replicas. Export reads use a repeatable-read snapshot. Failures expose short operator-safe messages, never provider responses.

Exports use positive column lists, including explicit child-record joins. New schema columns cannot silently enter bundles. Credentials, MFA material, invitations, API tokens, OAuth accounts, vault records, emergency contacts, identity links, private conversations and storage keys are excluded. Public, unscoped channel messages are opt-in. File metadata and version metadata are included; binary objects are excluded. This is a portable data bundle, not a replacement for operator database/files backups. Limits: 100,000 records per entity and 50 MB JSON. JSON or a standards-compliant ZIP containing `workspace.json` is stored privately, outside FileObject, and can only be fetched through the ADMIN-authorized export route. The route sets no-store, attachment, sandbox and nosniff headers.

CSV supports RFC 4180 quotes, escaped quotes, commas, multiline cells, BOM and CRLF. Uploads use the shared private-storage helper, with a 1 MB / 1,000-row / 50-column limit. The browser previews mapped records, and the worker repeats parsing and validation. Preview is the default. A file with any invalid row creates no links. Existing URLs are skipped; imported links are indexed. Other areas' writers are intentionally not called from this area; their import adapters can reuse the parsing/mapping framework after their owners add an authorized writer.

Digests use the registered personal adapters and a generic count/link, so old private content is never repeated into a digest. Held items are locked during delivery; quiet hours and snooze are rechecked. Missing adapters retain pending items for the integrations build. External providers are at-least-once across an unexpected process failure during a provider request.

## Retention and legal hold

Platform policies cover notifications, completed import history, links, saved views and completed export history. Policies are optional and require a review dialog before enabling deletion. Cutoffs use elapsed UTC days. Purges and hold updates lock the workspace row; a hold prevents record deletion and expired-object cleanup. Download expiry still applies while a hold retains the object. Export history is only purged after its objects are removed.

Retention of another area's tables is outside this ownership row. Such an area must implement its own purge against the shared RetentionPolicy model and check/lock Workspace.legalHold before deleting; this area does not write task, chat, file, finance or monitor rows. No destructive adapter is silently registered for them.

## Offline, locale and accessibility

The existing manifest remains authoritative. `public/sww-sw.js` caches only the public offline HTML, its stylesheet, a font and an icon. It never stores workspace HTML, RSC payloads, authenticated files or API responses. Navigation uses the network with the public offline fallback on failure. API and RSC requests bypass handling. Cache upgrades remove only this worker's versioned caches.

`lib/shell/messages.ts` establishes stable keys and an English fallback for unsupported locales. Workspace.defaultLocale is ADMIN-editable. Shared navigation copy remains coordinator-owned. The existing skip link and main landmark are retained; palette dialogs trap/restore focus, combobox active descendants support keyboard selection, status text announces loading and counts, the navigation helper focuses main after route changes, and every new control has a visible label and a 44px target. New components add no motion.

## Coordinator integration

The [integration finish](integration-finish.md) connects instance OIDC sign-in and local MFA, moves pinned links into the sidebar, adds the admin/settings tabs and registers cross-area retention writers. The existing adapter still refuses account creation. Deployment owns backup evidence and restore drills; the admin page reports actual runs.

Outgoing webhooks use integrations-messaging destinations, signatures and delivery logs. The settings Webhooks shortcut opens that shared configuration.

OIDC API references: [Auth.js provider configuration](https://authjs.dev/reference/core/providers), [Auth.js OAuth configuration](https://authjs.dev/guides/configuring-oauth-providers), [adapter contract](https://authjs.dev/reference/nextjs/adapters).

## Local verification

Use the platform databases, Redis DB 0 and port 3250 from the task. The demo module is `scripts/seed/platform-shell.mjs`; it exports the standard async function and leaves the shared demo runner unchanged.

Required checks: lint, typecheck, unit suite, disposable PostgreSQL preparation/integration suite, production build, then removal of `.next`, plus both required repository terminology scans. The browser suite is `tests/e2e/platform-shell.spec.ts`; opt in with `PLATFORM_SHELL_E2E_PASSWORD` after seeding and `PLAYWRIGHT_PORT=3250`. Screenshots are ignored local artifacts. The macOS sandbox in this session denied Chromium's Mach bootstrap registration; no browser or mobile visual pass is claimed. Turbopack's FSEvent stream was also denied, so Webpack with polling was used for HTTP checks.

Git staging was attempted and denied when creating the worktree's `index.lock`. Changes remain uncommitted until repository metadata is writable. No push or merge was attempted.

Final session results: lint passed; typecheck passed; 34 unit test files passed (426 tests passed, 1 skipped); 24 integration files passed (171 tests passed); the default Turbopack production build passed. Both required terminology scans produced no matches, and the new/untracked files were scanned separately. Nine authenticated platform routes and an indexed search result passed HTTP checks. Three browser tests could not launch Chromium because of the sandbox restriction described above. `.next` was removed after verification.

Files outside the ownership row's explicit path list: `app/w/[workspaceSlug]/template.tsx` hosts the global tools without editing the shared layout; `app/actions/platformShell.ts` contains the area-owned super-admin OIDC settings mutation. The requested area notes, seed module and PWA assets are also new. No schema changes or dependency changes were made.
