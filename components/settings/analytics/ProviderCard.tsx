"use client";

import { useState, useTransition } from "react";
import { saveWorkspaceAnalytics } from "@/app/actions/workspaceObservability";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/display";
import { Field, Input, controlClasses } from "@/components/ui/field";
import type { ProviderView } from "@/lib/observability/workspaceStore";
import { MODE_LABEL, modesFor, PROVIDER_COPY } from "./providerMeta";

type Props = { slug: string; view: ProviderView; isOwner: boolean; editable: boolean; instanceActive: boolean; hostAllowlist: string[] };

export function ProviderCard({ slug, view, isOwner, editable, instanceActive, hostAllowlist }: Props) {
  const { provider } = view;
  const copy = PROVIDER_COPY[provider];
  const [mode, setMode] = useState(view.mode);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const clarityLocked = provider === "clarity" && !isOwner;
  const disabled = !editable || pending;

  const effective = view.effective.active ? "Sending data" : view.effective.source === "linkout" ? "Link only" : "Not sending";
  return (
    <form
      className="flex flex-col gap-4 rounded-xl border border-line bg-panel p-6"
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        const fd = new FormData(event.currentTarget);
        const text = (name: string) => String(fd.get(name) ?? "");
        start(async () => {
          const result = await saveWorkspaceAnalytics(slug, {
            provider, mode, acknowledged: fd.get("acknowledged") === "on",
            key: text("key"), host: text("host"), projectId: text("projectId"), url: text("url"), siteUrl: text("siteUrl"),
            dashboardIds: text("dashboardIds"), secret: text("secret"), clearSecret: fd.get("clearSecret") === "on",
          });
          setStatus({ ok: result.ok, text: result.ok ? "Saved." : result.error });
        });
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-h3 text-ink">{copy.title}</h2>
          <p className="text-caption text-ink-secondary">{copy.blurb}</p>
        </div>
        <Chip tone={view.effective.active ? "success" : "neutral"}>{effective}</Chip>
      </div>
      {!editable ? <p className="text-caption text-ink-secondary">{instanceActive ? "Following the instance setting." : "Not configured on this instance."}</p> : null}
      {clarityLocked ? <p className="text-caption text-ink-secondary">Only a workspace owner can turn Clarity on. You can still turn it off.</p> : null}
      <Field label="Setting">
        <select name="mode" className={controlClasses} value={mode} disabled={disabled} onChange={(event) => setMode(event.target.value)}>
          {modesFor(provider).filter((m) => !(clarityLocked && m !== "off" && view.mode === "off")).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
        </select>
      </Field>
      {mode === "own" && provider === "posthog" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Project key" helperText="Starts with phc_."><Input name="key" defaultValue={view.fields.key} disabled={disabled} maxLength={120} autoComplete="off" /></Field>
          <Field label="Host" helperText={hostAllowlist.length ? `Allowed hosts: ${hostAllowlist.join(", ")}` : "No hosts are allowed yet. Ask the instance admin."}><Input name="host" defaultValue={view.fields.host} disabled={disabled} maxLength={255} placeholder="https://eu.i.posthog.com" /></Field>
        </div>
      ) : null}
      {mode === "own" && provider === "clarity" ? (
        <Field label="Project id"><Input name="projectId" defaultValue={view.fields.projectId} disabled={disabled} maxLength={40} autoComplete="off" /></Field>
      ) : null}
      {mode === "own" && provider === "metabase" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Site URL" helperText={hostAllowlist.length ? `Allowed hosts: ${hostAllowlist.join(", ")}` : "No hosts are allowed yet. Ask the instance admin."}><Input name="siteUrl" defaultValue={view.fields.siteUrl} disabled={disabled} maxLength={255} placeholder="https://metabase.example.org" /></Field>
          <Field label="Dashboard ids" helperText="Numbers, separated by commas. Only these can be embedded."><Input name="dashboardIds" defaultValue={view.fields.dashboardIds} disabled={disabled} maxLength={300} /></Field>
          <Field label="Embedding secret" helperText={view.hasSecret ? "Saved. Leave blank to keep it." : "Encrypted and never shown again."}><Input name="secret" type="password" disabled={disabled} maxLength={2000} autoComplete="new-password" placeholder={view.hasSecret ? "Saved" : undefined} /></Field>
          {view.hasSecret ? <label className="flex items-center gap-2 self-end"><input type="checkbox" name="clearSecret" disabled={disabled} /> Remove the saved secret</label> : null}
        </div>
      ) : null}
      {mode === "linkout" ? (
        <Field label="Link"><Input name="url" type="url" defaultValue={view.fields.url} disabled={disabled} maxLength={2000} placeholder="https://" /></Field>
      ) : null}
      {mode !== "off" ? (
        <label className="flex items-start gap-2 text-body-ui">
          <input type="checkbox" name="acknowledged" className="mt-1" defaultChecked={view.acknowledged} disabled={disabled} required />
          <span>I am responsible for telling members this workspace uses this tool.</span>
        </label>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={disabled || (clarityLocked && mode !== "off")}>Save</Button>
        {view.effective.linkUrl ? <a className="text-link" href={view.effective.linkUrl} target="_blank" rel="noopener noreferrer">Open {copy.title}</a> : null}
        <p role="status" className={status && !status.ok ? "text-danger-fg" : "text-ink-secondary"}>{status?.text ?? view.effective.reason ?? ""}</p>
      </div>
    </form>
  );
}
