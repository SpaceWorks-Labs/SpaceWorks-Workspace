# Workspace production audit — 29 October 2026

## Scope and release decision

Space Works Workspace **0.6.7** passed the bounded source, Linux, browser and
local clean-stack acceptance recorded below. Final application code is
`0a59553fc15b6b07b7c0a19be647c2eb8074a90a`; the final report commit changes
documentation only. Inventory, Machines and Bookings have separate reports.
The user authorized a checked feature PR into dev, then a checked dev-to-main
PR, followed by branch and repository-resource cleanup. No production database,
credential file or live deployment was used as a test target.

The local evidence supports release through those checks; it does not certify
the absence of other defects. New-host, public TLS and real-provider checks
remain deployment-specific gates, explicitly deferred by the user.

The sibling primary checkout originally contained a legacy Loop README and
pre-existing untracked source. That source is distinct from this audited modern
application and must be preserved before replacing that checkout or removing
the modern auxiliary worktree.

## Verified defects and remediation

| Finding | Fix and evidence |
| --- | --- |
| Queued personal notifications survived revoked account, membership, role or workspace access. | Shared dispatch/routing/delivery guards recheck enabled accounts, current membership, event minimum roles and workspace state. Removed, cancelled, failed or unknown sources fail closed. |
| Routing to generic email lost recipient authorization before SMTP. | Notification and digest source identifiers survive the outbox boundary. The worker rechecks the current recipient, email address, destination type/configuration and source immediately before SMTP. |
| Role/team/user destination selectors were not rechecked at SMTP. | One recipient-filtered current-membership lookup shares routing selector rules. Explicit current static recipients retain their external-recipient semantics. The new 24-case PostgreSQL suite reproduced 12 pre-fix failures; 50 focused cases passed. |
| Split uploads and document presence lost their client header. | Forward it only through the authenticated gateway's exact configured origin. Trusted-peer, origin and revocation regressions cover the boundary. |
| Restoring an older dump left newer target-schema objects. | Stage complete SQL before stopping services, replace the public schema transactionally, retain schema comments/ACLs and reinstate restricted runtime/default grants. Conversion and SQL errors fail before committing partial recovery. |
| Full bundled-storage backups could snapshot writers inconsistently. | Pause only running app/worker/beat writers during the DB/object snapshot; resume that captured set before encryption and on failures. Database-only/external-storage policy remains explicit. Seven behavioral cases cover ordering and failure recovery. |
| Encrypted output creation raced with GNU tar directory metadata reads. | Precreate the excluded output before the pipeline. Actual GNU tar reproduces the old fatal error and verifies the fix without suppressing tar failures. |
| Private 700/600 source inputs were unreadable under runtime users. | Own backend public assets, direct JavaScript helpers and VPS tools as the non-root application UID; stage private PostgreSQL bootstrap inputs into postgres-owned runtime files. Actual packaged probes exercise private files and UID/modes. |
| sudo-rs discarded installer fixture coordinates. | Forward only nonsecret project/configuration coordinates explicitly. Credentials stay in private configuration files. Real-mode fixture and environment-discarding sudo regressions passed. |
| Inherited global npm and an independent cron lock escaped root dependency checks. | Remove npm/npx from final runtimes; preserve Sharp and isolated Prisma tools with deepmerge-ts 8.0.2. Independently audit/bundle Wrangler 4.156.0, undici 7.30.1 and matching workerd in credential-free CI. |

The review also traced invite-only authentication/MFA, tenant/page/action guards,
last-owner and concurrent-counter locks, REST/MCP scopes and rate limits, private
files and record visibility, DNS/socket-time SSRF controls, nonce CSP, trusted
headers, SQL outbox/worker/beat retries, graceful shutdown and operational health.
These are bounded review and test results; every external provider and every UI
state was not manually exercised.

## Stack and installation

```sh
curl -fsSL https://raw.githubusercontent.com/SpaceWorks-Labs/SpaceWorks-Workspace/main/install.sh | bash
```

The installer follows main. PostgreSQL 16, Redis 7 with AOF/noeviction, private
Silo storage, Caddy HTTPS, migrations and separate BullMQ worker/beat services
form the standalone stack. Local Compose includes loopback-only services and
Mailpit. Guided setup, upgrade, backup, restore and health scripts are included.
Next.js 16/React 19/TypeScript use Prisma 6 and Auth.js with optional SSO and MFA.

Per user direction, BullMQ matches the Events architecture. Requests persist
email/notification work; SMTP and external notification delivery execute in
workers. SMTP remains at-least-once: a crash after provider acceptance and before
SQL completion can duplicate a message. Before rollout, review/drain pre-fix
generic notification emails lacking source identifiers; no production queue was
inspected or modified during this audit.

## Completed verification

Ubuntu Noble, Node 22.23.4 and disposable PostgreSQL/Redis/private Silo fixtures
were used. Current code passed all eight GitHub CI jobs, including actual
Dockerfile installation/recovery and both production browser layouts.

| Gate | Result |
| --- | --- |
| Complete-source Linux units | **3,597 passed / 115 files, zero skipped**, including real Redis. |
| PostgreSQL integrations | **717 passed / 60 files, zero skipped**. |
| Production browser layouts | Monolith **15 passed + one intentional split-only skip**; split **16 passed**, zero retries. |
| Lint/types, schema, worker/beat and frontend bundles | Passed; generated catalogue contains 227 views, 333 actions, 560 DTOs and 45 UI types. |
| Deployment validation | **110** script/manifest checks; Helm 4.3.1 lint/render passed. |
| Dependencies | Root and independent cron audits passed with zero findings; credential-free Wrangler bundle passed without deployment. |
| Focused backup/packaging follow-ups | **13 Linux cases passed**, including actual GNU tar and private-source/sudo probes. |
| Real PostgreSQL restore contract | Custom archive/data/grants/ACL/comment preservation and newer-table removal passed; injected SQL error rolled back; malformed archive failed before stopping services. |
| Final actual backend/frontend images | Complete checked-in Dockerfile builds passed. Non-root UID, npm/npx absence, isolated CLI/deepmerge, Sharp PNG and the admin backup route were verified in the actual backend image. |
| Clean installation and encrypted fresh-volume recovery | **Passed split and single layouts, TLS/least privilege, private object access, real worker STARTTLS and bearer outbox deletion before/after age-encrypted recovery into empty database/storage volumes; restored schema, ciphertext, original keys and target-residue removal passed.** |

Final backend: `c58c03c12ce792944a1a22785292887b7d8b3ab76289e73df6f735ba796b6779`.
Final frontend: `14ea0c1151affe3adb23d3315a72d761cdda249fbfb60ebb94af91cd73417e39`.
Both exact application images have **zero OS/library findings at every severity**
in the retained unsuppressed Trivy results.

External evidence is under `audit-evidence/2026-10-29/workspace/` and the shared
`image-security/` directory. It includes raw commands/logs, test counts, source
coverage, image identities, scans and recovery receipts. Generated test data and
diagnostic logs are not release artifacts.

## Source completeness and superseded attempts

The coordinator's original archive helper incorrectly excluded any nested
directory named `backups`, omitting `app/admin/backups/page.tsx` from earlier
local Workspace assemblies. GitHub CI's complete checkout was unaffected.
An exhaustive Git-tracked comparison found no omissions in the other three
applications. The helper now excludes generated directories only at the root.

Final Workspace archive SHA-256 is
`d4f7ff2ac58165d74b6ec98586e264e231bef2b96ec46c541ac44baced0e4349`:
**2,528 / 2,528 tracked files**, no omissions, plus its release marker.
The complete Linux unit suite and complete packaged image/install/restore run
were repeated from that archive. The earlier partial assemblies and their scans
remain historical evidence and are not substituted for these final images.

Docker Desktop previously exhausted VM memory/swap during overlapping builds.
The user authorized recovery, and final heavy builds were serialized with two
Next workers. Earlier failed or interrupted logs remain visible. An authorized
stop removed the pre-existing auto-remove `silly_sammet` container; its exact
instance could not be restarted. The two unrelated databases were restarted.

## Shared dependencies and rollout limits

The reviewed standard Caddy build uses Go 1.26.10, patched dependencies and
upgraded Alpine packages. Its trusted HTTPS/HTTP2, proxy/private-route/header and
module checks passed. Raw scans retain **zero critical, one high, two medium and
one unknown** unfixed JOSE v3/OpenPGP entries, with no OS findings. The shipped
reverse-proxy configurations expose no ACME-server/JWK endpoint; source, symbols
and configuration support that bounded assessment. This is not an upstream fix.
See `docker/caddy/README.md`; the exact deployed image/layer evidence is retained.

Silo's pinned October 26 server retains scanner findings. Its released CSV reader
has a bounded 1 MiB record cap corresponding to the reported advisory; this is a
source-backport assessment, not a live exploit claim or suppression. PostgreSQL
image high/critical findings belong to its gosu privilege switcher; the reported
affected package/functions were absent from the exact binary function table.
Raw counts and limits remain in the external security evidence. Dependency
monitoring and reassessment after upstream updates remain operator duties.

Before live traffic, verify a supported newly provisioned Linux host, updates,
reboot/service recovery, SSH/firewall public edge-only ports, DNS A/AAAA,
certificate issuance/renewal, released immutable multiarchitecture image pulls
and rollback. Exercise real OAuth/OIDC/provider callbacks, SMTP TLS and sender
SPF/DKIM/DMARC, bounces/complaints/suppressions, and a timed restore from the actual
offsite provider. A local encrypted copy at another path does not establish
physically separate storage. Integration/vault ciphertext recovery beyond the
tested keys is not claimed. These checks were explicitly deferred to staging.

After checked dev/main publication, remove other branches and auxiliary worktrees
and generated resources belonging to these four repositories. Preserve older
source/user data opaquely, retain audit evidence and leave unrelated projects
and resources of unproved ownership untouched.
