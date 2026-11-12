"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSignInSettings } from "@/app/actions/adminSignIn";
import { Button } from "@/components/ui/button";
import { SwitchRow } from "@/components/ui/choice";
import { Callout, Card, CardHeader, Chip } from "@/components/ui/display";
import { Field, Input, PasswordInput, ReadOnlyValue, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/feedback/ToastProvider";

type Initial = {
  /** Resolved plain values (database, then environment) for non-secret keys. */
  values: Record<string, string>;
  /** Secret keys that already have a stored value. */
  secretsSet: string[];
  baseUrl: string;
};

type FieldDef = { key: string; label: string; secret?: boolean; multiline?: boolean; help?: string };

const PROVIDERS: Array<{ id: "google" | "github" | "apple"; title: string; blurb: string; fields: FieldDef[] }> = [
  {
    id: "google",
    title: "Google",
    blurb: "Create an OAuth client in Google Cloud Console and add the callback URL below as an authorised redirect URI.",
    fields: [{ key: "google.clientId", label: "Client ID" }, { key: "google.clientSecret", label: "Client secret", secret: true }],
  },
  {
    id: "github",
    title: "GitHub",
    blurb: "Register an OAuth App in GitHub developer settings. Only a primary, verified email is ever used.",
    fields: [{ key: "github.clientId", label: "Client ID" }, { key: "github.clientSecret", label: "Client secret", secret: true }],
  },
  {
    id: "apple",
    title: "Apple",
    blurb: "Needs a Services ID, a Sign in with Apple key (.p8), your Team ID and an HTTPS domain. Apple's private relay addresses are never linked to existing accounts.",
    fields: [
      { key: "apple.clientId", label: "Services ID (client ID)" },
      { key: "apple.teamId", label: "Team ID" },
      { key: "apple.keyId", label: "Key ID" },
      { key: "apple.privateKey", label: "Private key (.p8)", secret: true, multiline: true, help: "Paste the whole file. Write-only." },
    ],
  },
];

function CopyUrl({ url }: { url: string }) {
  const { showToast } = useToast();
  return (
    <ReadOnlyValue
      value={<code className="break-all text-caption">{url}</code>}
      action={<Button variant="quiet" size="sm" onClick={() => { void navigator.clipboard.writeText(url).then(() => showToast("Callback URL copied.", "success"), () => showToast("Couldn't copy. Select the URL instead.", "error")); }}>Copy</Button>}
    />
  );
}

export function SignInSettings({ values: initial, secretsSet, baseUrl }: Initial) {
  const router = useRouter();
  const { showToast } = useToast();
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const set = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }));
  const isOn = (key: string) => values[key] === "true" || values[key] === "1";
  const googleOn = values["google.enabled"] !== "false" && values["google.enabled"] !== "0";
  const insecure = !baseUrl.startsWith("https://");

  function save() {
    startTransition(async () => {
      const payload: Record<string, string | null> = {};
      for (const [key, value] of Object.entries(values)) payload[key] = value.trim() ? value.trim() : null;
      for (const [key, value] of Object.entries(secrets)) if (value.trim()) payload[key] = value;
      const result = await saveSignInSettings(payload);
      if (!result.ok) {
        showToast(result.error, "error");
        return;
      }
      setSecrets({});
      showToast("Sign-in settings saved.", "success");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {PROVIDERS.map((provider) => {
        const on = provider.id === "google" ? googleOn : isOn(`${provider.id}.enabled`);
        return (
          <Card key={provider.id} padding="lg">
            <CardHeader title={provider.title} description={provider.blurb} action={<Chip tone={on ? "success" : "neutral"} size="sm">{on ? "On" : "Off"}</Chip>} />
            <div className="flex flex-col gap-4">
              {provider.id === "apple" && insecure ? (
                <Callout tone="warning" title="Apple needs HTTPS">
                  Sign in with Apple only works on an HTTPS domain, and its callback is a cross-site POST that needs secure cookies. It can&apos;t be tried on localhost.
                </Callout>
              ) : null}
              <SwitchRow
                label={`Allow sign-in with ${provider.title}`}
                checked={on}
                onCheckedChange={(checked) => set(`${provider.id}.enabled`, checked ? "true" : "false")}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                {provider.fields.map((field) => (
                  <Field
                    key={field.key}
                    label={field.label}
                    helperText={field.secret ? (secretsSet.includes(field.key) ? "Saved. Write-only: leave empty to keep it." : "Write-only. Not set yet.") : field.help}
                  >
                    {field.multiline ? (
                      <Textarea rows={5} value={secrets[field.key] ?? ""} onChange={(e) => setSecrets((s) => ({ ...s, [field.key]: e.target.value }))} autoComplete="off" spellCheck={false} placeholder={secretsSet.includes(field.key) ? "Paste a new key to replace the saved one" : ""} />
                    ) : field.secret ? (
                      <PasswordInput value={secrets[field.key] ?? ""} onChange={(e) => setSecrets((s) => ({ ...s, [field.key]: e.target.value }))} autoComplete="off" />
                    ) : (
                      <Input value={values[field.key] ?? ""} onChange={(e) => set(field.key, e.target.value)} autoComplete="off" />
                    )}
                  </Field>
                ))}
              </div>
              <Field label="Callback URL" helperText="Register this exactly with the provider.">
                <CopyUrl url={`${baseUrl}/api/auth/callback/${provider.id}`} />
              </Field>
            </div>
          </Card>
        );
      })}
      <Card padding="lg">
        <CardHeader title="Self sign-up" description="Sign-in stays invite-only unless you turn this on. New accounts have no workspace until they join or request one." />
        <div className="flex flex-col gap-4">
          <SwitchRow label="Let people create their own account" checked={isOn("auth.allowSelfSignup")} onCheckedChange={(checked) => set("auth.allowSelfSignup", checked ? "true" : "false")} />
          <Field label="Allowed email domains" optional helperText="Comma separated, e.g. example.org, example.com. Empty allows any domain.">
            <Input value={values["auth.allowedEmailDomains"] ?? ""} onChange={(e) => set("auth.allowedEmailDomains", e.target.value)} autoComplete="off" />
          </Field>
        </div>
      </Card>
      <div className="flex justify-end">
        <Button variant="primary" loading={pending} onClick={save}>Save sign-in settings</Button>
      </div>
    </div>
  );
}
