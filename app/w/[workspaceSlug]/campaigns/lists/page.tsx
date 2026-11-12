import Link from "next/link";
import { CampaignTabs } from "@/components/campaigns/CampaignTabs";
import { ListForm } from "@/components/campaigns/lists/ListForm";
import { Chip, EmptyState, PageHeader, SectionHeading } from "@/components/ui/display";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { listLists } from "@/lib/campaigns/lists";
import { canManageCampaigns } from "@/lib/campaigns/roles";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Mailing lists" };

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
  const lists = await listLists(workspace.id, { includeArchived: true });
  const canManage = canManageCampaigns(membership);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Email campaigns" description="Lists group the people you email." />
      <CampaignTabs slug={workspaceSlug} />
      {lists.length === 0 ? <EmptyState title="No lists yet.">Create a list to start collecting subscribers.</EmptyState> : (
        <Table label="Mailing lists">
          <THead><TR><TH>Name</TH><TH>Sign-up</TH><TH>Subscribed</TH><TH>Waiting</TH><TH>Unsubscribed</TH></TR></THead>
          <TBody>
            {lists.map((l) => (
              <TR key={l.id}>
                <TD>{canManage ? <Link className="text-accent-text underline" href={`/w/${workspaceSlug}/campaigns/lists/${l.id}`}>{l.name}</Link> : l.name}{l.archivedAt ? <Chip size="sm">Archived</Chip> : null}</TD>
                <TD>{l.visibility === "PUBLIC" ? "Public" : "Private"}, {l.optIn === "DOUBLE" ? "double opt-in" : "single opt-in"}</TD>
                <TD>{l.confirmed}</TD><TD>{l.unconfirmed}</TD><TD>{l.unsubscribed}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {canManage ? (<section className="flex flex-col gap-3"><SectionHeading title="New list" /><ListForm slug={workspaceSlug} /></section>) : null}
    </div>
  );
}
