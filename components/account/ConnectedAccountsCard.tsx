"use client";

import { useState, useTransition } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { prepareProviderLink, unlinkProvider } from "@/app/actions/connectedAccounts";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/display";
import { useToast } from "@/components/feedback/ToastProvider";
import type { OAuthProvider } from "@/lib/oauthLinking";

const LABELS: Record<OAuthProvider, string> = { google: "Google", github: "GitHub", apple: "Apple" };

type Props = {
  /** Providers the instance has turned on. */
  enabled: OAuthProvider[];
  /** Providers already connected to this account. */
  linked: OAuthProvider[];
};

export function ConnectedAccountsCard({ enabled, linked }: Props) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // A provider switched off since linking can still be disconnected.
  const providers = (["google", "github", "apple"] as const).filter((p) => enabled.includes(p) || linked.includes(p));

  if (providers.length === 0) return <p className="text-body-ui text-ink-muted">No other sign-in methods are turned on for this instance.</p>;

  function connect(provider: OAuthProvider) {
    setBusy(provider);
    startTransition(async () => {
      const ready = await prepareProviderLink({ provider });
      if (!ready.ok) {
        showToast(ready.error, "error");
        setBusy(null);
        return;
      }
      void signIn(provider, { callbackUrl: "/account" }).catch(() => {
        setBusy(null);
        showToast("Couldn't reach the provider. Try again.", "error");
      });
    });
  }

  function disconnect(provider: OAuthProvider) {
    setBusy(provider);
    startTransition(async () => {
      const result = await unlinkProvider({ provider });
      setBusy(null);
      if (!result.ok) {
        showToast(result.error, "error");
        return;
      }
      showToast(`${LABELS[provider]} disconnected.`, "success");
      router.refresh();
    });
  }

  return (
    <ul className="flex flex-col gap-3">
      {providers.map((provider) => {
        const isLinked = linked.includes(provider);
        return (
          <li key={provider} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 font-semibold text-ink">
              {LABELS[provider]}
              <Chip tone={isLinked ? "success" : "neutral"} size="sm">{isLinked ? "Connected" : "Not connected"}</Chip>
            </span>
            <Button variant="secondary" loading={busy === provider} disabled={busy !== null} onClick={() => (isLinked ? disconnect(provider) : connect(provider))}>
              {isLinked ? "Disconnect" : "Connect"}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
