# Workspace production audit — 29 October 2026

## Scope and release decision

Audited the modern, initially clean `SpaceWorks-Workspace-dev` checkout on `dev`,
base revision `018c42b`; changes are on local branch
`fix/production-audit-2026-10-29`. This report covers Workspace only. Inventory, Machines
and Bookings have separate reviewers and release decisions.

**Release decision: verification incomplete; do not treat this audit as production
certification.** Confirm the remaining packaged deployment and recovery gates
before accepting production traffic. No production database, deployment or main
merge was used. Publication is through an audit feature PR into dev, with merge
authorized only after CI and final acceptance pass. No application environment
file was inspected or printed.

The sibling `SpaceWorks-Workspace` directory is a different, legacy Loop checkout:
its README describes Python 3.12, Next.js 15 and the Hermes agent; `main` points at
`a704eab` and has numerous pre-existing untracked files. It was inspected read-only
and was not modified. It must not be mistaken for the audited modern application.

## Fixed findings

### High: queued personal notifications could outlive access revocation

Reproduction: queue an administrator-only `it.review_due` notification, then demote
the recipient to GUEST or disable their account before the worker routes it.
Previously `processNotifyDelivery` checked only ACTIVE membership. Archiving the
workspace also did not stop the external delivery. Dispatch and selector resolution
also included disabled accounts with ACTIVE memberships.

Fix: dispatch and selectors exclude disabled users and archived workspaces. A
shared delivery guard checks current membership, account state, workspace state
and the event catalogue's minimum role before routing. Removed, cancelled, failed
or unknown delivery sources fail closed.

### High: routing mail to the outbox lost the recipient authorization boundary

Reproduction: route an allowed notification to email, then suspend/remove/demote
the recipient, disable the account, archive the workspace or change the email
address before SMTP delivery. The previous generic email payload retained only
the rendered message and old address; SMTP did not recheck authorization.

Fix: notification and digest email payloads retain their source identifiers. The
outbox rechecks the current recipient and address immediately before SMTP. Disabled
broadcast destinations and removed sources are rejected too. Ordinary transactional
mail and explicit external broadcast addresses retain their existing semantics.
Digest emails use their actual digest source, rather than a notification delivery
row, preserving normal digest delivery.

Independent follow-up review found that EMAIL destinations using role, team or
user selectors still lost recipient authorization between routing and SMTP: the
destination branch checked only whether the destination remained enabled.
Reproduction: route mail to a `{ roles: ["ADMIN"] }` destination, then demote or
disable the selected administrator before SMTP. The queued email still sent.
The shared email policy now checks current destination type/configuration and
performs one recipient-filtered membership lookup at SMTP, sharing the same
selector rules as routing. It does not expand every selected member again for
each queued address. Current explicit static `to` entries remain deliberate
external recipients, including addresses that also matched a revoked member.
Removed static addresses and destinations changed away from EMAIL fail closed.

The new 24-case PostgreSQL regression suite demonstrated 12 failing cases before
the fix and exercises allowed role/team/user recipients, membership and email
changes, team departure, selector/config changes, destination removal/type changes,
static overlap and external addresses. Targeted final results appear below.

No schema migration is required: these identifiers are optional JSON payload fields.
Existing queued generic email rows predate these identifiers and cannot benefit
from the new source check. Before rollout, review/drain or deliberately discard
stale notification emails under the existing outbox operating procedure.

## Coverage and evidence

| Boundary/flow | Review evidence |
| --- | --- |
| Invite-only authentication and MFA | Reviewed `lib/auth.ts`, session-version invalidation, enabled-user lookup, verified Google linking, OIDC member checks and five-minute pending SSO MFA; pending MFA has no authenticated user. |
| Tenant and role checks | Reviewed `lib/permissions.ts`, `lib/roles.ts`, `lib/teamAccess.ts`, direct page guards and action patterns; archived, absent and suspended workspace lookups fail closed. |
| Last-owner invariant and concurrent counters | Reviewed transactional owner row locks in `lib/membership.ts` and concurrency cases in `tests/integration/membership.db.test.ts`. |
| REST, MCP and assistant | Reviewed per-token authentication/scopes/rate limits, common tool authorization and record filters; MCP uses stateless bounded requests. |
| Split frontend gateway | Reviewed shared-secret peer checks, server-side registry, body limits, origin validation, safe view field filtering and cookie forwarding. |
| Files and private records | Reviewed tenant download lookup, disabled-member denial, document/team/channel/finance/request-specific visibility, private storage policy and image validation. Live Silo verification is recorded below. |
| Outbound integration URLs | Reviewed URL restrictions and DNS/socket-time SSRF checks. IPv6 parsing expands mapped hexadecimal/IPv4 forms and rejects loopback/private/link-local ranges. |
| Browser security and abuse controls | Reviewed nonce CSP, security headers, explicitly trusted IP headers and production Redis fail-closed rate limits. |
| Email and notification lifecycle | Traced request-side SQL outbox insertion, beat reconciliation, BullMQ worker claims, adapter dispatch, retry/dead-letter handling and actual SMTP handoff. Added revocation regressions. |
| Scheduled work and operations | Reviewed separate production worker/beat, health endpoints, bounded queue retention, graceful shutdown and redacted job errors. |
| Product flows | Existing unit/integration suites exercise tasks, chat, docs/files, finance, people, approvals, assistant, calendar, secrets, analytics and other operating areas; exact completed gates appear below. |

These are code-review and automated-test boundaries, not a claim that every
external provider or every UI state was manually exercised.

## Local installer and background architecture

The existing one-line Linux VPS installer is:

```sh
curl -fsSL https://raw.githubusercontent.com/SpaceWorks-Labs/SpaceWorks-Workspace/main/install.sh | bash
```

It already provisions PostgreSQL 16, Redis 7, private Silo storage, Caddy HTTPS,
migrations and separate BullMQ worker/beat services. `docker-compose.yml` supplies
loopback-only local PostgreSQL/Redis/Silo/Mailpit; `compose.production.yml` supplies
the production roles. Existing scripts cover guided setup, backups, restoration,
updates and health checks. The public installer follows `main`: this audit's
unreleased working-tree changes are not automatically included in that command.

Per user direction, retain BullMQ and the Events-style architecture. Requests
persist notification and email work; external notification adapters and SMTP run
in workers. In-app persistence and realtime nudges occur after commit. No Python
Celery migration was introduced. Network delivery has at-least-once semantics:
SMTP acceptance followed by a crash before the SQL completion write may duplicate
a message. The existing operational documentation explicitly records this limit.

## Verification

The final Linux quality run used Ubuntu Noble, Node 22.23.4 and disposable
PostgreSQL 16, Redis 7 and private Silo services. No production data or settings
were used. Earlier Windows failures and interrupted runs remain in external
logs; the completed Linux results below supersede their incomplete coverage.

| Gate | Result |
| --- | --- |
| Clean Linux dependency install | PASS: `npm ci`, 780 packages. |
| Full Linux units | PASS: 3,588 tests, 112 files, zero skipped, including final backup quiescence, selector guards, restore transaction, failure-phase and split-origin regressions. |
| Full Linux integration | PASS: 717 tests, 60 files, zero skipped, using real PostgreSQL, Redis processes and Silo, including all 24 new selector/config/static-overlap cases. |
| Lint, backend types, schema and worker/beat bundles | PASS. |
| Frontend catalogue and types | PASS: 227 views, 333 actions, 560 DTOs and 45 UI types. Canonical generation also passes on Windows. |
| Deployment validation | PASS: 108 script/manifest checks; Helm 4.3.1 lint and rendered ingress/autoscaling templates. |
| Complete dependency audit | PASS: zero vulnerabilities across all dependency classes. |
| Native production backend build | PASS with a 4 GiB Node heap; prepared Sharp loads successfully. |
| Notification regressions | Included in the full integration gate: account, membership, role, archive, recipient-address and digest revocation plus allowed delivery. |
| Selector follow-up PostgreSQL regressions | PASS: 50 tests across 3 files, zero skips, using a new disposable PostgreSQL database on loopback port 15446 with mocked SMTP. Includes all 24 new selector/config/static-overlap cases; pre-fix run reproduced 12 failures. External `selector-baseline.json` and `selector-final.json` retain both results. |
| Selector follow-up bounded native units | PASS: 2,070 tests across notification routing/adapters, outbox rendering and file-size rules, zero skips; subsequently included in the complete Linux rerun above. |
| Full-backup quiescence regressions | PASS: seven Linux and seven native Windows/Git Bash cases covering snapshot ordering, database-only uptime, deliberately stopped writers, discovery/stop/snapshot errors and restart failure. Included in the full Linux unit gate. |
| Packaging follow-up regressions | PASS: five actual Linux cases for private public-asset fixture lifecycle and a sudo implementation that discards inherited environment. Four native Windows cases passed; the POSIX-mode-only case is intentionally not run on NTFS and passed on Linux. Changed-file ESLint and ShellCheck passed. Final actual image permission proof remains part of packaged acceptance. |
| Full production browser modes before selector follow-up | Final monolith PASS: 15 passed, one intentional split-only skip. Final split PASS: all 16 passed. Both completed with zero retries. Both use explicit external storage and independent disposable databases. |
| Packaged installation and encrypted recovery | PENDING actual execution. Checked-in smoke contracts cover database, private files, usable encrypted keys, worker delivery and fresh volumes. |

Final evidence is retained outside the repository under
`audit-evidence/2026-10-29/workspace/`. Diagnostic logs and generated test data
are not release artifacts. Later changes to browser storage fixtures, the build
worker cap and installer acceptance must be exercised by their relevant pending
gates before release.

## Additional fixes from verification

- Local startup supervises web, BullMQ worker and beat together, validates local
  database/direct, Redis, S3 and SMTP targets before startup, and drains workers
  gracefully on Windows. Redis uses durable AOF storage and `noeviction`.
- Full bundled-storage backups pause active app/worker/beat writers during the
  database and object snapshot, then restart only the captured writers before
  encryption/off-site transfer. Error handling also resumes paused writers and
  reports failed restarts. Database-only/external-storage backups remain online;
  external objects need a separate provider backup policy.
- Standalone preparation retains installed Sharp companion libraries, including
  Windows DLLs. Deployment scripts and manifests follow an LF checkout policy.
- Backend public assets now explicitly belong to the non-root runtime user.
  An independent Machines build reproduced a Next startup failure when private
  source directory modes survived the Docker COPY as root-owned700. The shared
  packaging correction is exercised by a unique CI-only700/600 public fixture
  and direct default-user ownership/read checks before the full stack starts.
  Existing checkout assets are never chmodded by this fixture.
- Installer acceptance forwards only its nonsecret CI/config-directory/project
  coordinates across sudo, rather than relying on `sudo -E`, which sudo-rs can
  ignore. Credentials remain in the private generated configuration files.
- Frontend source fingerprints and catalogue generation normalize CRLF input.
  Two regressions prove equivalent LF/CRLF output while preserving sensitivity
  to semantic changes; generated frontend content does not acquire escaped CRLF.
- The pinned deepmerge-ts 8.0.2 override also reaches the separately installed
  Prisma migration CLI and operations dependencies in the actual Dockerfile.
  Private TLS and installer-answer transports are excluded from Docker contexts.
- Shared Next configuration bounds build workers to two: container CPU quotas
  otherwise leave Next seeing the host's full CPU count. The separate frontend
  inherits the same setting. This change awaits the final production builds.
- Split resource forwarding now preserves the upload/presence client header.
  The shared route-origin guard recognizes the configured frontend only after
  authenticating the gateway key; forged peers, absent peer origins and other
  origins fail closed. Nineteen focused tests and an independent review passed;
  full updated units and all 693 database integrations passed. Rebuilt browser
  execution then passed in both modes: monolith 15 plus one expected split-only
  skip, and split all 16, with zero retries.
- SVG chart titles use single strings rather than unsupported React title-child
  arrays. The final full unit run passes without those rendering warnings.
- The Helm chart and its default backend image now follow version 0.6.7 instead
  of retaining a fixed 0.1 image tag. Lint/rendering proves the app, worker, beat
  and migration all resolve to 0.6.7 by default.
- Installer acceptance now performs a real SQL outbox-to-BullMQ-to-STARTTLS Mailpit
  handoff and an age-encrypted backup/restore into a separate empty project. The
  recovery probe checks relational records, private objects and usable keys.
  These contracts are checked in; execution is still required.

## Execution blocker and remaining production acceptance

Docker Desktop's Linux VM exhausted memory and swap while a production image was
exporting and another app generated pages with 23 workers. The engine returned
HTTP 500 even for ping/container inventory; direct WSL commands subsequently
failed too. The user authorized a Docker Desktop restart, which restored engine access.
The coordinator captured available pre-restart inventory and restarted the two
unrelated database containers that had been running. All four apps now cap build
workers at two, and heavy acceptance runs resume serially. This recovery does
not itself prove browser, installation or restore acceptance.

The production browser layouts passed as recorded above. Complete the actual
image build and installer/recovery suite from the final source revision. The
latter is a fresh-volume Linux container
proof; a newly provisioned public VM, public DNS/TLS, published-image pulls,
production SMTP/domain authentication and external integration credentials still
need deployment-specific staging acceptance. A local copy of an encrypted backup
at a separate path does not prove storage at a physically separate provider.

For deployment staging, verify a supported Linux VM and architecture, security
updates, reboot/service recovery, SSH access and the firewall's public edge-only
ports. Check public A/AAAA records, certificate issuance/renewal, immutable released
image pulls and rollback. Exercise configured OAuth/OIDC and external notification
callbacks with their real staging credentials. Verify SMTP TLS and sender-domain
SPF/DKIM/DMARC alignment, then monitor provider bounces and complaints with the
provider's suppression policy. Confirm offsite backup retention and a timed restore
from that provider. These VM/provider checks were explicitly deferred by the user;
they are not inferred from the local clean-stack results.

Before rollout, review/drain pre-fix notification emails that lack authorization
source identifiers. Keep queue/dependency alerts and recovery objectives under
operator review. SMTP handoff remains at-least-once: a process crash between
acceptance and SQL completion can duplicate mail. No release, push, deployment or
merge has been performed during this verification phase.

## Restore transaction contract verified

Independent source review found that `pg_restore --clean` only removes objects present in its archive, so an
older backup restored into a newer migrated database can retain newer tables or fail on their dependencies.
[PostgreSQL 16 pg_restore documentation](https://www.postgresql.org/docs/16/app-pgrestore.html).
The restore now replaces the application public schema in one error-stopping transaction. Custom archive
conversion excludes only the public SCHEMA definition, retaining its separate COMMENT/ACL entries; the schema
owner and `sww_app` usage/default table/sequence grants are reinstated explicitly. Complete SQL is staged before
services stop, preventing a conversion failure from committing a valid partial SQL stream.

The two focused Bash behavioral unit tests passed natively, along with test ESLint, shell syntax and whitespace
checks. An additional **three-case actual PostgreSQL 16.15 contract passed** using a new audit-owned container
capped at 192 MiB, with no published ports and only synthetic data:

1. A custom dump restored original data, removed a newer target table, retained schema comments and a separate
   reader ACL, preserved runtime CRUD, and granted CRUD/sequence access to subsequently created tables.
   Runtime schema DDL remained denied.
2. A deliberate SQL error appended after otherwise valid restored SQL rolled back the schema replacement and
   data changes, retaining the preexisting target table and its contents.
3. An invalid custom archive failed before the service-stop stub or any SQL execution.

The harness forwards the exact production conversion/execution block to real `docker exec -i` PostgreSQL
commands; only application service stopping is stubbed. Evidence and command source are retained under
`audit-evidence/2026-10-29/workspace/restore-contract/`. The exact labelled fixture and its anonymous volume
were removed and cleanup was verified. This proves the SQL restore contract, not the still-pending full
packaged installation, encrypted storage recovery, application restart or browser acceptance. The current
recovery crypto fixture validates the MFA root key; integration/vault ciphertext recovery is not claimed.

## Final runtime image hardening in progress

An additional OS and embedded-library Trivy scan exposed inherited global npm
packages that a root application dependency audit does not cover. Both final
runtime stages now remove npm/npx; Node and the isolated migration/operator
dependencies remain. Actual npm-free image builds, complete installer/recovery
acceptance and final image scans are still required. Historical scan findings
are retained, rather than suppressed or described as a final clean result.

Production, local and CI Silo references now pin the verified October 26 release
and immutable multiarchitecture manifest; CI uses its matching mc client. The
new server/client have refreshed Go and OS packages. The server scanner still
attributes one MinIO CSV advisory to this fork; the exact released source has
bounded reads and a 1 MiB record cap, with matching binary commit. This is a
source-backport assessment, not a scanner suppression or live exploit claim.
[Released Silo source](https://github.com/pgsty/silo/blob/RELEASE.2026-10-26T00-00-00Z/internal/s3select/csv/reader.go).

The bundled standard Caddy edge now builds locally with patched Go/dependencies
and upgraded Alpine packages, including published-app installs and upgrades.
The initial actual image passed trusted TLS/proxy/private-route/header/module
smokes and removed its critical/fixable high findings. Final x/net 0.62.0 inputs
were verified with the same Go 1.26.10 toolchain to address two HTML advisories;
the final shared image 0956bb7459167ed6f47cc9fbb29e2d3ddb452f7ba1b7313f175a1ebd74c91293 passed trusted HTTPS HTTP/2, reverse-proxy/header/private-route and module-parity checks. Its unsuppressed scan is zero critical, one high, two medium and one unknown, all unfixed JOSE v3/OpenPGP entries; no OS or known fixable finding remains. Workspace image/installer acceptance remains an active gate.
The retained JOSE v3 parser is not exposed by shipped reverse-proxy configs:
they do not activate an ACME-server/JWK endpoint. The unpatched advisory remains
visible with source/symbol/config evidence and configuration-change limits in
`docker/caddy/README.md`; no scanner suppression is used. PostgreSQL image findings are confined to its gosu privilege
switcher: all 26 high/critical advisories were mapped to official Go records and
the exact binary function table; affected package/functions were absent. Raw
counts and assessment limits remain in the external image-security evidence.
