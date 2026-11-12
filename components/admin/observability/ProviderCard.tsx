"use client";

import { useTransition, type ReactNode } from "react";
import { testObservability } from "@/app/actions/observability";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { SwitchRow } from "@/components/ui/choice";
import { Card, CardHeader, Chip } from "@/components/ui/display";
import { Field, Input, PasswordInput, Textarea } from "@/components/ui/field";
import type { ConsoleData } from "@/lib/observability/admin/settings";
import type { ProviderDef } from "@/lib/observability/admin/providers";

export type CardProps = {
  def: ProviderDef;
  data: ConsoleData;
  values: Record<string, string>;
  secrets: Record<string, string>;
  setValue: (key: string, value: string) => void;
  setSecret: (key: string, value: string) => void;
  /** One short sentence from the provider's own status check. */
  status?: string;
  children?: ReactNode;
};

const SOURCE_LABEL = { database: "Saved here", environment: "From environment", unset: "Not set" } as const;

export function ProviderCard({ def, data, values, secrets, setValue, setSecret, status, children }: CardProps) {
  const { showToast } = useToast();
  const [testing, startTest] = useTransition();
  const on = def.enableKey ? values[def.enableKey] === "true" : Boolean(values["obs.grafana.url"]?.trim());
  const csp = data.csp[def.id];

  function runTest() {
    startTest(async () => {
      const result = await testObservability(def.id);
      showToast(result.ok ? result.data?.message ?? "Looks good." : result.error, result.ok ? "success" : "error");
    });
  }

  return (
    <Card padding="lg" as="section" aria-label={def.title}>
      <CardHeader title={def.title} description={def.blurb} action={<Chip tone={on ? "success" : "neutral"} size="sm">{on ? "On" : "Off"}</Chip>} />
      <div className="flex flex-col gap-4">
        {def.enableKey ? (
          <SwitchRow label={`Turn on ${def.title}`} checked={on} onCheckedChange={(checked) => setValue(def.enableKey as string, checked ? "true" : "false")} />
        ) : null}
        {def.fields.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {def.fields.map((field) => {
              const source = data.sources[field.key] ?? "unset";
              const help = field.secret
                ? `${data.secretsSet.includes(field.key) ? "Saved. Write-only: leave empty to keep it." : "Write-only. Not set yet."}${field.help && !field.help.startsWith("Write-only") ? ` ${field.help}` : ""}`
                : [field.help, SOURCE_LABEL[source]].filter(Boolean).join(" ");
              return (
                <Field key={field.key} label={field.label} optional={!def.required.includes(field.key)} helperText={help}>
                  {field.secret ? (
                    <PasswordInput value={secrets[field.key] ?? ""} onChange={(e) => setSecret(field.key, e.target.value)} autoComplete="off" />
                  ) : field.multiline ? (
                    <Textarea rows={4} value={values[field.key] ?? ""} onChange={(e) => setValue(field.key, e.target.value)} autoComplete="off" spellCheck={false} />
                  ) : (
                    <Input value={values[field.key] ?? ""} placeholder={field.placeholder} onChange={(e) => setValue(field.key, e.target.value)} autoComplete="off" />
                  )}
                </Field>
              );
            })}
          </div>
        ) : null}
        {children}
        <dl className="grid gap-1 text-caption text-ink-muted">
          <div><dt className="inline font-medium text-ink">Browser policy: </dt><dd className="inline">{csp.detail}</dd></div>
          <div><dt className="inline font-medium text-ink">Privacy: </dt><dd className="inline">{def.privacy}</dd></div>
          {def.note ? <div><dt className="inline font-medium text-ink">Note: </dt><dd className="inline">{def.note}</dd></div> : null}
          {status ? <div><dt className="inline font-medium text-ink">Status: </dt><dd className="inline">{status}</dd></div> : null}
        </dl>
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" loading={testing} onClick={runTest}>Send test</Button>
        </div>
      </div>
    </Card>
  );
}
