# AWS deployment

## EC2

Launch an x86_64 or arm64 Linux instance with at least 30 GiB disk. Allow inbound SSH from your administration network and 80/443 TCP plus 443 UDP for the edge. Point DNS to the instance, then run the [curl installer](DEPLOYMENT_VPS.md). Choose bundled data services or an external S3 bucket. Managed PostgreSQL/Redis use the standalone container deployment. Store encrypted off-server backups outside the instance/account boundary you need to recover from.

## ECS / Fargate

Use `ghcr.io/spaceworks-labs/spaceworks-workspace-backend:<immutable-version>` for the web task on port 3000. An ALB terminates HTTPS and routes the website and all API routes to it. A separate rendering frontend uses its own deployment and the gateway settings in [Split hosting](DEPLOYMENT_SPLIT.md). Enable ALB idle timeouts long enough for SSE and avoid a proxy/CDN that buffers streams. Do not cache authenticated pages, Server Actions or private downloads.

Run a one-off task from the same backend image with command `["migrate"]` and the maintenance DIRECT_URL before rolling the web service. A failed task blocks rollout. Runtime web tasks use a restricted DB identity. Run separate private worker and beat ECS services from the same backend image
with commands `["node", "dist/worker.js"]` and `["node", "dist/beat.js"]`.
Use one beat replica, the same runtime secrets and private database/Redis/storage
access, and outbound SMTP/API egress. Health probes use `/health` on port 3460;
never attach that port to the public ALB. Set the maximum supported ECS stop
timeout and allow handlers to drain. EventBridge may invoke
`node scripts/scheduler.mjs --once` with APP_URL and CRON_SECRET instead of beat,
but a running worker is still required. See [jobs](areas/jobs-queue.md).

Use RDS PostgreSQL 16 in private subnets, require TLS in DATABASE_URL and DIRECT_URL, and provision runtime grants after migrations. Use ElastiCache Redis/Valkey with TLS enabled and a native `rediss://` URL. S3 buckets remain private with versioning; the backend can use task-role credentials by omitting the access-key pair. Set S3_REGION, S3_BUCKET and HTTPS endpoint as appropriate; virtual-host style normally uses S3_FORCE_PATH_STYLE=0. Grant only bucket list/location and the needed object get/put/delete actions. Block public access.

Put AUTH_SECRET, encryption keys and bearer secrets in Secrets Manager/SSM and map them to runtime environment variables. AUTH_URL and NEXT_PUBLIC_BASE_URL must be the public HTTPS origin. Configure TRUSTED_PROXY_IP_HEADER=x-forwarded-for and the actual trusted hop count. The backend listens privately; only the load balancer is public. Mount a writable cache/tmp path if enforcing a read-only root filesystem.

Health uses public `/api/health` for load-balancer liveness and authenticated `/api/health/db` for release readiness. Save a provider snapshot before migrations. Application-image rollback leaves forward migrations in place; restore RDS/S3 together only through a reviewed maintenance procedure. See [operations](production-operations.md).
