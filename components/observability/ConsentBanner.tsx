"use client";

import { Button } from "@/components/ui/button";
import { CONSENT_COOKIE, consentCookieValue } from "@/lib/observability/consent";

export function writeConsentCookie(granted: boolean) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${consentCookieValue(granted)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}

/** Minimal analytics consent notice. Shown only in opt-in mode while a consent-gated tool is active. */
export function ConsentBanner({ onChoose }: { onChoose: (granted: boolean) => void }) {
  const choose = (granted: boolean) => {
    writeConsentCookie(granted);
    onChoose(granted);
  };
  return (
    <section
      aria-labelledby="sww-consent-title"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-xl flex-col gap-3 rounded-xl border border-line bg-panel p-4 shadow-float sm:flex-row sm:items-center"
    >
      <div className="min-w-0 flex-1">
        <h2 id="sww-consent-title" className="text-label text-ink">Help improve Space Works?</h2>
        <p className="text-caption text-ink-secondary">
          This workspace uses privacy-friendly usage analytics. We never send your name, email or content. You can change this later by clearing the cookie.
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={() => choose(false)}>No thanks</Button>
        <Button variant="primary" size="sm" onClick={() => choose(true)}>Allow</Button>
      </div>
    </section>
  );
}
