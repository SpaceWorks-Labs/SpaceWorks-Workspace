"use client";
import { Field, Dropdown } from "@/components/ui/field";
import type { LedgerChoices } from "@/lib/funding/service/ledger-link-queries";

export type Picks = { fundId: string; accountId: string; categoryId: string };

/** Fund, account and category pickers for posting a donation; funds and accounts follow the gift's currency. */
export function LedgerPickers({ choices, currency, value, onChange }: { choices: LedgerChoices; currency: string; value: Picks; onChange: (next: Picks) => void }) {
  const set = (key: keyof Picks) => (e: { target: { value: string } }) => onChange({ ...value, [key]: e.target.value });
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Fund" optional><Dropdown value={value.fundId} onChange={set("fundId")}><option value="">No fund</option>{choices.funds.filter((f) => f.currency === currency).map((f) => <option key={f.id} value={f.id}>{f.name}{f.fcra ? " (FCRA)" : ""}</option>)}</Dropdown></Field>
      <Field label="Bank or cash account" optional><Dropdown value={value.accountId} onChange={set("accountId")}><option value="">No account</option>{choices.accounts.filter((a) => a.currency === currency).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Dropdown></Field>
      <Field label="Income category" optional><Dropdown value={value.categoryId} onChange={set("categoryId")}><option value="">Uncategorised</option>{choices.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Dropdown></Field>
    </div>
  );
}
