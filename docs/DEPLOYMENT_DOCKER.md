# Production Docker deployment

[Documentation index](README.md) · [VPS installer](DEPLOYMENT_VPS.md) · [Images](CONTAINER_IMAGES.md)

For a complete server use the VPS installer. This guide runs the backend image
with separately supplied PostgreSQL 16, Redis, S3-compatible storage and SMTP.
Terminate HTTPS at a trusted proxy; publish only a private container port.

## Images and runtime

Pull an immutable `ghcr.io/spaceworks-labs/spaceworks-workspace-backend:<release>`.
It serves the whole application by default. Run `migrate` once before the web
rollout using an administration connection. Runtime connections should have
only data privileges. Use TLS for PostgreSQL, Redis and custom S3 endpoints.

```bash
export SWW_VERSION=0.1.0-main.42.a1b2c3d4e5f6
image="ghcr.io/spaceworks-labs/spaceworks-workspace-backend:$SWW_VERSION"
docker pull "$image"
docker run --rm --env-file /secure/workspace-migration.env "$image" migrate
docker run -d --name spaceworks-workspace --restart unless-stopped \
  --env-file /secure/workspace-runtime.env -p 127.0.0.1:3000:3000 "$image"
```

Environment files stay outside Git, mode 600. Configure all production variables
in [Configuration](CONFIGURATION.md), including independent vault, integration
and MFA keys. The container runs as uid 1001; operator tools run as root only
when needed. Only public CA certificates enter runtime mounts.

The proxy must overwrite the configured client-IP header, preserve Host and
forward HTTPS protocol. Disable buffering for `/api/realtime/*`, document
presence and assistant streams. Allow upload bodies up to 30 MB and idle reads
longer than the stream heartbeat. Keep data and storage administration ports private.

## Building your own image

```bash
docker build --target runner \
  --build-arg NEXT_PUBLIC_BASE_URL=https://spaceworks-workspace-origin.invalid \
  --secret id=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY,env=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY \
  -t spaceworks-workspace-backend:reviewed .
```

The frontend target additionally takes `NEXT_PUBLIC_BACKEND_ORIGIN`. CI builds
both architectures; the Dockerfile's last target is the backend for providers
that cannot choose a target. Release images apply public origin placeholders
at start and require each installation's own stable action key. Builders without
BuildKit secrets may use the identically named build argument; it remains in
the builder metadata/cache, so prefer secret mounts.

## Migrations, health and jobs

`DIRECT_URL` defaults to `DATABASE_URL`; use a direct/session connection when
the runtime uses a transaction pooler. `MIGRATE_ON_START=1` applies migrations
before the server on platforms without release jobs. Use a one-shot migration
with multiple replicas. A failed migration blocks startup.

`GET /api/health` is public liveness. `GET /api/health/db` requires
`Authorization: Bearer $HEALTHCHECK_SECRET`. Run separate worker and beat
containers from the same backend image: `node dist/worker.js` and
`node dist/beat.js`, with the backend runtime environment, database and native
persistent Redis access. Do not publish port 3460; probe `/health` privately.
Give worker up to ten minutes to drain on SIGTERM. Beat needs one replica.

If an external cron replaces beat, call `POST /api/internal/outbox` and
`POST /api/internal/jobs` every minute with `Authorization: Bearer $CRON_SECRET`.
`node scripts/scheduler.mjs --once` provides the tick with `APP_URL` and
`CRON_SECRET`. Endpoints enqueue; keep worker running. They return 503 if Redis
is unavailable. See [background jobs](areas/jobs-queue.md).

Back up the database, objects and encryption keys before changing releases.
Retain the previous image until checks pass. Application rollback does not
reverse migrations. The backend contains operator tools and the Prisma CLI;
database archive tools require PostgreSQL clients in a trusted checkout or
use the VPS's database container. Never seed demo data on production.
