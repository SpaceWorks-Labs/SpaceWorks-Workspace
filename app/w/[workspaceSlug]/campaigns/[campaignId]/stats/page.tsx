import Link from "next/link";
import { notFound } from "next/navigation";
import { CampaignStatusChip } from "@/components/campaigns/campaign/StatusChip";
import { CampaignTabs } from "@/components/campaigns/CampaignTabs";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, ProgressBar, SectionHeading, StatTile } from "@/components/ui/display";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { getCampaign } from "@/lib/campaigns/campaigns";
import { getCampaignStats } from "@/lib/campaigns/stats";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Campaign results" };

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string; campaignId: string }> }) {
  const { workspaceSlug, campaignId } = await params;
  const { workspace } = await requireWorkspace(workspaceSlug, "MEMBER");
  const campaign = await getCampaign(workspace.id, campaignId);
  const stats = campaign ? await getCampaignStats(workspace.id, campaign.id) : null;
  if (!campaign || !stats) notFound();
  const tracking = campaign.trackOpens || campaign.trackClicks;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={campaign.name} kicker={<CampaignStatusChip status={campaign.status} />} actions={<Button asChild><Link href={`/w/${workspaceSlug}/campaigns/${campaign.id}`}>Back to campaign</Link></Button>} />
      <CampaignTabs slug={workspaceSlug} />
      <section aria-label="Progress" className="flex flex-col gap-2">
        <ProgressBar value={stats.progressPct} max={100} label="Sending progress" />
        <p className="text-caption text-ink-muted">{stats.progressPct}% processed, {stats.pending} waiting</p>
      </section>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Recipients" value={stats.total} />
        <StatTile label="Sent" value={stats.sent} />
        <StatTile label="Failed" value={stats.failed} tone={stats.failed ? "attention" : "default"} />
        <StatTile label="Skipped" value={stats.skipped} hint="Unsubscribed or blocklisted before sending" />
        <StatTile label="Hard bounces" value={stats.bounces.hard} />
        <StatTile label="Soft bounces" value={stats.bounces.soft} />
        <StatTile label="Complaints" value={stats.bounces.complaint} />
        {tracking && campaign.trackOpens ? <StatTile label="Opens" value={stats.opens} hint={campaign.individualTracking ? `${stats.uniqueOpens} unique` : "Counted without identifying people"} /> : null}
        {tracking && campaign.trackClicks ? <StatTile label="Clicks" value={stats.clicks} /> : null}
      </div>
      {campaign.trackClicks ? (
        <section className="flex flex-col gap-3">
          <SectionHeading title="Links" />
          {stats.links.length === 0 ? (
            <EmptyState title="No tracked links.">Clicks appear here once the campaign has links.</EmptyState>
          ) : (
            <Table label="Link clicks">
              <THead><TR><TH>Link</TH><TH>Clicks</TH><TH>Unique</TH></TR></THead>
              <TBody>{stats.links.map((l) => <TR key={l.id}><TD className="max-w-[28rem] truncate">{l.url}</TD><TD>{l.clicks}</TD><TD>{l.uniqueClicks}</TD></TR>)}</TBody>
            </Table>
          )}
        </section>
      ) : null}
    </div>
  );
}
