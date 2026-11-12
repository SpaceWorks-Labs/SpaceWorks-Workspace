"use client";

import { useState, useTransition } from "react";
import { rotateMetricsToken } from "@/app/actions/observability";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { ReadOnlyValue } from "@/components/ui/field";

/** Scrape URL, token status and one-time token rotation. */
export function MetricsExtras({ baseUrl, tokenSet }: { baseUrl: string; tokenSet: boolean }) {
  const { showToast } = useToast();
  const [pending, start] = useTransition();
  const [fresh, setFresh] = useState<string | null>(null);

  function rotate() {
    start(async () => {
      const result = await rotateMetricsToken();
      if (!result.ok) { showToast(result.error, "error"); return; }
      setFresh(result.data?.token ?? null);
      showToast("New token created. Copy it now.", "success");
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <ReadOnlyValue value={<code className="break-all text-caption">{`${baseUrl}/api/metrics`}</code>} />
      <div className="flex items-center justify-between gap-3">
        <p className="text-caption text-ink-muted">{tokenSet ? "A token is set. Rotating it stops the old one at once." : "No token yet. Create one, then turn metrics on."}</p>
        <Button variant="secondary" size="sm" loading={pending} onClick={rotate}>{tokenSet ? "Rotate token" : "Create token"}</Button>
      </div>
      {fresh ? (
        <Callout tone="warning" title="Copy this token now">
          It is shown once and can&apos;t be read back. Use it as the bearer token in your scrape config.
          <code className="mt-2 block break-all text-caption">{fresh}</code>
        </Callout>
      ) : null}
    </div>
  );
}
