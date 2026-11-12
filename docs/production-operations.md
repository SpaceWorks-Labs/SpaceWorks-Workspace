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

The database restore CLI supports the application public schema and its `reporting` views only. It refuses archives or targets containing other user schemas, stages the complete custom archive before one atomic schema replacement, and removes target tables absent from the backup. Its existing `--no-owner --no-privileges` policy remains: the restoring database user owns recovered objects, so re-run the reporting role script afterwards if Metabase uses it. Stop application workers while using this operational CLI. The VPS restore replaces the `reporting` views too and reapplies the reporting role's grants when that role exists.

## Upgrading to 0.10.0

These notes cover an update from 0.6.7 or any earlier 0.x release. Every new
feature stays off until a super admin turns it on. Existing organisations stay
active and existing members keep signing in. No new service is required.

### Before and during the update

1. Take a backup. The VPS updater does this for you.
2. Apply migrations `20261112200001` to `20261112240000` with the path you
   already use: the VPS updater or `migrator` service, the Helm pre-upgrade
   Job, the backend image's `migrate` role, `MIGRATE_ON_START=1` (Render), or
   `npm run db:deploy` from a checkout. They add the organisation, sign-in,
   per-workspace email, payments, campaigns, observability, finance and
   makerspace tables, and a `reporting` schema of read-only views. The
   migration user needs `CREATE` on the database for that schema; the database
   owner has it. Migrations are not reversed by a rollback: restore the
   pre-update backup to go back.
3. Start web, worker and beat from the same release. Campaign sending runs on
   the existing worker (scheduled queue, every 10 seconds), so there is no new
   process. For the split layout and Netlify, deploy the identical revision to
   the website after the backend.

A fresh install runs the same migrations, so it ends in the same state.

### New settings

All are optional; see [Configuration](CONFIGURATION.md). Prefer `/admin/sign-in`
and `/admin/observability`: saved settings win, are encrypted, and reach worker
and beat through the database. Environment fallbacks:

- Sign-in: `AUTH_GITHUB_*`, `AUTH_APPLE_*`, `AUTH_GOOGLE_ENABLED`,
  `AUTH_ALLOW_SELF_SIGNUP`, `AUTH_ALLOWED_EMAIL_DOMAINS`.
- Organisations: `WORKSPACES_REQUIRE_APPROVAL`, `LIMITS_*`,
  `MODULES_DISABLED_BY_DEFAULT`.
- Observability: `SENTRY_*`, `POSTHOG_*`, `CLARITY_*`, `FIREBASE_*`,
  `METRICS_ENABLED`, `METRICS_TOKEN`, `GRAFANA_*`, `METABASE_*`, `OBS_*`.

Put secret values (`AUTH_GITHUB_SECRET`, `AUTH_APPLE_PRIVATE_KEY`,
`METRICS_TOKEN`, `METABASE_SECRET_KEY`) in your secret store: `app.env` on the
VPS, the `existingSecret` on Kubernetes, secret environment variables on Render
or DigitalOcean. Web, worker and beat each need the fallbacks they use: the VPS
shares `app.env` and Helm one Secret, while Render and DigitalOcean set them per
service. In the split layout the website builds its own Content Security Policy,
so also set `OBS_CSP_PROVIDERS`, `OBS_CSP_CONNECT_ORIGINS` and
`OBS_CSP_FRAME_ORIGINS` in `frontend.env` (or on Netlify) and restart it.

Per-workspace SMTP, notification channels, Stripe and Razorpay accounts and
campaign bounce secrets are entered in each workspace's settings, not the
environment.

### Addresses that other services call

Links and webhooks use `NEXT_PUBLIC_BASE_URL`, the website origin. Your proxy,
CDN or firewall must accept these, including POSTs from other origins:

| Path | Caller |
| --- | --- |
| `/api/auth/callback/github`, `/google`, `/apple` | OAuth providers; register these on the website origin. Apple posts the result (`form_post`) |
| `/api/payments/stripe/<token>`, `/api/payments/razorpay/<token>` | Payment webhooks; copy each workspace's URL from its payment settings |
| `/api/public/campaigns/webhooks/ses/<id>`, `/postmark/<id>` | Bounce webhooks |
| `/api/public/campaigns/unsubscribe/<token>` | One-click unsubscribe from mail providers |
| `/api/public/campaigns/subscribe`, `/o/…`, `/c/…`, `/confirm/…`, `/m/…` | Subscribers, mail clients and embedded forms |
| `/api/metrics` | Prometheus, with the bearer token |

The bundled Caddy configuration needs no change. In the split layout the
website forwards these requests, with their signature headers, to the backend.
Scrape `/api/metrics` on the backend host (`PUBLIC_HOST`).

### Reporting role for Metabase (optional)

Migrations create the `reporting` views on every install; nothing can read
them until you create the `sww_reporting` login. Run the script as the role
that applies migrations, after the update. Re-running it rotates the password.

On the VPS, from the current release directory:

```bash
read -rs REPORTING_PASSWORD   # a long random password; keep it in your password manager
sudo SWW_CONFIG_DIR=/etc/spaceworks-workspace scripts/vps-compose.sh exec -T postgres \
  psql -U sww -d sww -v ON_ERROR_STOP=1 -v reporting_password="$REPORTING_PASSWORD" -f - \
  < scripts/reporting/create-readonly-role.sql
```

Elsewhere: `psql "$DIRECT_URL" -v reporting_password=... -f scripts/reporting/create-readonly-role.sql`.
The VPS database is only on the private `sww_data` network and requires TLS:
attach the Metabase container to that network and connect to host `postgres`,
database `sww`, user `sww_reporting`, SSL mode `require`. Keep Metabase behind
your own HTTPS proxy. The VPS restore keeps the role's grants; after
`npm run db:restore`, run the script again. See [Observability](OBSERVABILITY.md).

### Behaviour changes

- The sign-in field is **Username or email**; email addresses keep working.
- Password sign-in needs a verified email address. Accounts created by
  `/setup`, invitations or Google sign-in in earlier releases are already
  verified; anyone else confirms by resetting their password.
- Self sign-up is off: sign-in stays invite-only until you enable it.
- New organisations wait for super-admin approval (`WORKSPACES_REQUIRE_APPROVAL=false`
  turns this off). Existing organisations are active.
- The super admin, after the TOTP step-up, can open any organisation; this is
  recorded only in the instance audit log.
- Limits are unlimited and every module is on unless you set defaults.
- Light mode is the default colour mode.
- Campaign open and click tracking are off by default.
