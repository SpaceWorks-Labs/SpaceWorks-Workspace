"use client";

import { useEffect } from "react";
import { Patch } from "@/components/brand/Patch";
import { Button } from "@/components/ui/button";
import { captureClientException } from "@/lib/observability/sentry/client";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    captureClientException(error);
    if (process.env.NODE_ENV === "development") console.error("[ui] route error", error);
    else console.error("[ui] route error");
  }, [error]);
  return (
    <div className="mx-auto flex max-w-[520px] flex-col items-center gap-4 px-4 py-16 text-center">
      <Patch pose="idle" size={136} className="mb-2" />
      <h1 className="text-h1 text-ink">This page didn&apos;t load.</h1>
      <p className="text-body-ui text-ink-secondary">Try again. If it keeps happening, tell whoever runs your Space Works workspace.</p>
      <Button variant="primary" onClick={reset}>Try again</Button>
    </div>
  );
}
