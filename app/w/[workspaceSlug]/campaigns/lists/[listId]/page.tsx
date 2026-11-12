import { notFound } from "next/navigation";
import { CampaignTabs } from "@/components/campaigns/CampaignTabs";
import { ListForm } from "@/components/campaigns/lists/ListForm";
import { Card, Chip, PageHeader, SectionHeading } from "@/components/ui/display";
import { prisma } from "@/lib/db";
import { getList } from "@/lib/campaigns/lists";
import { hostedFormUrl, subscribeEndpointUrl } from "@/lib/campaigns/public/urls";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Mailing list" };

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string; listId: string }> }) {
  const { workspaceSlug, listId } = await params;
  const { workspace } = await requireWorkspace(workspaceSlug, "ADMIN");
  const list = await getList(workspace.id, listId);
  if (!list) notFound();
  const counts = await Promise.all((["CONFIRMED", "UNCONFIRMED", "UNSUBSCRIBED"] as const).map((status) => prisma.listSubscription.count({ where: { workspaceId: workspace.id, listId, status } })));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={list.name} description={`${counts[0]} subscribed, ${counts[1]} waiting for confirmation, ${counts[2]} unsubscribed.`} actions={list.archivedAt ? <Chip>Archived</Chip> : undefined} />
      <CampaignTabs slug={workspaceSlug} />
      <ListForm slug={workspaceSlug} list={{ id: list.id, name: list.name, description: list.description, visibility: list.visibility, optIn: list.optIn, archived: Boolean(list.archivedAt) }} />
      {list.visibility === "PUBLIC" && !list.archivedAt ? (
        <section className="flex flex-col gap-3">
          <SectionHeading title="Sign-up form" description="Share the hosted page, or post a form of your own to the endpoint." />
          <Card><p className="text-label text-ink">Hosted page</p><p className="mt-1 break-all text-body-ui">{hostedFormUrl(workspace.slug, list.slug)}</p>
            <p className="mt-4 text-label text-ink">Form endpoint</p><p className="mt-1 break-all text-body-ui">POST {subscribeEndpointUrl()} with workspaceSlug={workspace.slug}, listSlug={list.slug}, email and a hidden ts value from the hosted page. Embedded forms are best served by linking to the hosted page.</p></Card>
        </section>
      ) : null}
    </div>
  );
}
