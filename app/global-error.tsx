"use client";

import { useEffect } from "react";
import { Patch } from "@/components/brand/Patch";
import { SpaceWorksLogo } from "@/components/brand/SpaceWorksLogo";
import { Button } from "@/components/ui/button";
import { captureClientException } from "@/lib/observability/sentry/client";
import "./globals.css";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    captureClientException(error);
    if (process.env.NODE_ENV === "development") console.error("[ui] global error", error);
    else console.error("[ui] global error");
  }, [error]);
  return (
    <html lang="en">
      <body className="min-h-dvh bg-canvas font-sans text-ink">
        <header className="px-4"><SpaceWorksLogo variant="symbol" /></header>
        <main id="main-content" tabIndex={-1} className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-12 text-center">
          <Patch size={120} />
          <h1 className="text-h1">Space Works didn&apos;t load.</h1>
          <p className="text-body text-ink-secondary">Try again. If it keeps happening, tell whoever runs your Space Works workspace.</p>
          <Button variant="primary" onClick={reset}>Try again</Button>
        </main>
      </body>
    </html>
  );
}
