"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CampaignStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/feedback/ToastProvider";
import { campaignLifecycleAction, deleteCampaignAction, duplicateCampaignAction } from "@/app/actions/campaigns";

/** Pause, resume, cancel, unschedule, duplicate and delete for a campaign that has left the draft stage. */
export function CampaignControls({ slug, id, status, canSend }: { slug: string; id: string; status: CampaignStatus; canSend: boolean }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<"cancel" | "delete" | null>(null);

  const run = (task: () => Promise<{ ok: boolean; error?: string }>, done: string, after?: () => void) =>
    start(async () => {
      const result = await task();
      setConfirm(null);
      if (!result.ok) return showToast(result.error ?? "Couldn't do that. Try again.", "error");
      showToast(done, "success");
      if (after) after();
      else router.refresh();
    });
  const lifecycle = (op: "pause" | "resume" | "cancel" | "unschedule", done: string) => run(() => campaignLifecycleAction(slug, id, op), done);

  return (
    <div className="flex flex-wrap gap-2">
      {canSend && status === "RUNNING" ? <Button loading={pending} onClick={() => lifecycle("pause", "Campaign paused")}>Pause</Button> : null}
      {canSend && status === "PAUSED" ? <Button variant="primary" loading={pending} onClick={() => lifecycle("resume", "Campaign resumed")}>Resume</Button> : null}
      {canSend && status === "SCHEDULED" ? <Button loading={pending} onClick={() => lifecycle("unschedule", "Moved back to draft")}>Unschedule</Button> : null}
      {canSend && ["SCHEDULED", "RUNNING", "PAUSED"].includes(status) ? <Button variant="danger" onClick={() => setConfirm("cancel")}>Cancel campaign</Button> : null}
      <Button loading={pending} onClick={() => run(() => duplicateCampaignAction(slug, id), "Campaign duplicated")}>Duplicate</Button>
      {status === "CANCELLED" ? <Button variant="danger" onClick={() => setConfirm("delete")}>Delete</Button> : null}
      <ConfirmDialog
        open={confirm === "cancel"}
        title="Cancel this campaign?"
        message="Messages that have not been sent yet are skipped. This cannot be undone."
        confirmLabel="Cancel campaign"
        cancelLabel="Keep sending"
        loading={pending}
        onConfirm={() => lifecycle("cancel", "Campaign cancelled")}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        title="Delete this campaign?"
        message="Its statistics are removed too."
        loading={pending}
        onConfirm={() => run(() => deleteCampaignAction(slug, id), "Campaign deleted", () => router.push(`/w/${slug}/campaigns`))}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
