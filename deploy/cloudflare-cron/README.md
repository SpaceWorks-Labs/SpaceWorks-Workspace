# Space Works Workspace cron Worker

Cloudflare Cron Trigger that replaces the beat process on free hosting plans. Part of [Space Works Workspace](../../README.md); see also the [documentation index](../../docs/README.md).

A Cloudflare Worker with a Cron Trigger (`* * * * *`). Every minute it:

1. `GET {APP_URL}/api/health` wakes the app if a free instance is asleep
   (cold starts take about 30–60 s; the Worker waits up to 90 s).
2. `POST {APP_URL}/api/internal/outbox` with `Authorization: Bearer
   {CRON_SECRET}` sends queued email and runs retention cleanup.
3. `POST {APP_URL}/api/internal/jobs` with the same bearer runs periodic jobs
   (assistant schedules and digests, service monitor checks). `204` means
   nothing was due.

The app also runs the outbox in-process while it is awake. Both paths can run
at once safely: outbox rows and jobs are claimed atomically. Use this Worker
on hosts that sleep (Render free) or as an independent recovery path. The VPS
stack and the Helm chart ship their own scheduler and do not need it.

This folder is a separate package: it is excluded from the app's TypeScript,
ESLint, Vitest and Docker build, and its only dependency is `wrangler`.

## Deploy

```bash
cd deploy/cloudflare-cron
npm ci
npx wrangler login
npx wrangler secret put APP_URL       # e.g. https://work.example.org (https, no trailing slash)
npx wrangler secret put CRON_SECRET   # the same value as the app's CRON_SECRET
npx wrangler deploy
```

`wrangler.toml` sets `workers_dev = false`, so the Worker has no public URL.
It only runs on its schedule.

## Operate

- `npx wrangler tail` streams logs. Expect `health 200`, `outbox 200` and
  `jobs 204` (or `jobs 200`) every minute. Only status codes are logged.
- `404` from outbox or jobs: `CRON_SECRET` differs from the app's value.
- `outbox 500`: the app could not run the outbox (database or SMTP). Check the
  app logs and **Admin → Outbox**.
- After rotating the app's `CRON_SECRET`, run `wrangler secret put CRON_SECRET` again.
- `npm run check` bundles the Worker without deploying it.

Cloudflare's free Workers plan allows 100,000 requests a day; this Worker uses
about 1,440 scheduled runs a day.
