"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { recordDonationLedger, createInKindAsset } from "@/app/actions/funding-ledger";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { formatMoney, currencyMinorDigits, parseMoneyToMinor } from "@/lib/format/money";
import type { DuplicateMatch } from "@/lib/funding/service/ledger-link";
import type { LedgerChoices } from "@/lib/funding/service/ledger-link-queries";
import { LedgerPickers, type Picks } from "./LedgerPickers";

type Gift = { id: string; amountMinor: number; currency: string; fundId: string | null; ledgerEntryId: string | null; status: string; inKind: boolean; foreign: boolean };

/** Editor-side action: record a cash gift in the ledger, or turn an in-kind gift into an asset record. */
export function DonationLedgerLink({ slug, gift, choices }: { slug: string; gift: Gift; choices: LedgerChoices }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  const [dupes, setDupes] = useState<DuplicateMatch[]>([]);
  const [picks, setPicks] = useState<Picks>({ fundId: gift.fundId ?? "", accountId: "", categoryId: "" });
  const [note, setNote] = useState("");
  const [value, setValue] = useState(String(gift.amountMinor / 10 ** currencyMinorDigits(gift.currency)));
  if (gift.status !== "RECEIVED") return null;
  const post = (confirmDuplicate: boolean) => start(async () => {
    setMessage("");
    try {
      const r = await recordDonationLedger(slug, { id: gift.id, ...picks, confirmDuplicate });
      if (!r.ok) return setMessage(r.error);
      if (r.data?.status === "duplicate") { setDupes(r.data.matches); return setMessage("A similar income entry already exists. Check it before recording again."); }
      setDupes([]); setMessage("Recorded in the ledger."); router.refresh();
    } catch { setMessage("Couldn't save. Try again."); }
  });
  const asset = () => start(async () => {
    setMessage("");
    const estimatedMinor = parseMoneyToMinor(value, gift.currency);
    if (estimatedMinor === null) return setMessage("Enter a valid estimated value.");
    try {
      const r = await createInKindAsset(slug, { id: gift.id, note, estimatedMinor });
      setMessage(r.ok ? (r.data?.created ? "Asset record created." : "An asset record already exists for this gift.") : r.error);
      if (r.ok) router.refresh();
    } catch { setMessage("Couldn't save. Try again."); }
  });
  return (
    <section className="space-y-3" aria-label="Ledger and asset record">
      <h3 className="text-title">{gift.inKind ? "Asset record" : "Ledger"}</h3>
      {gift.inKind ? (
        <div className="space-y-3">
          <p className="text-caption text-ink-muted">In-kind gifts are not money, so they don&apos;t go to the ledger. Record the item as an asset instead.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Estimated value" helperText={`In ${gift.currency}`}><Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
            <Field label="Note" optional><Input value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
          <Button variant="secondary" loading={pending} onClick={asset}>Create asset record</Button>
        </div>
      ) : gift.ledgerEntryId ? (
        <p>Recorded in the ledger. <Link className="underline" href={`/w/${slug}/finance/ledger?record=${gift.ledgerEntryId}&voided=1`}>View the entry</Link></p>
      ) : (
        <div className="space-y-3">
          <p className="text-caption text-ink-muted">Records {formatMoney(gift.amountMinor, gift.currency)} as income. Receipts stay unchanged.</p>
          {gift.foreign ? <p className="text-caption text-ink-muted">Foreign-source gift: choose a fund marked FCRA.</p> : null}
          <LedgerPickers choices={choices} currency={gift.currency} value={picks} onChange={setPicks} />
          {dupes.length ? <ul className="list-disc pl-5 text-caption">{dupes.map((d) => <li key={d.id}>{d.occurredOn}: {d.description}, {formatMoney(d.amountMinor, gift.currency)}</li>)}</ul> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" loading={pending} onClick={() => post(false)}>Record in ledger</Button>
            {dupes.length ? <Button variant="secondary" loading={pending} onClick={() => post(true)}>Record anyway</Button> : null}
          </div>
        </div>
      )}
      <p role="status" className="text-caption">{message}</p>
    </section>
  );
}
