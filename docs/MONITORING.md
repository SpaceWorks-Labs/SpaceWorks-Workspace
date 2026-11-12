# Monitoring Space Works services

Add a monitor under Services. Admins choose a check type, interval, timeout, retries, confirmation thresholds, severity and Send to destinations. Members can read service health; guests cannot. Private endpoints require both the instance switch and a workspace admin allowlist entry. Do not enter credentials in URLs: use encrypted headers or a database connection string.

## Check types

| Type | Healthy condition | Default interval |
| --- | --- | --- |
| HTTP(S) | Expected status plus all conditions; optional latency degradation | 60 seconds |
| TCP | Port connects, optionally with a trusted TLS handshake | 60 seconds |
| Ping | ICMP reply; TCP 443 then 80 when ICMP is unavailable | 60 seconds |
| DNS | Selected record set matches expected answers | 5 minutes |
| TLS certificate | Trusted chain/name, warning at 21 days, critical at 7 | 6 hours |
| Domain expiry | RDAP expiry, warning at 30 days, critical at 7 | 24 hours |
| Heartbeat | Push arrives before the expected time plus grace | 5 minute period |
| PostgreSQL / Redis | Connect and SELECT 1 / PING succeeds | 60 seconds |
| Cloud resource | Latest provider health; unknown after 30 minutes without sync | 5 minutes |
| PromQL | First numeric instant-query value satisfies a threshold | 60 seconds |

HTTP supports methods, request body, redirects, TLS verification, keyword checks and JSON paths. Conditions include `[STATUS] == 200`, `[BODY] contains "ready"`, `[BODY].data.status == "ok"` and `[RESPONSE_TIME] < 800`. Regex conditions accept a restricted subset to bound execution time. DNS checks validate the chosen resolver independently; private addresses in the answer are data, not outbound connections.

RDAP uses the [IANA bootstrap directory](https://data.iana.org/rdap/dns.json). Registries that omit expiry return unknown. Ping needs the system ping executable; containers without ICMP permissions use TCP fallback and show that capability in the form.

## Worker deployment

Worker and beat replace the scheduler container. The bearer-protected
`POST /api/internal/jobs` enqueues registry work; `/api/internal/outbox` only
enqueues due deliveries. `scripts/scheduler.mjs` supports `--once` or continuous
HTTP cron mode when a host runs worker separately without beat.

Production uses BullMQ worker + beat. The registry schedules due monitor checks
on the `monitor` queue every five seconds; checks retain Postgres leases,
per-host concurrency and SSRF guards. Other monitor maintenance still runs
once a minute. External HTTP cron can replace beat at minute precision, but
its endpoints enqueue and require a running worker. For Redis-free local dev,
opt in with `JOBS_INPROCESS=true`; no production timer runs in Next.js.
These handlers require Node. A checker heartbeat powers the offline banner.
See [jobs operations](areas/jobs-queue.md).

Set `MONITOR_MAX_PER_WORKSPACE` (default 100) to bound each tenant's monitors. Database row locks serialize monitor creation against this cap, including auto-created cloud monitors. Per-process concurrency is 20 checks, five per target host. Leases expire after six minutes so abandoned work can be retried. Keep PostgreSQL and Redis reachable from each replica. A configured Redis outage fails claims and rate limits closed.

`MONITOR_ALLOW_PRIVATE_TARGETS=true` permits admins to add specific hostnames/IPs/CIDRs in Services settings. Both are required; metadata endpoints remain forbidden. All A/AAAA answers must pass policy and each connection uses the validated address. Every redirect is separately checked and cross-origin redirects drop credentials. Keep the allowlist narrow and use network egress controls as an additional instance boundary.

## Heartbeats

Creating or rotating a heartbeat shows the random bearer URL once. Only its SHA-256 hash and four-character hint are stored. Copy it into the job's secret store. GET, HEAD and POST are supported; POST logs are capped at 10 KB. Send at most ten pings per minute.

```sh
curl --fail "$HEARTBEAT_URL/start"
if run-your-job; then
  curl --fail "$HEARTBEAT_URL/0"
else
  curl --fail "$HEARTBEAT_URL/fail"
fi
```

A bare URL indicates success; `/log` stores a log without resetting the schedule. Exit suffixes 0–255 map to success/failure. `?rid=<uuid>` pairs starts and finishes. Cron uses five fields and an IANA time zone; grace follows the due time. A start without a finish can trigger the maximum-run-time check. Rotating invalidates the previous token immediately. Avoid putting tokens in logs or public status copy.

## Cloud credentials and least privilege

All adapters perform read calls only. Credentials use `encryptSecret("cloud-credentials", ...)`, separate from monitor secrets. They are never returned to the browser. Replacing credentials runs a connection test; failed tests do not store them. Each account can optionally create health monitors for its discovered resources.

| Provider | Setup |
| --- | --- |
| DigitalOcean | Dedicated read-only token: account, droplets, apps, databases, load balancers, monitoring and billing read access. Install do-agent for memory/disk metrics. |
| AWS | Dedicated user access keys or a role ARN plus External ID. The role trust policy permits the server identity to AssumeRole with that External ID. Use the JSON policy shown by the setup form. Select regions explicitly. Cost Explorer runs in us-east-1; enable billing access first. |
| Render | Dedicated member with the lowest sufficient role. API keys inherit that member's access; the app uses only GET requests. |
| Cloudflare | Scoped API token: Zone Read, Account Analytics Read, Workers Scripts Read and Workers R2 Storage Read; provide the account ID. Analytics availability depends on the account's dataset access. |
| Hetzner | Project token with Read permission. Connect projects separately. Monthly list prices are estimates. |
| Vercel | Token scoped to the intended team plus team ID. |
| Netlify | Dedicated personal token with access to the intended team; grant SSO access when required. |
| Fly.io | `fly tokens create readonly`, and an explicit list of app names. |
| Railway | Dedicated account/team token. Only GraphQL queries are sent. |
| GitHub Actions | Fine-grained token scoped to explicit repositories, Actions Read and implicit Metadata Read. |
| Prometheus | Base URL and optional read-only bearer token; endpoint must pass strict public-network policy. Generic health URLs use HTTP monitors. |
| Contabo | Client ID and secret from Customer Control Panel → API, plus the API user (account email) and the separate API password set there. Instances and status only. |
| Linode (Akamai) | Personal access token with Linodes: Read Only and Account: Read Only, with an expiry. Balance and uninvoiced usage appear under costs. |
| Vultr | API key with this server's IP in the key's access control list. Pending charges and balance appear under costs. |
| Scaleway | Secret key of an IAM application with the InstancesReadOnly policy; list the zones you use (default fr-par-1). |
| Supabase | Account access token. Projects appear with their health; add HTTP monitors for API URLs. |

AWS IAM actions in the setup form cover EC2 DescribeInstances/DescribeInstanceStatus, CloudWatch GetMetricData/DescribeAlarms, RDS DescribeDBInstances, Lightsail GetInstances, ECS List/Describe, Route53 ListHealthChecks/GetHealthCheckStatus and Cost Explorer GetCostAndUsage/GetCostForecast. Resource is `*` where these list/describe APIs require it. Grant `sts:AssumeRole` only for the chosen role in the calling identity's separate policy. No create/update/delete actions are needed.

## Provider limits and sync

Inventory sync defaults to five minutes, costs at most daily. Each sync batch has a 40-second cancellation budget so external scheduler calls remain bounded. HTTP retries use bounded exponential backoff with jitter and honor Retry-After; a longer pause defers the sync instead of retrying early. Failures show safe errors without response bodies or credentials. Published limits can change: consult the provider links when sizing an instance.

| Provider | Client spacing and official reference |
| --- | --- |
| DigitalOcean | 750 ms; [5,000/hour and 250/minute](https://docs.digitalocean.com/reference/api/reference/public-apis/) |
| Render | 350 ms; [400 GETs/minute](https://api-docs.render.com/reference/rate-limiting) |
| Cloudflare | 350 ms; [1,200 requests/5 minutes](https://developers.cloudflare.com/fundamentals/api/reference/limits/) |
| Hetzner | 1,100 ms; [3,600/hour/project](https://docs.hetzner.cloud/reference/cloud) |
| Vercel | 350 ms plus [endpoint rate-limit headers](https://vercel.com/docs/rest-api) |
| Netlify | 350 ms; [500/minute for most reads](https://docs.netlify.com/api-and-cli-guides/api-guides/get-started-with-api/) |
| Fly.io | 1,100 ms; [per-action limits](https://fly.io/docs/machines/api/working-with-machines-api/#rate-limits) |
| Railway | 36 seconds; [100/hour on Free, higher on paid plans](https://docs.railway.com/integrations/api) |
| GitHub | 750 ms plus [primary and secondary response limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) |
| Contabo | 400 ms; [token per sync, request id per call](https://api.contabo.com/) |
| Linode | 250 ms; [800 GETs/minute for most collections](https://techdocs.akamai.com/linode-api/reference/rate-limits) |
| Vultr | 600 ms; [30 requests/second per IP](https://www.vultr.com/api/#section/Introduction/Rate-Limit) |
| Scaleway | 250 ms; [per-organisation quotas](https://www.scaleway.com/en/developers/api/) |
| Supabase | 1,100 ms; [Management API limits](https://supabase.com/docs/reference/api/introduction) |
| AWS | [SDK retries](https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html), bounded attempts and request timeouts; service quotas vary. |

Spacing is coordinated per configured connection. Accounts that share the same provider user/token also share the provider's quota; avoid duplicate account entries with the same credentials, and leave headroom for other tools. CloudWatch and Cost Explorer calls may incur provider charges. Billing refresh preserves provider currency, avoids combining overlapping MTD/daily/monthly series, and excludes balances/forecasts from actual spend. Missing billing permissions show unavailable data, not zero cost.

## Incidents, maintenance and retention

Default confirmation is three failures to open, two successes to recover. Reminders stop on acknowledgement or resolution. A monitor opening its fifth incident in an hour is considered flapping; notifications pause and recovery requires 15 stable minutes. Maintenance excludes checks from uptime and suppresses alerts when selected, including open-incident reminders and escalations. Recurrence supports DAILY, WEEKLY and MONTHLY with BYDAY/BYMONTHDAY/BYHOUR/BYMINUTE; unsupported RRULE fields are rejected.

Raw checks default to 14 days, configurable per workspace from 7–30. Hourly rollups remain 90 days, daily rollups 730 days, provider metrics seven days and heartbeat logs 30 days. Legal-hold workspaces are excluded from retention purges. Uptime is check-based `(up + degraded) / (total - maintenance)`; unknown samples do not count. p50/p95 use interpolated percentiles for raw and SQL buckets. Percentiles combined across historical buckets are approximate.

Public status is opt-in. Select public names and only the monitors to publish; edit manual incident/maintenance text with public readers in mind. JSON is at `/status/<workspaceSlug>/summary.json` (also `/api/summary.json` below that path); badges at `/badge/<componentKey>`; RSS at `/feed.rss`. JSON, RSS and badge responses use a 30-second public cache and nosniff. Disable the page to stop new reads; caches can retain the previous response for their remaining lifetime.

## Server metrics, Grafana and Metabase

Instance metrics for Prometheus and Grafana, the read-only reporting views and Metabase embedding are covered in [OBSERVABILITY.md](OBSERVABILITY.md).
