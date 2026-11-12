import { CampaignTabs } from "@/components/campaigns/CampaignTabs";
import { SettingsForm } from "@/components/campaigns/settings/SettingsForm";
import { Callout, Card, PageHeader } from "@/components/ui/display";
import { emailCapSummary, SHARED_SMTP_WARNING, usesSharedSmtp } from "@/lib/campaigns/limits";
import { postmarkWebhookUrl, sesWebhookUrl } from "@/lib/campaigns/public/urls";
import { getCampaignSettings } from "@/lib/campaigns/settings";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Campaign settings" };

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireWorkspace(workspaceSlug, "ADMIN");
  const [settings, cap, shared] = await Promise.all([getCampaignSettings(workspace.id), emailCapSummary(workspace.id), usesSharedSmtp(workspace.id)]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Email campaigns" description="Tracking, limits, consent and bounce handling." />
      <CampaignTabs slug={workspaceSlug} />
      {shared ? <Callout tone="warning">{SHARED_SMTP_WARNING}</Callout> : null}
      <Card><p className="text-label text-ink">Monthly sending</p><p className="mt-1 text-body-ui">{cap.used.toLocaleString("en-US")} sent this month{cap.cap === null ? ", no monthly cap." : ` of ${cap.cap.toLocaleString("en-US")}.`}</p></Card>
      <SettingsForm slug={workspaceSlug} settings={settings} sesUrl={sesWebhookUrl(workspace.id)} postmarkUrl={postmarkWebhookUrl(workspace.id)} />
      <Card><p className="text-label text-ink">Sending domain checklist</p><p className="mt-1 text-body-ui">Publish SPF and DKIM records for your sending domain and a DMARC policy, or mail may land in spam. Your email provider shows the exact records.</p></Card>
    </div>
  );
}
