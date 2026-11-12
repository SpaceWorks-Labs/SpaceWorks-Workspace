import { PageHeader } from "@/components/ui/display";
import { EmailSettings } from "@/components/messaging/EmailSettings";
import { getWorkspaceEmailSettingsView } from "@/lib/email/workspaceSettings";
import { formatDate, formatTime } from "@/lib/format/datetime";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Email sending" };

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace, user } = await requireWorkspace(workspaceSlug, "ADMIN");
  const settings = await getWorkspaceEmailSettingsView(workspace.id);
  const verifiedAt = settings?.lastVerifiedAt ? new Date(settings.lastVerifiedAt) : null;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Email sending" description="Send this workspace's notification, invoice and campaign email from your own SMTP server. Sign-in and invitation email always uses the instance server." />
      <EmailSettings
        slug={workspaceSlug}
        adminEmail={user.email}
        settings={settings}
        verifiedLabel={verifiedAt ? `${formatDate(verifiedAt, workspace.timezone)} · ${formatTime(verifiedAt, workspace.timezone)}` : null}
      />
    </div>
  );
}
