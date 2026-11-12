"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/feedback/ToastProvider";
import { sendTestAction } from "@/app/actions/campaigns";

export function TestSendDialog({ slug, campaignId, open, onClose }: { slug: string; campaignId: string; open: boolean; onClose: () => void }) {
  const { showToast } = useToast();
  const [extra, setExtra] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      const list = extra.split(/[\s,;]+/).filter(Boolean);
      const result = await sendTestAction(slug, campaignId, { extra: list });
      if (!result.ok) return setError(result.error);
      setError("");
      showToast(`Test sent to ${result.data?.sent ?? 1} ${result.data?.sent === 1 ? "address" : "addresses"}`, "success");
      onClose();
    });
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader title="Send a test" description="The test goes to you, plus up to 5 other addresses. Save your changes first." />
        <DialogBody>
          <Field label="Other addresses" optional error={error} helperText="Separate with spaces or commas.">
            <Textarea rows={3} value={extra} onChange={(event) => setExtra(event.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={submit}>Send test</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
