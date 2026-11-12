"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { CheckboxField, SegmentedControl, SwitchRow } from "@/components/ui/choice";
import { Dropdown, Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/feedback/ToastProvider";
import { saveCampaignAction } from "@/app/actions/campaigns";
import { BodyEditor } from "@/components/campaigns/editor/BodyEditor";
import { CampaignPreview } from "@/components/campaigns/editor/Preview";
import { SendDialog } from "@/components/campaigns/editor/SendDialog";
import { TestSendDialog } from "@/components/campaigns/editor/TestSendDialog";

type ContentType = "RICHTEXT" | "MARKDOWN" | "HTML" | "PLAIN";
export type EditorCampaign = { id: string; name: string; subject: string; fromName: string; replyTo: string | null; contentType: ContentType; bodySource: string; templateId: string | null; listIds: string[]; trackOpens: boolean; trackClicks: boolean; individualTracking: boolean };
export type EditorProps = {
  slug: string;
  campaign: EditorCampaign | null;
  defaults: { fromName: string; templateId: string | null };
  lists: Array<{ id: string; name: string; confirmed: number }>;
  templates: Array<{ id: string; name: string }>;
  canSend: boolean;
  canHtml: boolean;
  tracking: { trackOpens: boolean; trackClicks: boolean; individualTracking: boolean };
  sharedSmtp: boolean;
};

export function CampaignEditor({ slug, campaign, defaults, lists, templates, canSend, canHtml, tracking, sharedSmtp }: EditorProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, start] = useTransition();
  const [form, setForm] = useState<Omit<EditorCampaign, "id">>({
    name: campaign?.name ?? "", subject: campaign?.subject ?? "", fromName: campaign?.fromName ?? defaults.fromName, replyTo: campaign?.replyTo ?? "",
    contentType: campaign?.contentType ?? "RICHTEXT", bodySource: campaign?.bodySource ?? "", templateId: campaign?.templateId ?? defaults.templateId,
    listIds: campaign?.listIds ?? [], trackOpens: campaign?.trackOpens ?? tracking.trackOpens, trackClicks: campaign?.trackClicks ?? tracking.trackClicks,
    individualTracking: campaign?.individualTracking ?? tracking.individualTracking,
  });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState("");
  const [dialog, setDialog] = useState<"test" | "send" | null>(null);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));
  const error = (key: string) => errors[key]?.[0];

  const save = (after?: (id: string) => void) =>
    start(async () => {
      const result = await saveCampaignAction(slug, campaign?.id ?? null, form);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        return setFormError(result.error);
      }
      setErrors({});
      setFormError("");
      showToast("Draft saved", "success");
      const id = result.data!.id;
      if (after) after(id);
      else if (!campaign) router.replace(`/w/${slug}/campaigns/${id}`);
      else router.refresh();
    });

  const types = [{ value: "RICHTEXT", label: "Rich text" }, { value: "MARKDOWN", label: "Markdown" }, { value: "PLAIN", label: "Plain text" }, ...(canHtml ? [{ value: "HTML", label: "HTML" }] : [])] as Array<{ value: ContentType; label: string }>;

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="flex flex-col gap-5">
        {sharedSmtp ? <Callout tone="warning">No email server is set up for this workspace, so each campaign is limited to 500 recipients.</Callout> : null}
        {formError ? <Callout tone="danger" role="alert">{formError}</Callout> : null}
        <Field label="Campaign name" error={error("name")} helperText="Only your team sees this."><Input value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={120} /></Field>
        <Field label="Subject" error={error("subject")}><Input value={form.subject} onChange={(e) => set("subject", e.target.value)} maxLength={200} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From name" error={error("fromName")}><Input value={form.fromName} onChange={(e) => set("fromName", e.target.value)} maxLength={100} /></Field>
          <Field label="Reply-to" optional error={error("replyTo")}><Input type="email" value={form.replyTo ?? ""} onChange={(e) => set("replyTo", e.target.value)} /></Field>
        </div>
        <fieldset className="flex flex-col gap-1">
          <legend className="text-label text-ink">Lists</legend>
          {lists.length === 0 ? <p className="text-body-ui text-ink-muted">No lists yet. Create one under Lists first.</p> : null}
          {lists.map((list) => (
            <CheckboxField
              key={list.id}
              label={list.name}
              description={`${list.confirmed} confirmed`}
              checked={form.listIds.includes(list.id)}
              onCheckedChange={(on) => set("listIds", on === true ? [...form.listIds, list.id] : form.listIds.filter((id) => id !== list.id))}
            />
          ))}
        </fieldset>
        <Field label="Template">
          <Dropdown value={form.templateId ?? ""} onChange={(e) => set("templateId", e.target.value || null)}>
            <option value="">Built-in default</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Dropdown>
        </Field>
        <div className="flex flex-col gap-2">
          <span className="text-label text-ink">Content</span>
          <SegmentedControl ariaLabel="Content type" value={form.contentType} options={types} onValueChange={(value) => set("contentType", value)} />
          <BodyEditor key={form.contentType} contentType={form.contentType} value={form.bodySource} onChange={(next) => set("bodySource", next)} />
          <p className="text-caption text-ink-muted">Placeholders: {"{{name}} {{first_name}} {{email}} {{workspace_name}} {{attr.key}}"}. The footer and unsubscribe link are added for you.</p>
        </div>
        {tracking.trackOpens || tracking.trackClicks ? (
          <div className="flex flex-col gap-1">
            {tracking.trackOpens ? <SwitchRow label="Track opens" description="Counts opens with a tiny image." checked={form.trackOpens} onCheckedChange={(v) => set("trackOpens", v)} /> : null}
            {tracking.trackClicks ? <SwitchRow label="Track clicks" description="Links go through a redirect so clicks can be counted." checked={form.trackClicks} onCheckedChange={(v) => set("trackClicks", v)} /> : null}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" loading={pending} onClick={() => save()}>Save draft</Button>
          <Button disabled={pending} onClick={() => (campaign ? save(() => setDialog("test")) : save((id) => router.replace(`/w/${slug}/campaigns/${id}`)))}>Send test</Button>
          {canSend && campaign ? <Button variant="accent" disabled={pending} onClick={() => save(() => setDialog("send"))}>Schedule or send</Button> : null}
        </div>
      </div>
      <CampaignPreview slug={slug} input={{ contentType: form.contentType, bodySource: form.bodySource, templateId: form.templateId }} />
      {campaign ? (
        <>
          <TestSendDialog slug={slug} campaignId={campaign.id} open={dialog === "test"} onClose={() => setDialog(null)} />
          <SendDialog slug={slug} campaignId={campaign.id} open={dialog === "send"} onClose={() => setDialog(null)} />
        </>
      ) : null}
    </div>
  );
}
