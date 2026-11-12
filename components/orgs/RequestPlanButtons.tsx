"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestFeature, requestMoreLimit } from "@/app/actions/orgRequests";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";

function useSend(run: (message: string, amount: string) => ReturnType<typeof requestFeature>) {
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  const submit = () => startTransition(async () => {
    const result = await run(message, amount);
    if (!result.ok) { setError(result.error); return; }
    setError(undefined); setOpen(false); setMessage(""); setAmount("");
    showToast("Request sent to the instance admin.", "success");
    router.refresh();
  });
  return { open, setOpen, message, setMessage, amount, setAmount, error, pending, submit };
}

function Form({ state, amountLabel, amountHint }: { state: ReturnType<typeof useSend>; amountLabel?: string; amountHint?: string }) {
  return (
    <form className="mt-3 flex max-w-md flex-col gap-3" onSubmit={(event) => { event.preventDefault(); state.submit(); }}>
      {amountLabel ? (
        <Field label={amountLabel} helperText={amountHint} error={state.error}>
          <Input inputMode="numeric" value={state.amount} onChange={(e) => state.setAmount(e.target.value)} />
        </Field>
      ) : state.error ? <p role="alert" className="text-caption text-danger-fg">{state.error}</p> : null}
      <Field label="Reason" optional><Textarea rows={2} maxLength={1000} value={state.message} onChange={(e) => state.setMessage(e.target.value)} /></Field>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" loading={state.pending}>Send request</Button>
        <Button size="sm" onClick={() => state.setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}

/** "Request more" for one limit. Byte limits are entered in MB. */
export function RequestMoreButton({ slug, limit, label, unit }: { slug: string; limit: string; label: string; unit: "count" | "bytes" }) {
  const state = useSend((message, amount) => requestMoreLimit(slug, { limit, requested: unit === "bytes" ? Math.round(Number(amount) * 1024 * 1024) : Number(amount), message }));
  return (
    <div>
      {!state.open ? <Button size="sm" onClick={() => state.setOpen(true)} aria-label={`Request more ${label}`}>Request more</Button> : <Form state={state} amountLabel={`New ${label.toLowerCase()} limit${unit === "bytes" ? " (MB)" : ""}`} amountHint="The number you would like to have in total." />}
    </div>
  );
}

export function RequestAccessButton({ slug, module, label }: { slug: string; module: string; label: string }) {
  const state = useSend((message) => requestFeature(slug, { module, message }));
  return (
    <div>
      {!state.open ? <Button size="sm" onClick={() => state.setOpen(true)} aria-label={`Request access to ${label}`}>Request access</Button> : <Form state={state} />}
    </div>
  );
}
