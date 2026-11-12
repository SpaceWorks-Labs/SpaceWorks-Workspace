"use client";
import { useState, useTransition } from "react";
import { updateEmailSettings } from "@/app/actions/emailSettings";
import type { WorkspaceEmailSettingsView } from "@/lib/email/workspaceSettings";
import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export function EmailSettings({ slug, adminEmail, settings, verifiedLabel }: { slug: string; adminEmail: string; settings: WorkspaceEmailSettingsView | null; verifiedLabel: string | null }) {
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (operation: "save" | "verify" | "test", data?: unknown, done = "Done.") =>
    start(async () => {
      const result = await updateEmailSettings(slug, { operation, data });
      setStatus({ ok: result.ok, text: result.ok ? done : result.error });
    });
  return (
    <div className="min-w-0 space-y-6" aria-busy={pending}>
      <p role="status" className={status && !status.ok ? "text-danger-fg" : "text-ink-secondary"}>{status?.text ?? (settings ? (verifiedLabel ? `Connection verified ${verifiedLabel}.` : settings.lastError ? `Last check failed: ${settings.lastError}` : "Not verified yet.") : "Using the instance email server.")}</p>
      <form
        className="grid gap-4 rounded-xl border border-line bg-panel p-6 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          const fd = new FormData(event.currentTarget);
          const text = (name: string) => String(fd.get(name) ?? "");
          run("save", { enabled: fd.get("enabled") === "on", host: text("host"), port: text("port"), secure: fd.get("secure") === "on", username: text("username"), password: text("password"), fromEmail: text("fromEmail"), fromName: text("fromName"), replyTo: text("replyTo") }, "Settings saved. Verify the connection next.");
        }}
      >
        <label className="flex items-center gap-2 md:col-span-2"><input type="checkbox" name="enabled" defaultChecked={settings?.enabled ?? false} /> Send this workspace&apos;s email from this server</label>
        <Field label="SMTP host"><Input name="host" required maxLength={255} defaultValue={settings?.host} autoComplete="off" /></Field>
        <Field label="Port"><Input name="port" type="number" required min={1} max={65535} defaultValue={settings?.port ?? 587} /></Field>
        <label className="flex items-center gap-2 md:col-span-2"><input type="checkbox" name="secure" defaultChecked={settings?.secure ?? false} /> Use TLS from the start (usually port 465)</label>
        <Field label="Username" optional><Input name="username" maxLength={255} defaultValue={settings?.username} autoComplete="off" /></Field>
        <Field label="Password" optional helperText={settings?.hasPassword ? "Saved. Leave blank to keep it." : undefined}><Input name="password" type="password" autoComplete="new-password" maxLength={1024} placeholder={settings?.hasPassword ? "Saved" : undefined} /></Field>
        <Field label="From email"><Input name="fromEmail" type="email" required maxLength={254} defaultValue={settings?.fromEmail} /></Field>
        <Field label="From name" optional><Input name="fromName" maxLength={120} defaultValue={settings?.fromName} /></Field>
        <Field label="Reply-to" optional><Input name="replyTo" type="email" maxLength={254} defaultValue={settings?.replyTo} /></Field>
        <p className="text-caption md:col-span-2">The password is encrypted and never shown again. Changing any field clears the verified status.</p>
        <div className="flex flex-wrap gap-3 md:col-span-2"><Button type="submit" variant="primary" disabled={pending}>Save settings</Button></div>
      </form>
      {settings ? (
        <section className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" disabled={pending} onClick={() => run("verify", undefined, "Connection verified.")}>Verify connection</Button>
          <Button variant="secondary" disabled={pending} onClick={() => run("test", undefined, `Test email sent to ${adminEmail}.`)}>Send test email to {adminEmail}</Button>
        </section>
      ) : null}
    </div>
  );
}
