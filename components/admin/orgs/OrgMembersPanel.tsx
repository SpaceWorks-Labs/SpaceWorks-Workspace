import { OrgMemberRow } from "@/components/admin/orgs/OrgMemberRow";
import { Table, TBody, TH, THead } from "@/components/ui/table";
import type { loadOrgMembers } from "@/lib/admin/orgDetail";

export function OrgMembersPanel({ workspaceId, members }: { workspaceId: string; members: Awaited<ReturnType<typeof loadOrgMembers>> }) {
  return (
    <Table label="Members">
      <THead>
        <tr><TH>Name</TH><TH>Email</TH><TH>Role</TH><TH>Status</TH><TH><span className="sr-only">Actions</span></TH></tr>
      </THead>
      <TBody>
        {members.map((member) => (
          <OrgMemberRow key={member.id} workspaceId={workspaceId} member={{ id: member.id, name: member.user.name, email: member.user.email, role: member.role, status: member.status }} />
        ))}
      </TBody>
    </Table>
  );
}
