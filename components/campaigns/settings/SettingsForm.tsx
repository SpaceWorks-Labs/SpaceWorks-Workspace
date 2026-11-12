"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rotateBounceSecretAction, saveSettingsAction } from "@/app/actions/campaignSettings";
import type { CampaignSettingsView } from "@/lib/campaigns/settings";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { Field, Input, Textarea } from "@/components/ui/field";

export function SettingsForm({ slug, settings, sesUrl, postmarkUrl }: { slug: string; settings: CampaignSettingsView; sesUrl: string; postmarkUrl: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const check = (name: string, label: string, hint: string, value: boolean) => <label className="flex items-start gap-3 md:col-span-2"><input type="checkbox" name={name} defaultChecked={value} className="mt-1 size-5" /><span><span className="text-ink">{label}</span><span className="block text-caption text-ink-muted">{hint}</span></span></label>;
  return (
    <div className="min-w-0 space-y-6" aria-busy={pending}>
      <form className="grid gap-4 rounded-xl border border-line bg-panel p-6 md:grid-cols-2" onSubmit={(event) => {
        event.preventDefault();
        const fd = new FormData(event.currentTarget);
        const num = (n: string) => Number(fd.get(n));
        const on = (n: string) => fd.get(n) === "on";
        start(async () => {
          const r = await saveSettingsAction(slug, { trackOpens: on("trackOpens"), trackClicks: on("trackClicks"), individualTracking: on("individualTracking"), recordConsentIp: on("recordConsentIp"), sendPerMinute: num("sendPerMinute"), batchSize: num("batchSize"), maxErrors: num("maxErrors"), softBounceLimit: num("softBounceLimit"), footerAddress: String(fd.get("footerAddress") ?? ""), domainBlocklist: String(fd.get("domainBlocklist") ?? "") });
          setStatus({ ok: r.ok, text: r.ok ? "Settings saved." : r.error });
          if (r.ok) router.refresh();
        });
      }}>
        <Field label="Postal address for the email footer" helperText="Required before any campaign can be sent." className="md:col-span-2"><Textarea name="footerAddress" rows={2} maxLength={400} defaultValue={settings.footerAddress ?? ""} /></Field>
        {check("trackOpens", "Track opens", "Adds a tiny image to each email. Off by default; counts only.", settings.trackOpens)}
        {check("trackClicks", "Track clicks", "Rewrites links so clicks can be counted. Off by default.", settings.trackClicks)}
        {check("individualTracking", "Keep per-person engagement", "Records which message was opened or clicked, kept for 13 months. IP addresses and devices are never stored.", settings.individualTracking)}
        {check("recordConsentIp", "Record sign-up IP address", "Stored with the consent record when someone subscribes.", settings.recordConsentIp)}
        <Field label="Emails per minute"><Input name="sendPerMinute" type="number" min={1} max={600} defaultValue={settings.sendPerMinute} /></Field>
        <Field label="Batch size"><Input name="batchSize" type="number" min={1} max={200} defaultValue={settings.batchSize} /></Field>
        <Field label="Pause after this many errors in a row"><Input name="maxErrors" type="number" min={1} max={1000} defaultValue={settings.maxErrors} /></Field>
        <Field label="Soft bounces before blocklisting" helperText="Counted over 30 days. Hard bounces and complaints blocklist at once."><Input name="softBounceLimit" type="number" min={1} max={20} defaultValue={settings.softBounceLimit} /></Field>
        <Field label="Blocked email domains" optional helperText="One per line. Subdomains are included." className="md:col-span-2"><Textarea name="domainBlocklist" rows={4} defaultValue={settings.domainBlocklist.join("\n")} /></Field>
        <div className="md:col-span-2"><Button type="submit" variant="primary" disabled={pending}>Save settings</Button></div>
      </form>
      <p role="status" className={status && !status.ok ? "text-danger-fg" : "text-ink-secondary"}>{status?.text}</p>
      <section className="space-y-3 rounded-xl border border-line bg-panel p-6">
        <h2 className="text-h3">Bounce webhooks</h2>
        <p className="text-caption text-ink-muted">Send bounce and complaint events from your email provider. Send the secret as an <code>x-webhook-secret</code> header or as the Basic auth password. It is not accepted in the URL. It is shown once.</p>
        <p className="break-all text-body-ui">Postmark: {postmarkUrl}</p>
        <p className="break-all text-body-ui">Amazon SES (via SNS, HTTPS): {sesUrl}</p>
        <p className="text-caption text-ink-muted">For SES, Space Works never opens the SNS confirmation link by itself. Confirm the subscription from your AWS account.</p>
        {secret ? <Callout tone="success" title="Copy this secret now" role="status"><code className="break-all">{secret}</code></Callout> : null}
        <Button variant="secondary" disabled={pending} onClick={() => start(async () => { const r = await rotateBounceSecretAction(slug); if (r.ok && r.data) setSecret(r.data.secret); else setStatus({ ok: false, text: r.ok ? "" : r.error }); router.refresh(); })}>{settings.hasBounceSecret ? "Generate a new secret" : "Generate a secret"}</Button>
      </section>
    </div>
  );
}
