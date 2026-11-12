# Observability: metrics, Grafana and Metabase

Everything is off until a super admin turns it on in `/admin/observability`.
Client providers (Sentry, PostHog, Clarity, Firebase) are described in
[OBSERVABILITY-CLIENT.md](OBSERVABILITY-CLIENT.md). This page covers server
metrics, the reporting views, Grafana and Metabase.

## Prometheus metrics

- `GET /api/metrics` (Node runtime, never cached by proxies). Send
  `Authorization: Bearer <token>`. Without a token, with a wrong token, or while
  `obs.metrics.enabled` is off the answer is a bodyless `404`.
- The token is `METRICS_TOKEN` (at least 32 characters) or the encrypted
  `obs.metrics.token`, which wins. Use **Rotate token** in the console to create
  one; it is shown once and the old one stops working immediately.
- The worker and beat processes serve the same data for their own process at
  `/metrics` on `JOBS_HEALTH_PORT` (default 3460), with the same token. Use
  different ports on one host.
- The response is cached for about 15 seconds, and database and queue gauges are
  refreshed at most that often, so scraping faster costs nothing.

| Metric | Labels | Notes |
| --- | --- | --- |
| `sww_build_info` | `version` | From the `VERSION` file |
| `sww_http_requests_total`, `sww_http_request_duration_seconds` | `group`, `method`, `status_class` | Only routes wrapped with `withMetrics`; `group` is `api_v1`, `auth`, `files`, `internal`, `realtime` or `other` |
| `sww_workspaces` | `state` | pending, active, rejected, suspended |
| `sww_users` | `state` | active, disabled |
| `sww_active_users` | `window` | `24h`, `7d`. Uses `User.lastSeenAt`, which is written at most every 5 minutes when someone opens a workspace page, so it is a good approximation, not an audit log |
| `sww_outbox_messages`, `sww_outbox_oldest_pending_age_seconds` | `status` | |
| `sww_db_up`, `sww_redis_up` | none | |
| `sww_jobs` | `queue`, `state` | From the queue counts |
| `sww_job_results_total` | `queue`, `result` | Per worker process |
| `sww_beat_schedules` | none | Per beat process |
| Default `process_*` and `nodejs_*` metrics | | |

No metric carries a workspace, user or email label. Metrics are instance-wide
only; there is no per-workspace metrics endpoint.

To instrument a Route Handler, wrap it: `export const GET = withMetrics(handler)`
(from `lib/observability/metrics`).

### Prometheus and Grafana

`deploy/observability/` holds a ready scrape config (`scrape.yml`), alert rules
(`alerts.yml`) and a Grafana dashboard (`spaceworks-overview.json`, import it and
pick your Prometheus data source). Put the token in the file named by
`credentials_file`. Scrape the backend host (the API host in the split layout);
worker and beat publish no ports, so Prometheus must share their network. In the console set the Grafana URL and dashboard path to get
a link-out from the admin page and from each workspace's reports page. Grafana is
never embedded.

## Reporting views and the read-only role

Migration `20261112210000_reporting_views` creates schema `reporting` with
views only (no Prisma models): `v_tasks`, `v_projects`, `v_members`,
`v_activity_daily`, `v_monitor_uptime_daily`. Every row carries `workspace_id`.
They expose dates, statuses, priorities, roles and counts. They never expose
titles, descriptions, names, emails, message text or tokens, and there is no
finance data in this phase. A test pins the exact column list, so adding a
column needs a deliberate privacy review.

Migration `20261112230000_reporting_views_private_teams` excludes private-team
data: projects owned by a PRIVATE team, their tasks, and activity events tied to
a private team or its projects never appear in `v_projects`, `v_tasks` or
`v_activity_daily`.

Create the role after migrations, connected as the role that applies them (the
database owner), so views added by later migrations are granted too. Re-running
the script is safe and rotates the password:

```
psql "$DIRECT_URL" -v reporting_password='a-long-random-password' -f scripts/reporting/create-readonly-role.sql
```

On the VPS, and for connecting Metabase to the private database, see
[Upgrading to 0.10.0](production-operations.md#reporting-role-for-metabase-optional).

`sww_reporting` can read only the `reporting` schema, runs read-only and has a 30
second statement timeout. Point Metabase's database connection at it. A future
migration that changes a column used by a view must drop and recreate that view.

## Metabase embedding

Set the site URL, the embedding secret key and the instance dashboard ids in the
console, enable Metabase, and list the Metabase origin in
`OBS_CSP_FRAME_ORIGINS`. Without that origin the browser would block the frame,
so Space Works shows a link-out instead.

- Tokens are HS256, signed server-side with `jose`, and last at most 10 minutes
  (5 by default). The payload is `{ resource: { dashboard }, params: { workspace_id }, exp }`.
- The dashboard id must be on the allow-list for its scope: the instance
  `adminDashboardIds` for the admin console, or the workspace's own dashboard ids
  for `/w/<slug>/analytics/reports`. Anything else is refused.
- `workspace_id` is always derived on the server from the signed-in workspace; a
  value supplied by a client is discarded. A workspace that brings its own
  Metabase uses its own site URL and encrypted secret, never the instance's.
- Viewers are workspace members who can view analytics (MEMBER and above).

### Row-level isolation caveat

Static embedding only isolates data if the dashboard does. Every card must
filter on the **locked** `workspace_id` parameter. A dashboard with a card that
ignores it shows every workspace's rows to whoever opens it. Lock the parameter
in the embedding settings of each dashboard, test it with a second workspace,
and keep instance-wide dashboards (no `workspace_id`) on the admin allow-list
only.

## Privacy

Metrics and the reporting views are aggregate and pseudonymous by design. See
the client document for consent, Do Not Track and per-workspace rules.
