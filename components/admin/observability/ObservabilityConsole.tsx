"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveObservability } from "@/app/actions/observability";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import type { ConsoleData } from "@/lib/observability/admin/settings";
import { PROVIDERS } from "@/lib/observability/admin/providers";
import { GlobalCard } from "./GlobalCard";
import { MetricsExtras } from "./MetricsExtras";
import { ProviderCard } from "./ProviderCard";

type Props = { data: ConsoleData; baseUrl: string; statuses: Record<string, string> };

export function ObservabilityConsole({ data, baseUrl, statuses }: Props) {
  const router = useRouter();
  const { showToast } = useToast();
  const [values, setValues] = useState<Record<string, string>>(data.values);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const setValue = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }));
  const setSecret = (key: string, value: string) => setSecrets((s) => ({ ...s, [key]: value }));

  function save() {
    start(async () => {
      const payload: Record<string, string | null> = {};
      for (const [key, value] of Object.entries(values)) if (value !== (data.values[key] ?? "")) payload[key] = value.trim() ? value.trim() : null;
      for (const [key, value] of Object.entries(secrets)) if (value.trim()) payload[key] = value;
      if (Object.keys(payload).length === 0) { showToast("Nothing to save.", "info"); return; }
      const result = await saveObservability(payload);
      if (!result.ok) { showToast(result.error, "error"); return; }
      setSecrets({});
      showToast("Observability settings saved.", "success");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <GlobalCard values={values} setValue={setValue} />
      {PROVIDERS.map((def) => (
        <ProviderCard key={def.id} def={def} data={data} values={values} secrets={secrets} setValue={setValue} setSecret={setSecret} status={statuses[def.id]}>
          {def.id === "metrics" ? <MetricsExtras baseUrl={baseUrl} tokenSet={data.secretsSet.includes("obs.metrics.token")} /> : null}
        </ProviderCard>
      ))}
      <div className="flex justify-end">
        <Button variant="primary" loading={pending} onClick={save}>Save observability settings</Button>
      </div>
    </div>
  );
}
