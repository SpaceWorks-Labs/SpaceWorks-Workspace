"use client";

import { CheckboxField, SwitchRow } from "@/components/ui/choice";
import { Card, CardHeader } from "@/components/ui/display";
import { Dropdown, Field, Textarea } from "@/components/ui/field";
import { CONSENT_LABELS, CONSENT_MODES, OVERRIDABLE_PROVIDERS, PROVIDERS } from "@/lib/observability/admin/providers";

type Props = { values: Record<string, string>; setValue: (key: string, value: string) => void };

/** Consent mode and the switch that lets workspaces bring their own analytics project. */
export function GlobalCard({ values, setValue }: Props) {
  const allowed = values["obs.workspaceOverrides.allowed"] === "true";
  const chosen = (values["obs.workspaceOverrides.providers"] ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const toggle = (id: string, checked: boolean) => {
    const next = checked ? [...new Set([...chosen, id])] : chosen.filter((item) => item !== id);
    setValue("obs.workspaceOverrides.providers", next.join(","));
  };
  return (
    <Card padding="lg" as="section" aria-label="Consent and workspace overrides">
      <CardHeader title="Consent and workspaces" description="Applies to PostHog, Clarity and Firebase. Sentry records errors only and is not gated by consent." />
      <div className="flex flex-col gap-4">
        <Field label="Consent mode" helperText="Do Not Track and Global Privacy Control always switch these off, whatever the mode.">
          <Dropdown value={values["obs.consentMode"] || "opt-in"} onChange={(e) => setValue("obs.consentMode", e.target.value)}>
            {CONSENT_MODES.map((mode) => <option key={mode} value={mode}>{CONSENT_LABELS[mode]}</option>)}
          </Dropdown>
        </Field>
        <SwitchRow
          label="Let workspace admins connect their own tools"
          description="Off by default. A workspace that chooses its own project sends nothing to the instance project."
          checked={allowed}
          onCheckedChange={(checked) => setValue("obs.workspaceOverrides.allowed", checked ? "true" : "false")}
        />
        {allowed ? (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-label text-ink">Providers workspaces may bring</legend>
              {OVERRIDABLE_PROVIDERS.map((id) => (
                <CheckboxField key={id} label={PROVIDERS.find((p) => p.id === id)?.title ?? id} checked={chosen.includes(id)} onCheckedChange={(checked) => toggle(id, checked === true)} />
              ))}
            </fieldset>
            <Field label="Host allow-list" optional helperText="Comma separated host names a workspace project may use, e.g. eu.i.posthog.com. Hosts must also be https and public.">
              <Textarea rows={2} value={values["obs.workspaceOverrides.hostAllowlist"] ?? ""} onChange={(e) => setValue("obs.workspaceOverrides.hostAllowlist", e.target.value)} spellCheck={false} />
            </Field>
          </>
        ) : null}
      </div>
    </Card>
  );
}
