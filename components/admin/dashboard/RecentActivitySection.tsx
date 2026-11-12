import Link from "next/link";
import type { ReactNode } from "react";
import { Card, CardHeader, Chip, type ChipTone } from "@/components/ui/display";
import { auditLabel } from "@/lib/admin/dashboard/compute";
import { formatRelativeTime, viewerTimeZone } from "@/lib/format/datetime";
import type { RecentActivity } from "@/lib/admin/dashboard/types";

const KIND_LABEL: Record<string, string> = { NEW_ORG: "New organisation", MORE_LIMIT: "More capacity", FEATURE: "Feature", OTHER: "Other" };
const REQUEST_TONE: Record<string, { tone: ChipTone; word: string }> = {
  PENDING: { tone: "warning", word: "Pending" },
  APPROVED: { tone: "success", word: "Approved" },
  REJECTED: { tone: "danger", word: "Rejected" },
  CANCELLED: { tone: "neutral", word: "Cancelled" },
};

function Panel({ title, action, empty, children }: { title: string; action: ReactNode; empty: string; children: ReactNode[] }) {
  return (
    <Card as="section" aria-label={title} className="min-w-0">
      <CardHeader titleAs="h3" title={title} action={action} />
      {children.length ? <ul className="flex flex-col divide-y divide-line">{children}</ul> : <p className="text-body-ui text-ink-muted">{empty}</p>}
    </Card>
  );
}

function Item({ primary, secondary, at, chip, tz }: { primary: ReactNode; secondary: ReactNode; at: string; chip?: ReactNode; tz: string }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2.5">
      <span className="min-w-0">
        <span className="block break-words text-body-ui text-ink">{primary}</span>
        <span className="block break-words text-caption text-ink-muted">{secondary}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {chip}
        <span className="whitespace-nowrap text-caption text-ink-muted">{formatRelativeTime(at, tz)}</span>
      </span>
    </li>
  );
}

const moreLink = (href: string, label: string) => (
  <Link href={href} className="inline-flex min-h-11 items-center text-body-ui font-semibold text-accent-text underline underline-offset-4">{label}</Link>
);

export function RecentActivitySection({ recent }: { recent: RecentActivity }) {
  const tz = viewerTimeZone();
  return (
    <section aria-label="Recent activity" className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <Panel title="Admin actions" action={null} empty="No instance admin actions yet.">
        {recent.audit.map((event) => (
          <Item
            key={event.id}
            tz={tz}
            at={event.at}
            primary={auditLabel(event.action)}
            secondary={[event.actor?.name ?? event.actor?.email ?? "System", event.org?.name].filter(Boolean).join(" · ")}
          />
        ))}
      </Panel>
      <Panel title="Organisation requests" action={moreLink("/admin/requests", "All requests")} empty="No requests yet.">
        {recent.requests.map((request) => {
          const status = REQUEST_TONE[request.status] ?? { tone: "neutral" as const, word: request.status };
          return (
            <Item
              key={request.id}
              tz={tz}
              at={request.at}
              primary={`${KIND_LABEL[request.kind] ?? request.kind}${request.name ? `: ${request.name}` : ""}`}
              secondary={request.requester.name ? `${request.requester.name} · ${request.requester.email}` : request.requester.email}
              chip={<Chip tone={status.tone} size="sm">{status.word}</Chip>}
            />
          );
        })}
      </Panel>
      <Panel title="New sign-ups" action={moreLink("/admin/users", "All people")} empty="Nobody has signed up yet.">
        {recent.signUps.map((user) => (
          <Item
            key={user.id}
            tz={tz}
            at={user.at}
            primary={user.name ?? "No name"}
            secondary={user.email}
            chip={user.verified ? <Chip tone="success" size="sm">Verified</Chip> : <Chip tone="neutral" size="sm">Unverified</Chip>}
          />
        ))}
      </Panel>
    </section>
  );
}
