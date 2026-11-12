"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/feedback/ToastProvider";
import { campaignLifecycleAction, checklistAction } from "@/app/actions/campaigns";

type Checklist = { items: Array<{ key: string; label: string; ok: boolean; blocking: boolean; detail?: string }>; effectiveRecipients: number; canSend: boolean };

/** Pre-send checklist plus the final confirmation: "Send to N subscribers on <date>?". */
export function SendDialog(props: { slug: string; campaignId: string; open: boolean; onClose: () => void }) {
  return props.open ? <SendDialogBody {...props} /> : null;
}

function SendDialogBody({ slug, campaignId, open, onClose }: { slug: string; campaignId: string; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [when, setWhen] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    void checklistAction(slug, campaignId).then((result) => (result.ok ? setChecklist(result.data ?? null) : setError(result.error)));
  }, [slug, campaignId]);

  const date = when ? new Date(when) : null;
  const label = date && !Number.isNaN(date.getTime()) ? date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "now";
  const submit = () =>
    start(async () => {
      const result = await campaignLifecycleAction(slug, campaignId, "schedule", label === "now" ? null : date!.toISOString());
      if (!result.ok) return setError(result.error);
      showToast(label === "now" ? "Sending started" : "Campaign scheduled", "success");
      onClose();
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader title="Ready to send?" description="Check the list below, then confirm." />
        <DialogBody>
          <ul className="flex flex-col gap-2" aria-label="Pre-send checklist">
            {checklist?.items.map((item) => (
              <li key={item.key} className="text-body-ui text-ink">
                <span className="font-semibold">{item.ok ? "Done" : item.blocking ? "Fix" : "Heads up"}</span>: {item.label}
                {item.detail ? <span className="block text-caption text-ink-muted">{item.detail}</span> : null}
              </li>
            )) ?? <li className="text-ink-muted">Checking...</li>}
          </ul>
          <Field label="Send at" optional className="mt-4" helperText="Leave empty to send now. Times use your device time zone.">
            <Input type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} />
          </Field>
          {error ? <p role="alert" className="mt-3 text-caption text-danger-fg">{error}</p> : null}
          {checklist?.canSend ? <p className="mt-4 text-body-ui font-semibold text-ink">Send to {checklist.effectiveRecipients} subscribers {label === "now" ? "now" : `on ${label}`}?</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!checklist?.canSend} loading={pending} onClick={submit}>{label === "now" ? "Send now" : "Schedule"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
