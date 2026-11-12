import Link from "next/link";
import { CampaignStatusChip } from "@/components/campaigns/campaign/StatusChip";
import { CampaignTabs } from "@/components/campaigns/CampaignTabs";
import { Button } from "@/components/ui/button";
import { Callout, EmptyState, PageHeader, StatTile } from "@/components/ui/display";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { listCampaigns } from "@/lib/campaigns/campaigns";
import { describePausedReason } from "@/lib/campaigns/campaigns/state";
import { emailCapSummary } from "@/lib/campaigns/limits";
import { formatDayTime } from "@/lib/format/datetime";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Email campaigns" };

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireWorkspace(workspaceSlug, "MEMBER");
  const [campaigns, cap] = await Promise.all([listCampaigns(workspace.id), emailCapSummary(workspace.id)]);
  const base = `/w/${workspaceSlug}/campaigns`;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Email campaigns" actions={<Button asChild variant="primary"><Link href={`${base}/new`}>New campaign</Link></Button>} />
      <CampaignTabs slug={workspaceSlug} />
      <div className="grid gap-4 sm:grid-cols-2">
        <StatTile label="Emails sent this month" value={cap.used} hint={cap.cap === null ? "No monthly cap" : `of ${cap.cap}`} progress={cap.cap ? { value: cap.used, max: cap.cap, tone: cap.reached ? "warning" : "accent" } : undefined} />
      </div>
      {campaigns.some((c) => c.status === "PAUSED") ? <Callout tone="warning">A campaign is paused. Open it to see why and resume.</Callout> : null}
      {campaigns.length === 0 ? (
        <EmptyState title="No campaigns yet." action={<Button asChild variant="primary"><Link href={`${base}/new`}>New campaign</Link></Button>}>Write the first one for your subscribers.</EmptyState>
      ) : (
        <Table label="Campaigns">
          <THead><TR><TH>Name</TH><TH>Status</TH><TH>When</TH><TH>Sent</TH><TH>Failed</TH></TR></THead>
          <TBody>
            {campaigns.map((c) => {
              const when = c.finishedAt ?? c.startedAt ?? c.scheduledAt;
              return (
                <TR key={c.id}>
                  <TD className="border-b border-line px-4"><Link href={`${base}/${c.id}`} className="font-semibold text-ink hover:underline">{c.name}</Link><span className="block text-caption text-ink-muted">{c.subject}</span></TD>
                  <TD className="border-b border-line px-4"><CampaignStatusChip status={c.status} />{c.status === "PAUSED" ? <span className="block text-caption text-ink-muted">{describePausedReason(c.pausedReason)}</span> : null}</TD>
                  <TD className="border-b border-line px-4">{when ? formatDayTime(when, workspace.timezone) : "Not scheduled"}</TD>
                  <TD className="border-b border-line px-4">{c.sentCount} of {c.totalRecipients}</TD>
                  <TD className="border-b border-line px-4">{c.failedCount}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </div>
  );
}
