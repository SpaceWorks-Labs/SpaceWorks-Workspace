"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Callout, Chip } from "@/components/ui/display";
import { ConfirmDialog } from "@/components/ui/dialog";
import { SwitchRow } from "@/components/ui/choice";
import { Field, Input, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/feedback/ToastProvider";
import { deleteTemplateAction, saveTemplateAction } from "@/app/actions/campaignTemplates";

type Template = { id: string; name: string; subject: string | null; bodyHtml: string; isDefault: boolean };
type Draft = { id: string | null; name: string; subject: string; bodyHtml: string; isDefault: boolean };

const blank = (builtIn: string): Draft => ({ id: null, name: "", subject: "", bodyHtml: builtIn, isDefault: false });

/** Workspace templates: list, edit, preview (sandboxed), default switch. The built-in default is always available. */
export function TemplateManager({ slug, templates, builtInHtml, canDelete }: { slug: string; templates: Template[]; builtInHtml: string; canDelete: boolean }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<Template | null>(null);

  const save = () =>
    start(async () => {
      const result = await saveTemplateAction(slug, draft!.id, { name: draft!.name, subject: draft!.subject, bodyHtml: draft!.bodyHtml, isDefault: draft!.isDefault });
      if (!result.ok) return setError(result.error);
      showToast("Template saved", "success");
      setDraft(null);
      setError("");
      router.refresh();
    });
  const remove = () =>
    start(async () => {
      const result = await deleteTemplateAction(slug, removing!.id);
      setRemoving(null);
      if (!result.ok) return showToast(result.error, "error");
      showToast("Template deleted", "success");
      router.refresh();
    });

  if (draft) {
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
          <Field label="Name"><Input value={draft.name} maxLength={100} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
          <Field label="Default subject" optional><Input value={draft.subject} maxLength={200} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></Field>
          <Field label="HTML" helperText="Put {{content}} where the campaign body should go. Scripts, forms and styles tags are removed.">
            <Textarea rows={14} className="text-sm" value={draft.bodyHtml} onChange={(e) => setDraft({ ...draft, bodyHtml: e.target.value })} />
          </Field>
          <SwitchRow label="Use for new campaigns" checked={draft.isDefault} onCheckedChange={(v) => setDraft({ ...draft, isDefault: v })} />
          <div className="flex gap-2">
            <Button variant="primary" loading={pending} onClick={save}>Save template</Button>
            <Button onClick={() => { setDraft(null); setError(""); }}>Cancel</Button>
          </div>
        </div>
        <iframe title="Template preview" sandbox="" srcDoc={draft.bodyHtml.replace("{{content}}", "<p>Your campaign content appears here.</p>")} className="h-[480px] w-full rounded-lg border border-line bg-white" />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div><Button variant="primary" onClick={() => setDraft(blank(builtInHtml))}>New template</Button></div>
      <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-panel">
        <li className="flex items-center justify-between gap-3 px-4 py-3"><span className="text-body-ui text-ink">Default (built in)</span><Chip>Built in</Chip></li>
        {templates.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <span className="flex items-center gap-2 text-body-ui text-ink">{t.name}{t.isDefault ? <Chip tone="accent" size="sm">Default</Chip> : null}</span>
            <span className="flex gap-2">
              <Button size="sm" onClick={() => setDraft({ id: t.id, name: t.name, subject: t.subject ?? "", bodyHtml: t.bodyHtml, isDefault: t.isDefault })}>Edit</Button>
              {canDelete ? <Button size="sm" variant="danger" onClick={() => setRemoving(t)}>Delete</Button> : null}
            </span>
          </li>
        ))}
      </ul>
      <ConfirmDialog open={removing !== null} title="Delete this template?" message="Campaigns that use it fall back to the built-in default." loading={pending} onConfirm={remove} onCancel={() => setRemoving(null)} />
    </div>
  );
}
