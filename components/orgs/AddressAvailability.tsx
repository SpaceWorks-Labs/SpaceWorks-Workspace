"use client";

import { useEffect, useState } from "react";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { checkOrganisationAddress } from "@/app/actions/orgRequests";

export type AddressState = { kind: "idle" } | { kind: "checking" } | { kind: "free"; slug: string } | { kind: "taken"; message: string };

/** Debounced availability check for an organisation address. The server checks again on submit. */
export function useAddressCheck(slug: string, requestId?: string): AddressState {
  const [state, setState] = useState<AddressState>({ kind: "idle" });
  useEffect(() => {
    const value = slug.trim();
    let live = true;
    const timer = setTimeout(() => {
      if (!value) {
        setState({ kind: "idle" });
        return;
      }
      setState({ kind: "checking" });
      checkOrganisationAddress(value, requestId)
        .then((result) => {
          if (!live) return;
          if (result.available) setState({ kind: "free", slug: value });
          else setState(result.message ? { kind: "taken", message: result.message } : { kind: "idle" });
        })
        .catch(() => live && setState({ kind: "idle" }));
    }, value ? 400 : 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [slug, requestId]);
  return state;
}

export function AddressAvailability({ state }: { state: AddressState }) {
  return (
    <p aria-live="polite" className="-mt-2 flex min-h-5 items-center gap-1.5 text-caption">
      {state.kind === "checking" ? <span className="text-ink-muted">Checking the address</span> : null}
      {state.kind === "free" ? (
        <span className="inline-flex items-center gap-1.5 text-success-fg"><CircleCheck aria-hidden className="size-4" />/w/{state.slug} is free.</span>
      ) : null}
      {state.kind === "taken" ? (
        <span className="inline-flex items-center gap-1.5 text-danger-fg"><TriangleAlert aria-hidden className="size-4" />{state.message}</span>
      ) : null}
    </p>
  );
}
