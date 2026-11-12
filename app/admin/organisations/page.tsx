import Link from "next/link";
import { Pager } from "@/components/admin/Pager";
import { OrgFilters } from "@/components/admin/orgs/OrgFilters";
import { OrgStatusChip } from "@/components/admin/orgs/OrgStatusChip";
import { OrgUsageBars } from "@/components/admin/orgs/OrgUsageBars";
import { CreateWorkspaceForm } from "@/components/admin/CreateWorkspaceForm";
import { Chip, EmptyState, PageHeader } from "@/components/ui/display";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { listOrganisations } from "@/lib/admin/orgList";
import { formatDate, viewerTimeZone } from "@/lib/format/datetime";
import { requireSuperAdminMfa } from "@/lib/permissions";

export const metadata = { title: "Organisations" };

type SearchParams = { status?: string; q?: string; page?: string };

export default async function AdminOrganisationsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireSuperAdminMfa();
  const params = await searchParams;
  const { rows, total, page, pages } = await listOrganisations({ status: params.status, q: params.q, page: Number(params.page) || 1 });
  const tz = viewerTimeZone();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Organisations" description={`${total} found. Names, owners and usage only; content stays private to members.`} />
      <OrgFilters status={params.status} q={params.q} />
      {rows.length === 0 ? (
        <EmptyState title="No organisations match.">Clear the search or choose another status.</EmptyState>
      ) : (
        <Table label="Organisations">
          <THead>
            <tr><TH>Organisation</TH><TH>Status</TH><TH>Owners</TH><TH>People</TH><TH>Usage</TH><TH>Created</TH></tr>
          </THead>
          <TBody>
            {rows.map((org) => (
              <TR key={org.id}>
                <TD>
                  <Link href={`/admin/organisations/${org.id}`} className="block font-semibold underline-offset-4 hover:underline">{org.name}</Link>
                  <span className="block text-caption text-ink-muted">/w/{org.slug}</span>
                  {org.limits.plan ? <Chip tone="outline" size="sm" className="mt-1">{org.limits.plan}</Chip> : null}
                </TD>
                <TD><OrgStatusChip status={org.status} />{org.archived ? <Chip tone="neutral" size="sm" className="ml-1">Archived</Chip> : null}</TD>
                <TD>{org.owners.length === 0 ? <span className="text-ink-muted">None</span> : org.owners.map((owner) => <span key={owner.email} className="block"><span className="font-semibold">{owner.name ?? "No name"}</span> <span className="text-caption text-ink-muted">{owner.email}</span></span>)}</TD>
                <TD className="whitespace-nowrap tabular-nums">{org.usage.members} members, {org.usage.guests} guests</TD>
                <TD><OrgUsageBars usage={org.usage} limits={org.limits} /></TD>
                <TD className="whitespace-nowrap text-ink-muted">{formatDate(org.createdAt, tz)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <Pager basePath="/admin/organisations" params={{ status: params.status, q: params.q }} page={page} pages={pages} />
      <CreateWorkspaceForm />
    </div>
  );
}
