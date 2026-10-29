# Production operations

[Documentation index](README.md) · [VPS operations](DEPLOYMENT_VPS.md)

Monitor public HTTPS, dependency-free `/api/health`, authenticated
`/api/health/db`, Redis availability, database connections, storage access,
queue failures, scheduled jobs, disk, certificate expiry and fresh backups.
An unhealthy Docker healthcheck does not itself restart a process; alert and
investigate. Keep logs free of cookies, credentials, capability URLs and
private message bodies. Review support bundles before sharing them.

## Releases and recovery

Use immutable backend/frontend images. Take database/configuration backups
before migrations, retain the previous release and verify readiness before
accepting traffic. Failed application rollout restores old images; database
changes require a reviewed restore when backward compatibility is unavailable.

The VPS menu manages nightly backups, retention, age encryption, off-site S3
copies, TLS renewal, host hardening, recovery and settings rollback. Restore
requires `RESTORE`; uninstall keeps data unless `DELETE DATA` is typed.
Configuration contains MFA, vault and integration encryption keys: recover it
with data before starting a replacement server. Keep the age private key away
from the server. Test restore on an isolated host at least quarterly.

For managed databases, use `npm run db:backup` from a trusted checkout with
compatible PostgreSQL clients and a direct TLS connection. The archive and
checksum metadata stay in ignored `backups/`; inspect `npm run db:restore --
--help` before a deliberate restore. Supply off-site settings through the
command's documented options or use the VPS backup system. Do not put secrets
in support tickets or shell history.

## Background work and trust

Run worker and beat from the same backend release and runtime configuration.
The web server never starts production timers. Beat reconciles the registry's
repeat schedules at startup; BullMQ generates them through Redis. Monitor
`http://worker:3460/health`, `http://beat:3460/health` internally and
`/admin/jobs` with fresh super-admin MFA. Failed jobs remain in their queue's
bounded dead-letter set; inspect service configuration, then retry or remove
from Jobs. Pause/resume affects new claims; active handlers finish.

The VPS status check probes both roles and support bundles include their logs.
Stop worker and beat with the app during database restore. Grant up to ten
minutes for SIGTERM draining on Compose/Helm (Render caps this at five minutes).
A forced kill may replay work. SMTP acceptance and the final database write are
not atomic; a crash between them may send mail twice even with a stable Message-ID.

For hosts without beat, call both `/api/internal/outbox` and
`/api/internal/jobs` every minute with `CRON_SECRET` in Authorization.
Cloudflare cron or `node scripts/scheduler.mjs --once` can provide that trigger.
Both endpoints only enqueue and return 503 when Redis is unavailable. A live
worker is still required. Never put bearer secrets in monitoring URLs.
See [jobs operations](areas/jobs-queue.md) for Redis loss and bounded retention.

Only trust IP headers overwritten by your edge. For Render's appending proxy,
use `x-forwarded-for` with `TRUSTED_PROXY_HOPS=1`. Caddy overwrites `X-Real-IP`.
Do not buffer SSE or assistant streams. Disable HTML rewriting/injected scripts
at a CDN; the nonce CSP and `Cache-Control: no-transform` remain in place.

## Identity, privacy and incidents

First-run account creation is `/setup`; later membership uses invitations.
Super-admin access is restricted to `SUPER_ADMIN_EMAIL` plus fresh TOTP proof.
Settings in `/admin` override bootstrap email/SSO settings. Keep encrypted
secrets write-only. Root-only recovery resets MFA, revokes sessions and creates
a one-hour, hashed, single-use password-reset token for the configured admin.

Use audited workflows for access, correction, export and deletion. Respect
workspace legal hold and retention settings. Recheck role and source-record
access on search/read/export paths. Treat a provider's SMTP acceptance as
handoff; monitor bounces and delivery separately. Record incidents, restore
drills, access reviews and credential rotation in your operating records.

The database restore CLI supports the application public schema only. It refuses archives or targets containing other user schemas, stages the complete custom archive before one atomic schema replacement, and removes target tables absent from the backup. Its existing `--no-owner --no-privileges` policy remains: the restoring database user owns recovered objects. Stop application workers while using this operational CLI.
