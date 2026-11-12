"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveOrgLimitsAction } from "@/app/actions/adminOrgs";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, ProgressBar, SettingsRow } from "@/components/ui/display";
import { Dropdown, Field, Input } from "@/components/ui/field";
import { LIMIT_FIELDS, MODULE_CHOICES, usageFor, type LimitFieldKey, type ModuleState } from "@/lib/admin/limitFields";
import type { OrgLimitsView } from "@/lib/admin/limitsView";

const toNumber = (text: string) => (text.trim() === "" ? null : Number(text));

export function OrgLimitsForm({ workspaceId, view }: { workspaceId: string; view: OrgLimitsView }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [numbers, setNumbers] = useState<Record<string, string>>(() => Object.fromEntries(LIMIT_FIELDS.map((f) => [f.key, view.values[f.key]?.toString() ?? ""])));
  const [assistant, setAssistant] = useState(view.assistantEnabled);
  const [plan, setPlan] = useState(view.plan);
  const [modules, setModules] = useState<Record<string, ModuleState>>(view.modules);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const save = () =>
    startTransition(async () => {
      const payload = { workspaceId, ...Object.fromEntries(LIMIT_FIELDS.map((f) => [f.key, toNumber(numbers[f.key] ?? "")])), assistantEnabled: assistant, plan: plan.trim() || null, modules };
      const result = await saveOrgLimitsAction(payload);
      if (!result.ok) { setErrors(result.fieldErrors ?? {}); showToast(result.error, "error"); return; }
      setErrors({});
      showToast("Limits and modules saved.", "success");
      router.refresh();
    });

  return (
    <Card padding="lg">
      <CardHeader title="Limits and modules" description="Leave a limit empty to inherit the instance default. Zero blocks the feature." />
      <SettingsRow title="Limits" description="Usage is live; the inherited value applies when the field is empty.">
        <div className="grid gap-4 sm:grid-cols-2">
          {LIMIT_FIELDS.map((field) => {
            const used = usageFor(field, view.usage);
            const cap = numbers[field.key] === "" ? view.inherited[field.key as LimitFieldKey] : Number(numbers[field.key]);
            const inherited = view.inherited[field.key as LimitFieldKey];
            return (
              <Field key={field.key} label={field.label} error={errors[field.key]?.[0]} helperText={`${used === null ? "" : `Used ${used.toLocaleString("en")}. `}Inherits ${inherited === null ? "unlimited" : inherited.toLocaleString("en")}.`}>
                <div className="flex flex-col gap-2">
                  <Input type="number" inputMode="numeric" min={0} step={1} value={numbers[field.key] ?? ""} placeholder="Inherit" onChange={(e) => setNumbers((v) => ({ ...v, [field.key]: e.target.value }))} />
                  {used !== null && cap !== null && cap > 0 ? <ProgressBar label={`${field.label} used`} value={used} max={cap} tone={used >= cap ? "warning" : "accent"} /> : null}
                </div>
              </Field>
            );
          })}
          <Field label="Assistant">
            <Dropdown value={assistant} onChange={(e) => setAssistant(e.target.value as typeof assistant)}>
              <option value="inherit">Inherit (on)</option>
              <option value="on">Always on</option>
              <option value="off">Off</option>
            </Dropdown>
          </Field>
          <Field label="Plan label" optional helperText="A free-text label shown to owners.">
            <Input value={plan} maxLength={60} onChange={(e) => setPlan(e.target.value)} />
          </Field>
        </div>
      </SettingsRow>
      <SettingsRow title="Modules" description="Default follows the instance setting. Core features are always on.">
        <div className="grid gap-3 sm:grid-cols-2">
          {MODULE_CHOICES.map((choice) => (
            <Field key={choice.key} label={choice.label}>
              <Dropdown value={modules[choice.key] ?? "default"} onChange={(e) => setModules((v) => ({ ...v, [choice.key]: e.target.value as ModuleState }))}>
                <option value="default">Default</option>
                <option value="on">On</option>
                <option value="off">Off</option>
              </Dropdown>
            </Field>
          ))}
        </div>
      </SettingsRow>
      <div className="flex justify-end pt-6"><Button variant="primary" loading={pending} onClick={save}>Save limits and modules</Button></div>
    </Card>
  );
}
