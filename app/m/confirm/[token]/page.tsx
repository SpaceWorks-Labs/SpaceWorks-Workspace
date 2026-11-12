import { previewConfirmation } from "@/lib/campaigns/subscriptions";
import { resolvePublicWorkspace } from "@/lib/campaigns/public/gate";
import { PublicShell, publicMetadata } from "@/components/campaigns/public/PublicShell";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Confirm subscription", ...publicMetadata };
export const dynamic = "force-dynamic";

/** Only a button: loading this page (a link scanner, say) never confirms anything. */
export default async function Page({ params }: PageProps<"/m/confirm/[token]">) {
  const { token } = await params;
  const preview = await previewConfirmation(token);
  const live = Boolean(preview && (await resolvePublicWorkspace({ id: preview.workspaceId })));
  if (!preview || !live) {
    return <PublicShell title="This link isn't valid" intro="It may have expired or already been used. Subscribe again to get a new one." />;
  }
  return (
    <PublicShell title="Confirm your subscription" intro={`Confirm to receive email from ${preview.workspaceName} about ${preview.listName}.`}>
      <form method="post" action={`/api/public/campaigns/confirm/${encodeURIComponent(token)}`}>
        <Button type="submit" variant="primary">Confirm subscription</Button>
      </form>
    </PublicShell>
  );
}
