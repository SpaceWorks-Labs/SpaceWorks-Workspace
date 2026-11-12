"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateOrgDefaultsAction } from "@/app/actions/adminOrgs";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { Card, SettingsRow } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/field";
import { CheckboxField, SwitchRow } from "@/components/ui/choice";
import { MODULE_CHOICES } from "@/lib/admin/limitFields";

const FIELDS = [
  ["maxMembers", "Members"], ["maxGuests", "Guests"], ["maxProjects", "Projects"], ["maxStorageBytes", "Storage (bytes)"], ["maxFileBytes", "Largest file (bytes)"],
  ["maxApiTokens", "API tokens"], ["maxWebhooks", "Webhooks"], ["assistantMonthlyTokens", "Assistant tokens per month"], ["monthlyEmailCap", "Emails per month"], ["maxWorkspacesPerOwner", "Organisations per owner"],
] as const;

export function OrgDefaultsForm({ values }: { values: Record<string, string> }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [requireApproval, setRequireApproval] = useState(values["workspaces.requireApproval"] !== "false");
  const [numbers, setNumbers] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map(([key]) => [key, values[`limits.${key}`] ?? ""])));
  const [off, setOff] = useState<string[]>(() => (values["modules.disabledByDefault"] ?? "").split(",").map((v) => v.trim()).filter(Boolean));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const save = () =>
    startTransition(async () => {
      const result = await updateOrgDefaultsAction({ requireApproval, ...numbers, disabledByDefault: off });
      if (!result.ok) { setErrors(result.fieldErrors ?? {}); showToast(result.error, "error"); return; }
      setErrors({});
      showToast("Organisation defaults saved.", "success");
      router.refresh();
    });
  return (
    <Card padding="lg">
      <SettingsRow title="Organisation defaults" description="Applied to every organisation without its own override. Empty means unlimited.">
        <div className="flex flex-col gap-6">
          <SwitchRow label="New organisations need approval" description="When off, anyone signed in can create an organisation that is active at once." checked={requireApproval} onCheckedChange={setRequireApproval} />
          <div className="grid gap-4 sm:grid-cols-2">
            {FIELDS.map(([key, label]) => (
              <Field key={key} label={label} error={errors[key]?.[0]}>
                <Input type="number" inputMode="numeric" min={0} placeholder="Unlimited" value={numbers[key] ?? ""} onChange={(e) => setNumbers((v) => ({ ...v, [key]: e.target.value }))} />
              </Field>
            ))}
          </div>
          <fieldset>
            <legend className="text-label text-ink">Modules off by default</legend>
            <p className="mb-2 text-caption text-ink-muted">An organisation can still be given a module on its own page.</p>
            <div className="grid gap-x-4 sm:grid-cols-2">
              {MODULE_CHOICES.map((choice) => (
                <CheckboxField key={choice.key} label={choice.label} checked={off.includes(choice.key)} onCheckedChange={(checked) => setOff((list) => (checked === true ? [...new Set([...list, choice.key])] : list.filter((key) => key !== choice.key)))} />
              ))}
            </div>
          </fieldset>
        </div>
      </SettingsRow>
      <div className="flex justify-end pt-6"><Button variant="primary" loading={pending} onClick={save}>Save organisation defaults</Button></div>
    </Card>
  );
}
