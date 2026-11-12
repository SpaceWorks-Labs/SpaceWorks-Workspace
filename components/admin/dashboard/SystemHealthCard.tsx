import Link from "next/link";
import { Card, CardHeader, Chip, type ChipTone } from "@/components/ui/display";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatRelativeTime, viewerTimeZone } from "@/lib/format/datetime";
import type { SystemHealth } from "@/lib/admin/dashboard/types";

function Row({ name, tone, word, detail, href }: { name: string; tone: ChipTone; word: string; detail: string; href?: string }) {
  return (
    <li className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="min-w-0">
        <span className="block text-body-ui font-semibold text-ink">{href ? <Link href={href} className="underline-offset-4 hover:underline">{name}</Link> : name}</span>
        <span className="block text-caption text-ink-muted">{detail}</span>
      </span>
      <Chip tone={tone} size="sm" className="self-start sm:self-auto">{word}</Chip>
    </li>
  );
}

export function SystemHealthCard({ health }: { health: SystemHealth }) {
  const tz = viewerTimeZone();
  const { outbox } = health;
  const failedJobs = (health.queues ?? []).reduce((sum, queue) => sum + queue.failed, 0);
  return (
    <Card as="section" aria-label="System health" className="min-w-0">
      <CardHeader title="System health" description={`Version ${health.version}. Checked within the last few seconds.`} />
      <ul className="flex flex-col divide-y divide-line">
        <Row name="Database" tone={health.database.ok ? "success" : "danger"} word={health.database.ok ? "Up" : "Down"} detail={health.database.ok ? `Answered in ${health.database.latencyMs} ms` : "Not answering. Check PostgreSQL."} />
        <Row
          name="Redis and job queues"
          tone={!health.redis.configured ? "neutral" : health.redis.reachable ? "success" : "danger"}
          word={!health.redis.configured ? "Not set up" : health.redis.reachable ? "Up" : "Down"}
          detail={!health.redis.configured ? "Rate limits and realtime use this process only; background jobs need Redis." : health.redis.reachable ? `${failedJobs} failed ${failedJobs === 1 ? "job" : "jobs"} kept for review` : "Not reachable. Check REDIS_URL and the Redis service."}
          href="/admin/jobs"
        />
        <Row
          name="Email outbox"
          tone={outbox.failed > 0 ? "warning" : "success"}
          word={outbox.failed > 0 ? `${outbox.failed} failed` : "Clear"}
          detail={`${outbox.pending} waiting, ${outbox.processing} sending${outbox.oldestPendingAt ? `. Oldest queued ${formatRelativeTime(outbox.oldestPendingAt, tz)}` : ""}`}
          href="/admin/outbox"
        />
        <Row name="Instance email (SMTP)" tone={health.emailConfigured ? "success" : "warning"} word={health.emailConfigured ? "Set up" : "Not set up"} detail={health.emailConfigured ? "Invitations and notifications can be sent." : "Add an SMTP server in instance settings."} href="/admin/settings" />
        <Row name="Object storage" tone={health.storageConfigured ? "success" : "neutral"} word={health.storageConfigured ? "Set up" : "Disk fallback"} detail={health.storageConfigured ? "Files go to S3-compatible storage." : "Development disk fallback; set S3_BUCKET and S3_REGION."} />
        {health.heartbeats.map((beat) => (
          <Row
            key={beat.key}
            name={beat.label}
            tone={beat.fresh ? "success" : "neutral"}
            word={beat.fresh ? "Recent" : "Idle"}
            detail={beat.lastSucceededAt ? `Last ran ${formatRelativeTime(beat.lastSucceededAt, tz)}` : "Has not run yet"}
          />
        ))}
      </ul>
      {health.queues?.length ? (
        <div className="mt-4">
          <Table label="Job queues">
            <THead>
              <tr><TH>Queue</TH><TH>Waiting</TH><TH>Active</TH><TH>Delayed</TH><TH>Failed</TH><TH>State</TH></tr>
            </THead>
            <TBody>
              {health.queues.map((queue) => (
                <TR key={queue.name}>
                  <TD className="font-semibold">{queue.name}</TD>
                  <TD className="tabular-nums">{queue.waiting}</TD>
                  <TD className="tabular-nums">{queue.active}</TD>
                  <TD className="tabular-nums">{queue.delayed}</TD>
                  <TD className="tabular-nums">{queue.failed}</TD>
                  <TD>{queue.paused ? <Chip tone="warning" size="sm">Paused</Chip> : <Chip tone="success" size="sm">Running</Chip>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      ) : null}
    </Card>
  );
}
