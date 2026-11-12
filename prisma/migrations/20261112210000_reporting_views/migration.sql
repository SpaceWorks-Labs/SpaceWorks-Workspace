-- Read-only reporting views for BI tools (Metabase). SQL only: no Prisma models.
-- Every view carries workspace_id and exposes no titles, bodies, names, emails or tokens.
CREATE SCHEMA IF NOT EXISTS reporting;

CREATE OR REPLACE VIEW reporting.v_tasks AS
SELECT
  t."id"          AS task_id,
  t."workspaceId" AS workspace_id,
  t."projectId"   AS project_id,
  CASE WHEN t."archivedAt" IS NOT NULL THEN 'archived'
       WHEN t."completedAt" IS NOT NULL THEN 'done'
       ELSE 'open' END AS status,
  t."priority"::text AS priority,
  t."dueAt"       AS due_at,
  t."completedAt" AS completed_at,
  t."createdAt"   AS created_at,
  t."updatedAt"   AS updated_at,
  (t."completedAt" IS NULL AND t."archivedAt" IS NULL AND t."dueAt" IS NOT NULL AND t."dueAt" < now()) AS is_overdue
FROM "Task" t;

CREATE OR REPLACE VIEW reporting.v_projects AS
SELECT
  p."id"            AS project_id,
  p."workspaceId"   AS workspace_id,
  p."key"           AS project_key,
  p."status"::text  AS status,
  p."startsOn"      AS starts_on,
  p."dueOn"         AS due_on,
  p."cyclesEnabled" AS cycles_enabled,
  p."createdAt"     AS created_at,
  p."updatedAt"     AS updated_at
FROM "Project" p;

CREATE OR REPLACE VIEW reporting.v_members AS
SELECT
  m."id"            AS member_id,
  m."workspaceId"   AS workspace_id,
  m."role"::text    AS role,
  m."status"::text  AS status,
  m."joinedAt"      AS joined_at
FROM "Membership" m;

CREATE OR REPLACE VIEW reporting.v_activity_daily AS
SELECT
  a."workspaceId" AS workspace_id,
  (date_trunc('day', a."createdAt" AT TIME ZONE 'UTC'))::date AS day,
  a."entityType"  AS entity_type,
  a."verb"        AS verb,
  count(*)::int   AS events
FROM "ActivityEvent" a
WHERE a."createdAt" >= now() - interval '400 days'
GROUP BY a."workspaceId", 2, a."entityType", a."verb";

CREATE OR REPLACE VIEW reporting.v_monitor_uptime_daily AS
SELECT
  r."workspaceId" AS workspace_id,
  r."monitorId"   AS monitor_id,
  (r."bucketStart" AT TIME ZONE 'UTC')::date AS day,
  r."total"       AS checks_total,
  r."up"          AS checks_up,
  r."degraded"    AS checks_degraded,
  r."down"        AS checks_down,
  r."maintenance" AS checks_maintenance,
  r."downtimeSec" AS downtime_seconds,
  r."latencyAvg"  AS latency_avg_ms,
  r."latencyP95"  AS latency_p95_ms
FROM "MonitorRollup" r
WHERE r."granularity" = 'DAY';
