"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MembershipStatus, WorkspaceRole } from "@prisma/client";
import { adminChangeRoleAction, adminRemoveMemberAction, adminSetMemberStatusAction } from "@/app/actions/adminOrgs";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/display";
import { Dropdown } from "@/components/ui/field";
import { TD, TR } from "@/components/ui/table";
import { WORKSPACE_ROLES } from "@/lib/roles";

export type MemberRowData = { id: string; name: string | null; email: string; role: WorkspaceRole; status: MembershipStatus };

export function OrgMemberRow({ workspaceId, member }: { workspaceId: string; member: MemberRowData }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const run = (task: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const result = await task();
      if (!result.ok) showToast(result.error ?? "Couldn't save. Try again.", "error");
      else router.refresh();
    });
  const base = { workspaceId, membershipId: member.id };
  return (
    <TR>
      <TD className="font-semibold">{member.name ?? "No name"}</TD>
      <TD className="text-ink-muted">{member.email}</TD>
      <TD>
        <Dropdown aria-label={`Role for ${member.email}`} value={member.role} disabled={pending} onChange={(e) => run(() => adminChangeRoleAction({ ...base, role: e.target.value }))}>
          {WORKSPACE_ROLES.map((role) => <option key={role} value={role}>{role.charAt(0) + role.slice(1).toLowerCase()}</option>)}
        </Dropdown>
      </TD>
      <TD>{member.status === "ACTIVE" ? <Chip tone="success" size="sm">Active</Chip> : <Chip tone="warning" size="sm">Suspended</Chip>}</TD>
      <TD className="whitespace-nowrap text-right">
        <Button size="sm" variant="secondary" loading={pending} onClick={() => run(() => adminSetMemberStatusAction({ ...base, status: member.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" }))}>
          {member.status === "ACTIVE" ? "Suspend" : "Reactivate"}
        </Button>{" "}
        <Button size="sm" variant="dangerOutline" loading={pending} onClick={() => { if (window.confirm(`Remove ${member.email} from this organisation?`)) run(() => adminRemoveMemberAction(base)); }}>Remove</Button>
      </TD>
    </TR>
  );
}
