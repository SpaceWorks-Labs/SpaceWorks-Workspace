import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { MetabaseFrame } from "@/components/admin/observability/MetabaseFrame";
import { Card, CardHeader, Chip } from "@/components/ui/display";
import { formatRelativeTime, viewerTimeZone } from "@/lib/format/datetime";
import type { MetabaseEmbed, PlatformStatus } from "@/lib/admin/dashboard/types";

function state(p: PlatformStatus) {
  if (!p.enabled) return { tone: "neutral" as const, word: "Off" };
  return p.configured ? { tone: "success" as const, word: "On" } : { tone: "warning" as const, word: "Needs setup" };
}

function PlatformRow({ platform, tz }: { platform: PlatformStatus; tz: string }) {
  const { tone, word } = state(platform);
  const test = platform.lastTest;
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-body-ui font-semibold text-ink">
          {platform.title}
          <Chip tone={tone} size="sm">{word}</Chip>
        </p>
        {platform.enabled && platform.missing.length ? <p className="text-caption text-ink-muted">Missing: {platform.missing.join(", ")}.</p> : null}
        <p className="text-caption text-ink-muted">
          {test ? `Last test ${test.ok ? "passed" : "failed"} ${formatRelativeTime(test.at, tz)}.` : "Not tested from the console."}
          {platform.dashboardUrl ? null : platform.detail ? ` ${platform.detail}` : null}
        </p>
      </div>
      {platform.dashboardUrl ? (
        <a
          href={platform.dashboardUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 shrink-0 items-center gap-1 text-body-ui font-semibold text-accent-text underline underline-offset-4"
        >
          Open {platform.title}
          <ArrowUpRight aria-hidden className="size-4" />
          <span className="sr-only"> (new tab)</span>
        </a>
      ) : null}
    </li>
  );
}

export function PlatformsCard({ platforms, metabase }: { platforms: PlatformStatus[]; metabase: MetabaseEmbed }) {
  const tz = viewerTimeZone();
  const on = platforms.filter((p) => p.enabled && p.configured).length;
  return (
    <Card as="section" aria-label="Analytics platforms" className="min-w-0">
      <CardHeader
        title="Analytics platforms"
        description={`${on} of ${platforms.length} integrations on. Links open the provider's own dashboard.`}
        action={<Link href="/admin/observability" className="inline-flex min-h-11 items-center text-body-ui font-semibold text-accent-text underline underline-offset-4">Observability settings</Link>}
      />
      {platforms.length ? (
        <ul className="flex flex-col divide-y divide-line">
          {platforms.map((platform) => <PlatformRow key={platform.id} platform={platform} tz={tz} />)}
        </ul>
      ) : (
        <p className="text-body-ui text-ink-muted">Integration status is unavailable right now. Open observability settings to check each one.</p>
      )}
      {metabase ? (
        <details className="mt-4">
          <summary className="min-h-11 cursor-pointer py-3 text-body-ui text-accent-text">Show the instance Metabase report</summary>
          <MetabaseFrame title="Instance report" embedUrl={metabase.embedUrl} linkUrl={metabase.linkUrl} reason={metabase.reason ?? undefined} />
        </details>
      ) : null}
    </Card>
  );
}
