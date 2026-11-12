"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listMyPendingRequests } from "@/app/actions/orgRequests";
import { MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu";

/** Workspace-switcher footer: pending organisation requests and the request link. */
export function SwitcherRequests({ onNavigate }: { onNavigate?: () => void }) {
  const [pending, setPending] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    let live = true;
    listMyPendingRequests().then((rows) => { if (live) setPending(rows); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  return (
    <>
      <MenuSeparator />
      {pending.length > 0 ? (
        <>
          <MenuLabel>Waiting for approval</MenuLabel>
          {pending.map((row) => (
            <MenuItem key={row.id} asChild>
              <Link href="/account/organisations" onClick={onNavigate}><span className="min-w-0 truncate">{row.name}</span></Link>
            </MenuItem>
          ))}
        </>
      ) : null}
      <MenuItem asChild>
        <Link href="/account/organisations" onClick={onNavigate}>Request a new organisation</Link>
      </MenuItem>
    </>
  );
}
