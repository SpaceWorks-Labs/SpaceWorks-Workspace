import Link from "next/link";
import { notFound } from "next/navigation";
import { CampaignControls } from "@/components/campaigns/campaign/CampaignControls";
import { CampaignStatusChip } from "@/components/campaigns/campaign/StatusChip";
import { CampaignTabs } from "@/components/campaigns/CampaignTabs";
import { CampaignEditor } from "@/components/campaigns/editor/CampaignEditor";
import { Button } from "@/components/ui/button";
import { Callout, DetailList, PageHeader } from "@/components/ui/display";
import { getCampaign } from "@/lib/campaigns/campaigns";
import { loadEditorData } from "@/lib/campaigns/campaigns/editorData";
import { describePausedReason } from "@/lib/campaigns/campaigns/state";
import { formatDayTime } from "@/lib/format/datetime";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Campaign" };

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string; campaignId: string }> }) {
  const { workspaceSlug, campaignId } = await params;
  const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
  const campaign = await getCampaign(workspace.id, campaignId);
  if (!campaign) notFound();
  const data = await loadEditorData(workspace, membership);
  const base = `/w/${workspaceSlug}/campaigns`;
  const header = <PageHeader title={campaign.name} kicker={<CampaignStatusChip status={campaign.status} />} actions={campaign.status !== "DRAFT" ? <Button asChild><Link href={`${base}/${campaign.id}/stats`}>View statistics</Link></Button> : undefined} />;
  if (campaign.status === "DRAFT") {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <CampaignTabs slug={workspaceSlug} />
        <CampaignEditor slug={workspaceSlug} campaign={{ id: campaign.id, name: campaign.name, subject: campaign.subject, fromName: campaign.fromName, replyTo: campaign.replyTo, contentType: campaign.contentType, bodySource: campaign.bodySource, templateId: campaign.templateId, listIds: campaign.lists.map((l) => l.listId), trackOpens: campaign.trackOpens, trackClicks: campaign.trackClicks, individualTracking: campaign.individualTracking }} {...data} />
        <CampaignControls slug={workspaceSlug} id={campaign.id} status="DRAFT" canSend={false} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {header}
      <CampaignTabs slug={workspaceSlug} />
      {campaign.status === "PAUSED" ? <Callout tone="warning" title="This campaign is paused">{describePausedReason(campaign.pausedReason)}</Callout> : null}
      <DetailList
        items={[
          { label: "Subject", value: campaign.subject },
          { label: "From", value: campaign.fromName },
          { label: "Scheduled for", value: campaign.scheduledAt ? formatDayTime(campaign.scheduledAt, workspace.timezone) : "Not scheduled" },
          { label: "Progress", value: `${campaign.sentCount} sent, ${campaign.failedCount} failed, ${campaign.skippedCount} skipped of ${campaign.totalRecipients}` },
        ]}
      />
      <CampaignControls slug={workspaceSlug} id={campaign.id} status={campaign.status} canSend={data.canSend} />
    </div>
  );
}
