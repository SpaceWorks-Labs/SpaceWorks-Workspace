"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { eraseSubscriberAction, setBlocklistedAction } from "@/app/actions/campaignSubscribers";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/display";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export type SubscriberRow = { id: string; email: string; name: string | null; status: "ACTIVE" | "BLOCKLISTED"; blocklistReason: string | null; lists: string[] };

const REASONS: Record<string, string> = { UNSUBSCRIBE_ALL: "Unsubscribed from everything", BOUNCE_HARD: "Hard bounce", BOUNCE_SOFT_LIMIT: "Repeated soft bounces", COMPLAINT: "Spam complaint", CONTACT_DNC: "Contact is do-not-contact", ADMIN: "Blocklisted by an admin" };

export function SubscriberTable({ slug, rows }: { slug: string; rows: SubscriberRow[] }) {
  const router = useRouter();
  const [erasing, setErasing] = useState<SubscriberRow | null>(null);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => { const r = await fn(); setMessage(r.ok ? "" : (r.error ?? "Couldn't save. Try again.")); setErasing(null); router.refresh(); });
  return (
    <div className="min-w-0 space-y-3" aria-busy={pending}>
      <p role="status" className="text-danger-fg">{message}</p>
      <Table label="Subscribers">
        <THead><TR><TH>Email</TH><TH>Name</TH><TH>Status</TH><TH>Lists</TH><TH><span className="sr-only">Actions</span></TH></TR></THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.id}>
              <TD className="break-all">{r.email}</TD>
              <TD>{r.name ?? ""}</TD>
              <TD>{r.status === "ACTIVE" ? <Chip tone="success" size="sm">Active</Chip> : <Chip tone="danger" size="sm">{REASONS[r.blocklistReason ?? ""] ?? "Blocklisted"}</Chip>}</TD>
              <TD>{r.lists.join(", ")}</TD>
              <TD><div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => setBlocklistedAction(slug, r.id, r.status === "ACTIVE"))}>{r.status === "ACTIVE" ? "Blocklist" : "Unblocklist"}</Button>
                <Button size="sm" variant="dangerQuiet" disabled={pending} onClick={() => setErasing(r)}>Erase</Button>
              </div></TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <ConfirmDialog open={Boolean(erasing)} title="Erase this subscriber?" confirmLabel="Erase subscriber" loading={pending}
        message="Their subscriptions, bounces and engagement are deleted, and their address is removed from sent-message records. They'll no longer be blocklisted, so only do this for a data-erasure request. This can't be undone."
        onCancel={() => setErasing(null)} onConfirm={() => erasing && run(() => eraseSubscriberAction(slug, erasing.id))} />
    </div>
  );
}
