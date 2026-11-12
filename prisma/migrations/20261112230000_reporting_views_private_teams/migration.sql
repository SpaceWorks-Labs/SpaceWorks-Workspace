-- Exclude private-team data from the BI reporting views. Same column lists as before.
-- A row is hidden when it belongs to a project owned by a PRIVATE team, or (activity) carries a PRIVATE team id.
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
FROM "Task" t
WHERE NOT EXISTS (
  SELECT 1 FROM "Project" p JOIN "Team" tm ON tm."id" = p."teamId"
  WHERE p."id" = t."projectId" AND tm."visibility" = 'PRIVATE'
);

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
FROM "Project" p
WHERE NOT EXISTS (
  SELECT 1 FROM "Team" tm WHERE tm."id" = p."teamId" AND tm."visibility" = 'PRIVATE'
);

CREATE OR REPLACE VIEW reporting.v_activity_daily AS
SELECT
  a."workspaceId" AS workspace_id,
  (date_trunc('day', a."createdAt" AT TIME ZONE 'UTC'))::date AS day,
  a."entityType"  AS entity_type,
  a."verb"        AS verb,
  count(*)::int   AS events
FROM "ActivityEvent" a
WHERE a."createdAt" >= now() - interval '400 days'
  AND NOT EXISTS (SELECT 1 FROM "Team" tm WHERE tm."id" = a."teamId" AND tm."visibility" = 'PRIVATE')
  AND NOT EXISTS (
    SELECT 1 FROM "Project" p JOIN "Team" tm ON tm."id" = p."teamId"
    WHERE p."id" = a."projectId" AND tm."visibility" = 'PRIVATE'
  )
GROUP BY a."workspaceId", 2, a."entityType", a."verb";
