"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { WorkspaceStatus } from "@prisma/client";
import { reactivateOrgAction, suspendOrgAction, transferOwnershipAction } from "@/app/actions/adminOrgs";
import { WorkspaceArchiveButton } from "@/components/admin/AdminRowActions";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/display";
import { Dropdown, Field, Textarea } from "@/components/ui/field";
import { CheckboxField } from "@/components/ui/choice";

type Candidate = { id: string; label: string };

export function OrgActions({ workspaceId, status, archived, candidates }: { workspaceId: string; status: WorkspaceStatus; archived: boolean; candidates: Candidate[] }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState("");
  const [demote, setDemote] = useState(false);

  const run = (task: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) =>
    startTransition(async () => {
      const result = await task();
      if (!result.ok) showToast(result.error ?? "Couldn't save. Try again.", "error");
      else { showToast(success, "success"); after?.(); router.refresh(); }
    });

  return (
    <Card>
      <CardHeader title="Actions" description="Every change here is recorded in the organisation's audit log." />
      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          {status === "ACTIVE" ? (
            <>
              <Field label="Reason for suspending" helperText="Owners and admins see this on their plan page; everyone else loses access.">
                <Textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <Button variant="dangerOutline" loading={pending} className="self-start" onClick={() => run(() => suspendOrgAction({ workspaceId, reason }), "Organisation suspended.", () => setReason(""))}>Suspend organisation</Button>
            </>
          ) : null}
          {status === "SUSPENDED" ? (
            <Button variant="primary" loading={pending} className="self-start" onClick={() => run(() => reactivateOrgAction({ workspaceId }), "Organisation reactivated.")}>Reactivate organisation</Button>
          ) : null}
          <div><WorkspaceArchiveButton workspaceId={workspaceId} archived={archived} /></div>
        </div>
        <div className="flex flex-col gap-3">
          <Field label="Make this member an owner" helperText="Only active members can be chosen.">
            <Dropdown value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="" disabled>Choose a member</option>
              {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
            </Dropdown>
          </Field>
          <CheckboxField label="Make the other owners admins" checked={demote} onCheckedChange={(value) => setDemote(value === true)} />
          <Button variant="secondary" loading={pending} disabled={!target} className="self-start" onClick={() => run(() => transferOwnershipAction({ workspaceId, membershipId: target, demoteOthers: demote }), "Ownership updated.", () => setTarget(""))}>Transfer ownership</Button>
        </div>
      </div>
    </Card>
  );
}
