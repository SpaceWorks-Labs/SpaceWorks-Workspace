"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addSubscriberAction, exportSubscribersAction } from "@/app/actions/campaignSubscribers";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export function AddSubscriber({ slug, lists }: { slug: string; lists: { id: string; name: string }[] }) {
  const router = useRouter();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const download = () => start(async () => {
    const r = await exportSubscribersAction(slug);
    if (!r.ok || !r.data) return setStatus({ ok: false, text: r.ok ? "Nothing to export." : r.error });
    const url = URL.createObjectURL(new Blob([r.data.content], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: r.data.filename });
    a.click();
    URL.revokeObjectURL(url);
    setStatus({ ok: true, text: `Exported ${r.data.count} subscribers.` });
  });
  return (
    <div className="space-y-3">
      <form className="grid gap-4 rounded-xl border border-line bg-panel p-6 md:grid-cols-2" onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const fd = new FormData(form);
        start(async () => {
          const r = await addSubscriberAction(slug, { email: String(fd.get("email") ?? ""), name: String(fd.get("name") ?? ""), listIds: fd.getAll("list").map(String), attest: fd.get("attest") === "on" ? true : false });
          setStatus({ ok: r.ok, text: r.ok ? "Subscriber added." : r.error });
          if (r.ok) { form.reset(); router.refresh(); }
        });
      }}>
        <Field label="Email address"><Input name="email" type="email" required maxLength={254} /></Field>
        <Field label="Name" optional><Input name="name" maxLength={160} /></Field>
        <fieldset className="md:col-span-2"><legend className="text-label text-ink">Add to lists</legend>
          <div className="mt-1 flex flex-wrap gap-4">{lists.map((l) => <label key={l.id} className="flex min-h-11 items-center gap-2"><input type="checkbox" name="list" value={l.id} />{l.name}</label>)}</div></fieldset>
        <label className="flex items-center gap-2 md:col-span-2"><input type="checkbox" name="attest" required /> I have permission to email this person</label>
        <div className="flex flex-wrap gap-3 md:col-span-2">
          <Button type="submit" variant="primary" disabled={pending}>Add subscriber</Button>
          <Button variant="secondary" disabled={pending} onClick={download}>Export all as CSV</Button>
        </div>
      </form>
      <p role="status" className={status && !status.ok ? "text-danger-fg" : "text-ink-secondary"}>{status?.text}</p>
    </div>
  );
}
