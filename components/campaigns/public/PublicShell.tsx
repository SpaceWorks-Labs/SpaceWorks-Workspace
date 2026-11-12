import type { ReactNode } from "react";
import { Card } from "@/components/ui/display";

/** Frame for the hosted subscriber pages: no navigation, no account chrome. */
export function PublicShell({ title, intro, children }: { title: string; intro?: ReactNode; children?: ReactNode }) {
  return (
    <main className="mx-auto min-w-0 max-w-xl space-y-6 break-words p-5 sm:p-8">
      <header>
        <p className="text-label text-accent-text">Space Works</p>
        <h1 className="mt-3 text-h1">{title}</h1>
        {intro ? <p className="mt-3 text-body-ui text-ink-muted">{intro}</p> : null}
      </header>
      {children ? <Card>{children}</Card> : null}
    </main>
  );
}

export const publicMetadata = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };
