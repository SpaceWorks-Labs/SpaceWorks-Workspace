"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { recordDonationsLedger } from "@/app/actions/funding-ledger";
import { Card } from "@/components/ui/display";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format/money";
import type { LedgerChoices } from "@/lib/funding/service/ledger-link-queries";
import { LedgerPickers, type Picks } from "./LedgerPickers";

/** Banner listing received cash gifts that are not in the ledger yet, with bulk "record selected". */
export function DonationLedgerBulk({ slug, choices, base }: { slug: string; choices: LedgerChoices; base: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<string[]>([]);
  const [picks, setPicks] = useState<Picks>({ fundId: "", accountId: "", categoryId: "" });
  const [message, setMessage] = useState("");
  if (!choices.pending.length) return null;
  const currencies = [...new Set(choices.pending.filter((g) => selected.includes(g.id)).map((g) => g.currency))];
  const run = () => start(async () => {
    setMessage("");
    try {
      const r = await recordDonationsLedger(slug, { ids: selected, ...picks, confirmDuplicate: false });
      if (!r.ok) return setMessage(r.error);
      const items = r.data ?? [];
      const posted = items.filter((i) => i.result.status === "posted" || i.result.status === "already").length;
      const dupes = items.filter((i) => i.result.status === "duplicate").length;
      const failed = items.filter((i) => i.result.status === "error").length;
      setMessage(`${posted} recorded. ${dupes ? `${dupes} look like duplicates: open each one to confirm. ` : ""}${failed ? `${failed} need attention: open each one for the reason.` : ""}`);
      setSelected([]); router.refresh();
    } catch { setMessage("Couldn't save. Try again."); }
  });
  return (
    <Card className="space-y-3" role="region" aria-label="Donations not yet in the ledger">
      <h2 className="text-title">{choices.pendingTotal} received gifts not yet in the ledger</h2>
      <p className="text-caption text-ink-muted">Money gifts only. In-kind gifts become asset records. <Link className="underline" href={`${base}?ledger=pending`}>Show only these</Link></p>
      <ul className="space-y-1">{choices.pending.map((g) => (
        <li key={g.id} className="flex items-center gap-3">
          <input type="checkbox" className="size-5 accent-accent" aria-label={`Select ${g.title}`} checked={selected.includes(g.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, g.id] : s.filter((x) => x !== g.id)))} />
          <Link className="underline" href={`${base}?edit=${g.id}`}>{g.donor || g.title}</Link>
          <span>{formatMoney(g.amountMinor, g.currency)} · {g.dateOn}{g.foreign ? " · foreign source" : ""}</span>
        </li>
      ))}</ul>
      {selected.length ? <>
        {currencies.length > 1 ? <p role="alert" className="text-danger-fg">Select gifts in one currency at a time.</p> : <LedgerPickers choices={choices} currency={currencies[0]!} value={picks} onChange={setPicks} />}
        <Button variant="primary" loading={pending} disabled={currencies.length > 1} onClick={run}>Record {selected.length} selected</Button>
      </> : null}
      <p role="status" className="text-caption">{message}</p>
    </Card>
  );
}
