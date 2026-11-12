"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import type { OAuthProvider } from "@/lib/oauthLinking";

const LABELS: Record<OAuthProvider, string> = { google: "Google", github: "GitHub", apple: "Apple" };

type Props = {
  providers: OAuthProvider[];
  oidcProviders?: { id: string; name: string }[];
  callbackUrl: string;
  onError: (message: string | null) => void;
  /** Disables the buttons while the password form is working. */
  busy?: boolean;
};

/** One "Continue with" button per enabled sign-in provider. */
export function OAuthButtons({ providers, oidcProviders = [], callbackUrl, onError, busy = false }: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const entries = [
    ...oidcProviders.map((p) => ({ signInId: `oidc-${p.id}`, label: p.name })),
    ...providers.map((p) => ({ signInId: p, label: LABELS[p] })),
  ];
  if (entries.length === 0) return null;
  return (
    <>
      {entries.map((entry) => (
        <Button
          key={entry.signInId}
          variant="secondary"
          size="lg"
          fullWidth
          loading={loading === entry.signInId}
          disabled={busy || loading !== null}
          onClick={() => {
            onError(null);
            setLoading(entry.signInId);
            void signIn(entry.signInId, { callbackUrl }).catch(() => {
              setLoading(null);
              onError(`${entry.label} sign-in is unavailable right now. Try again or use your password.`);
            });
          }}
        >
          Continue with {entry.label}
        </Button>
      ))}
      <div className="flex items-center gap-3 text-sm text-ink-muted">
        <span aria-hidden className="h-px flex-1 bg-line" />
        or with a password
        <span aria-hidden className="h-px flex-1 bg-line" />
      </div>
    </>
  );
}
