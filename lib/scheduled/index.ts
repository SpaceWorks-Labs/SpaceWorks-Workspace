import "server-only";
import { run as secrets } from "@/lib/scheduled/secrets";
import { run as analytics } from "@/lib/scheduled/analytics";
import { run as marketingIt } from "@/lib/scheduled/marketingIt";
import { run as productOps } from "@/lib/scheduled/productOps";
import { run as recurringCosts } from "@/lib/scheduled/recurringCosts";
import type { JobDefinition } from "@/lib/queue/definitions";
import { enqueueDueOutbox } from "@/lib/queue/enqueue";
import { purgeExpiredOperationalData } from "@/lib/retention";
import { runDueChecks } from "@/lib/monitor/scheduler";
import { run as documents } from "@/lib/scheduled/documents";
import { run as funding } from "@/lib/scheduled/funding";
import { run as moneyControls } from "@/lib/scheduled/moneyControls";
import { run as govextras } from "@/lib/scheduled/govextras";
import { run as social } from "@/lib/scheduled/social";

import { run as calendar } from "@/lib/scheduled/calendar";
import { run as opsGaps } from "@/lib/scheduled/opsGaps";
import { run as appReviews } from "@/lib/scheduled/appReviews";
import { run as governance } from "@/lib/scheduled/governance";
import { run as projectsPlus } from "@/lib/scheduled/projectsPlus";
import { run as tasks } from "@/lib/scheduled/tasks";
import { run as chat } from "@/lib/scheduled/chat";
import { run as docsFiles } from "@/lib/scheduled/docsFiles";
import { run as community } from "@/lib/scheduled/community";
import { run as finance } from "@/lib/scheduled/finance";
import { run as assistant } from "@/lib/scheduled/assistant";
import { run as integrations } from "@/lib/scheduled/integrations";
import { run as monitor } from "@/lib/scheduled/monitor";
import { run as people } from "@/lib/scheduled/people";
import { run as opsMoney } from "@/lib/scheduled/opsMoney";
import { run as collaboration } from "@/lib/scheduled/collaboration";
import { run as shell } from "@/lib/scheduled/shell";
import { run as campaigns } from "@/lib/scheduled/campaigns";
import { run as makerspace } from "@/lib/scheduled/makerspace";

/**
 * Periodic jobs, one module per build area. Each area replaces the body of
 * its own file and never edits this registry. A failing job is logged and
 * does not stop the others.
 */
export const SCHEDULED_JOBS: ReadonlyArray<JobDefinition> = [
  { area: "secrets", run: secrets },
  { area: "analytics", run: analytics },
  { area: "marketing-it", run: marketingIt },
  { area: "product-ops", run: productOps },
  { area: "funding-tools", run: funding },
  { area: "money-controls", run: moneyControls },
  { area: "ops-gaps", run: opsGaps },
  { area: "social", queue: "sync", run: social },
  { area: "team-calendar", run: calendar },
  { area: "app-reviews", queue: "sync", run: appReviews },
  { area: "govextras", run: govextras },
  { area: "governance-tools", run: governance },
  { area: "tasks", run: tasks },
  { area: "projects-plus", run: projectsPlus },
  { area: "chat", run: chat },
  { area: "docs-files", queue: "documents", run: docsFiles },
  { area: "community", run: community },
  { area: "finance", run: finance },
  { area: "recurring-costs", run: recurringCosts },
  { area: "documents", run: documents },
  { area: "assistant", run: assistant },
  { area: "integrations-messaging", queue: "sync", run: integrations },
  { area: "monitor", queue: "monitor", run: monitor },
  { area: "people-relationships", run: people },
  { area: "ops-money", run: opsMoney },
  { area: "work-collaboration", run: collaboration },
  { area: "platform-shell", run: shell },
  { area: "campaigns", schedule: { every: 10_000 }, run: campaigns },
  { area: "makerspace", schedule: { every: 3_600_000 }, run: makerspace },
  { area: "monitor-checks", queue: "monitor", schedule: { every: 5_000 }, run: async () => { await runDueChecks({ claimWindowMs: 0, maxRetryWaitMs: 5_000 }); } },
  { area: "outbox-relay", queue: "outbox", schedule: { every: 5_000 }, run: async () => { await enqueueDueOutbox(); } },
  { area: "operational-retention", schedule: { pattern: "0 0 * * *", tz: "UTC" }, run: async () => { await purgeExpiredOperationalData(); } },
];

export async function runScheduledJobs(now = new Date()) {
  const failed: string[] = [];
  for (const job of SCHEDULED_JOBS) {
    try {
      // Redis-free development delivers directly through the existing local worker.
      if (job.area === "outbox-relay" && !process.env.REDIS_URL) continue;
      await job.run(now);
    } catch {
      failed.push(job.area);
      console.error(`[scheduler] ${job.area} job failed`);
    }
  }
  return { ran: SCHEDULED_JOBS.length, failed };
}
