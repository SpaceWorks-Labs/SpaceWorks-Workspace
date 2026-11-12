"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { archiveListAction, createListAction, deleteListAction, updateListAction } from "@/app/actions/campaignLists";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, Dropdown } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/dialog";

type ListValues = { id: string; name: string; description: string | null; visibility: "PUBLIC" | "PRIVATE"; optIn: "SINGLE" | "DOUBLE"; archived: boolean };

/** Create a list, or edit one (with archive and delete). */
export function ListForm({ slug, list }: { slug: string; list?: ListValues }) {
  const router = useRouter();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();
  const report = (r: { ok: boolean; error?: string; fieldErrors?: Record<string, string[]> }, done: string, after?: () => void) => {
    setErrors(r.fieldErrors ?? {});
    setStatus({ ok: r.ok, text: r.ok ? done : (r.error ?? "Couldn't save. Try again.") });
    if (r.ok) after?.();
  };
  return (
    <div className="min-w-0 space-y-4" aria-busy={pending}>
      <form
        className="grid gap-4 rounded-xl border border-line bg-panel p-6 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const fd = new FormData(form);
          const input = { name: String(fd.get("name") ?? ""), description: String(fd.get("description") ?? ""), visibility: String(fd.get("visibility")), optIn: String(fd.get("optIn")) };
          start(async () => {
            if (list) report(await updateListAction(slug, list.id, input), "List saved.", () => router.refresh());
            else report(await createListAction(slug, input), "List created.", () => { form.reset(); router.refresh(); });
          });
        }}
      >
        <Field label="Name" error={errors.name?.[0]}><Input name="name" required maxLength={80} defaultValue={list?.name} /></Field>
        <Field label="Who can join" helperText="Public lists get a sign-up page and show on preference pages."><Dropdown name="visibility" defaultValue={list?.visibility ?? "PRIVATE"}><option value="PRIVATE">Private: admins add people</option><option value="PUBLIC">Public: anyone can sign up</option></Dropdown></Field>
        <Field label="Description" optional className="md:col-span-2"><Textarea name="description" rows={2} maxLength={500} defaultValue={list?.description ?? ""} /></Field>
        <Field label="Sign-up confirmation" helperText="Applies to people you add or import. Public sign-ups and the preferences page always send a confirmation email first."><Dropdown name="optIn" defaultValue={list?.optIn ?? "DOUBLE"}><option value="DOUBLE">Double opt-in (recommended)</option><option value="SINGLE">Single opt-in (admin-added and imported)</option></Dropdown></Field>
        <div className="flex flex-wrap items-end gap-3 md:col-span-2">
          <Button type="submit" variant="primary" disabled={pending}>{list ? "Save list" : "Create list"}</Button>
          {list ? <Button variant="secondary" disabled={pending} onClick={() => start(async () => report(await archiveListAction(slug, list.id, !list.archived), list.archived ? "List restored." : "List archived.", () => router.refresh()))}>{list.archived ? "Restore list" : "Archive list"}</Button> : null}
          {list ? <Button variant="dangerOutline" disabled={pending} onClick={() => setConfirmDelete(true)}>Delete list</Button> : null}
        </div>
      </form>
      <p role="status" className={status && !status.ok ? "text-danger-fg" : "text-ink-secondary"}>{status?.text}</p>
      {list ? (
        <ConfirmDialog open={confirmDelete} title="Delete this list?" message="Its subscriptions are removed. Subscribers stay in your audience. This can't be undone." confirmLabel="Delete list" loading={pending}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => start(async () => { const r = await deleteListAction(slug, list.id); setConfirmDelete(false); report(r, "List deleted.", () => router.push(`/w/${slug}/campaigns/lists`)); })} />
      ) : null}
    </div>
  );
}
