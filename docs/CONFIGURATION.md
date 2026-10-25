# Configuration

[Documentation index](README.md)

For development copy `.env.example` to `.env`. Production settings belong in
an external mode-600 configuration directory or a secret manager. The VPS
installer generates them; use its settings menu rather than replacing secrets.
`lib/env.ts` and `scripts/check-production-env.mjs` validate production settings.

## Origins, services and secrets

`AUTH_URL` and `NEXT_PUBLIC_BASE_URL` must be the same canonical HTTPS website
origin. PostgreSQL requires TLS; transaction-pooler URLs on port 6543 require
`pgbouncer=true` and a separate direct/session migration URL. Redis requires
`rediss://`. A custom storage endpoint requires HTTPS and a private bucket.
Set both storage credential fields or neither when using a workload role.

Generate each key independently with `openssl rand -base64 32`. Preserve
`MFA_ENCRYPTION_KEY`, `VAULT_MASTER_KEY` and `INTEGRATION_ENCRYPTION_KEY` with
backups: losing them makes encrypted data unreadable. The action key remains
stable per runtime; backend and frontend use independent keys. Bearer/session
secrets need at least 32 characters. Store bearer hashes only in the database.

Configure bootstrap SMTP on a verified domain. `/admin` settings can override
SMTP, Google sign-in and the assistant provider key. `SUPER_ADMIN_EMAIL` is the
only instance administrator, with a fresh TOTP step-up. First account creation
is `/setup`; all subsequent members join by invitation.

`TRUSTED_PROXY_IP_HEADER` must be overwritten by the edge. Render's appending
proxy uses `x-forwarded-for` with `TRUSTED_PROXY_HOPS=1`; Caddy overwrites
`x-real-ip`. Rate limits fail closed in production. The CI-only pair `CI=true`
and `ALLOW_INSECURE_PRODUCTION_TESTS=1` belongs only to disposable tests.

## Installer settings

| Variable | Purpose |
| --- | --- |
| `SWW_DIR` | Install root, `/opt/spaceworks-workspace` |
| `SWW_CONFIG_DIR` | External secrets/config directory, `/etc/spaceworks-workspace` |
| `SWW_REPOSITORY` | GitHub owner/repository; defaults to SpaceWorks-Labs/SpaceWorks-Workspace |
| `SWW_RELEASE_TAG`, `SWW_REF` | Published release or source reference; choose only one |
| `SWW_LAYOUT` | `split`, `single` or `netlify`, recorded in `compose.env` |
| `SWW_VERSION` | Immutable release version |
| `SWW_BACKEND_IMAGE`, `SWW_FRONTEND_IMAGE` | Backend/frontend registry repositories |
| `SWW_CADDY_TLS` | `internal`, `proxy`, or unset for automatic public HTTPS |
| `SWW_STORAGE` | `external` or bundled Silo |
| `SWW_GITHUB_TOKEN`, `SWW_GITHUB_USER` | Optional private source/package read credential and its owner |
| `SWW_DEPLOY` | GitHub repository variable enabling the opt-in runner deploy job |
| `SWW_STATUS_DIR` | Read-only installer backup status mount |
| `PUBLIC_HOST`, `SITE_HOST`, `PUBLIC_ORIGIN` | API host, split website host and canonical website origin |
| `BACKUP_KEEP_DAYS`, `BACKUP_AGE_RECIPIENT`, `OFFSITE_*` | Operator-managed backup settings in `backup.env` |

The installer records release metadata in `install.conf` and separate Compose,
application, migration, database, storage, frontend env files; worker and beat use app.env.
Neither development `.env` nor arbitrary shell variables override saved
production settings. Internal TLS private keys remain outside runtime mounts.

## Split rendering

`BACKEND_ORIGIN`, `NEXT_PUBLIC_BACKEND_ORIGIN`, `FRONTEND_GATEWAY_SECRET` and
`FRONTEND_TRUSTED_IP_HEADER` configure the separate frontend. The two origins
must differ. The gateway key is 32 random bytes encoded as 64 hex characters.
Set `DEPLOYMENT_MODE=backend` on the API runtime. Frontend trusted IP headers
are `x-nf-client-connection-ip` on Netlify or `x-real-ip` behind Caddy.
Only the public backend origin reaches the browser; the peer key stays server-side.

The frontend has no database, signing, mail, Redis, storage, vault or MFA secrets.
See [Split hosting](DEPLOYMENT_SPLIT.md). Public variables compile into the UI.
Release containers replace known public-origin placeholders at start. A custom
build needs rebuilding when its public origins change. `ALLOWED_ACTION_ORIGINS`
is build-time only; generic release images reject it at startup.

## Application environment reference

The following names and local defaults come from `.env.example`. Empty values
are optional locally; production validation adds its required transport,
storage, encryption and trusted-proxy settings. Read the nearby comments in the
template for provider-specific details.

| Variable | Local example/default |
| --- | --- |
| `DATABASE_URL` | `postgresql://sww:sww_dev_password@127.0.0.1:5440/sww_dev` |
| `DIRECT_URL` | `unset` |
| `TEST_DATABASE_URL` | `postgresql://sww:sww_dev_password@127.0.0.1:5440/sww_dev_test` |
| `AUTH_SECRET` | `replace-with-at-least-32-random-characters` |
| `AUTH_URL` | `http://localhost:3000` |
| `NEXT_PUBLIC_BASE_URL` | `http://localhost:3000` |
| `AUTH_GOOGLE_ID` | `unset` |
| `AUTH_GOOGLE_SECRET` | `unset` |
| `SUPER_ADMIN_EMAIL` | `owner@example.org` |
| `MFA_ENCRYPTION_KEY` | `unset` |
| `INTEGRATION_ENCRYPTION_KEY` | `unset` |
| `VAULT_MASTER_KEY` | `unset` |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | `unset` |
| `CRON_SECRET` | `unset` |
| `HEALTHCHECK_SECRET` | `unset` |
| `REDIS_URL` | `redis://127.0.0.1:6395/0` |
| `S3_BUCKET` | `sww-dev` |
| `S3_REGION` | `us-east-1` |
| `S3_ENDPOINT` | `http://127.0.0.1:9010` |
| `S3_ACCESS_KEY_ID` | `replace-me` |
| `S3_SECRET_ACCESS_KEY` | `replace-me` |
| `S3_FORCE_PATH_STYLE` | `1` |
| `UPLOAD_MAX_BYTES` | `unset` |
| `EMAIL_FROM` | `Space Works <workspace@localhost>` |
| `SMTP_HOST` | `127.0.0.1` |
| `SMTP_PORT` | `1025` |
| `SMTP_SECURE` | `false` |
| `SMTP_SERVICE` | `unset` |
| `SMTP_USER` | `unset` |
| `SMTP_PASSWORD` | `unset` |
| `SMTP_ALLOW_UNAUTHENTICATED` | `1` |
| `OUTBOX_RETENTION_DAYS` | `unset` |
| `ANTHROPIC_API_KEY` | `unset` |
| `ASSISTANT_MODEL` | `claude-opus-5-5` |
| `SEARXNG_URL` | `unset` |
| `GOOGLE_CLIENT_ID` | `unset` |
| `GOOGLE_CLIENT_SECRET` | `unset` |
| `GITHUB_APP_ID` | `unset` |
| `GITHUB_APP_NAME` | `unset` |
| `GITHUB_APP_PRIVATE_KEY` | `unset` |
| `GITHUB_APP_PRIVATE_KEY_FILE` | `unset` |
| `GITHUB_WEBHOOK_SECRET` | `unset` |
| `TELEGRAM_BOT_TOKEN` | `unset` |
| `TELEGRAM_WEBHOOK_SECRET` | `unset` |
| `ALLOW_PRIVATE_WEBHOOK_TARGETS` | `unset` |
| `NOTIFY_WORKER_CONCURRENCY` | `unset` |
| `MONITOR_ALLOW_PRIVATE_TARGETS` | `unset` |
| `MONITOR_MAX_PER_WORKSPACE` | `unset` |
| `TRUSTED_PROXY_IP_HEADER` | `unset` |
| `TRUSTED_PROXY_HOPS` | `unset` |
| `ALLOWED_ACTION_ORIGINS` | `unset` |
| `JOBS_INPROCESS` | `false` (Redis-free local development only) |
| `JOBS_HEALTH_PORT` | `3460` (private worker/beat health) |
| `QUEUE_OUTBOX_CONCURRENCY` | `5` |
| `QUEUE_SCHEDULED_CONCURRENCY` | `2` |
| `QUEUE_SYNC_CONCURRENCY` | `2` |
| `QUEUE_MONITOR_CONCURRENCY` | `1` |
| `QUEUE_DOCUMENTS_CONCURRENCY` | `1` |
| `DEMO_PASSWORD` | `unset` |

`MIGRATE_ON_START=1` enables start-time migrations on platforms without release
jobs; otherwise run the backend image's `migrate` role once per rollout.
Run `node dist/worker.js` and `node dist/beat.js` from the backend image with
its runtime credentials and the same persistent native Redis URL. Redis must
use `noeviction`; size connection/command quotas for five queues and workers.
`QUEUE_*_CONCURRENCY` accepts 1–64 per process. Keep one beat per release.
`JOBS_QUEUE_PREFIX` optionally isolates an installation/test (default
`sww:jobs`); all roles must use the same value. Do not change it during normal
operation: existing work remains under the old prefix.

`APP_URL` and `CRON_SECRET` are the HTTP cron client's only inputs. Both internal
POST endpoints enqueue work; they require a live worker with the full runtime
configuration. Cron can replace beat; it cannot replace worker. See
[background jobs](areas/jobs-queue.md) for retries, retention and recovery.
