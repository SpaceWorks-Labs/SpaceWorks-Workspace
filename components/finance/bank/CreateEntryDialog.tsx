"use client";

import { useState, useTransition } from "react";
import { createEntryFromBankLineAction } from "@/app/actions/finance-bank";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Dropdown, Field, Input } from "@/components/ui/field";
import { formatMoney } from "@/lib/format/money";
import type { BankLineView } from "@/lib/finance/bank";

export type EntryOptions = {
  categories: { id: string; name: string; kind: "INCOME" | "EXPENSE" }[];
  funds: { id: string; name: string; currency: string }[];
  centres: { id: string; name: string }[];
};

/** Make a ledger entry from a bank line. The server uses the normal add-entry rules (periods, signed months, fund checks). */
export function CreateEntryDialog({ slug, line, options, open, onOpenChange, onDone }: { slug: string; line: BankLineView; options: EntryOptions; open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  const { showToast } = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const kind = line.amountMinor > 0 ? "INCOME" : "EXPENSE";
  const submit = (form: FormData) =>
    start(async () => {
      setError(null);
      const text = (key: string) => String(form.get(key) ?? "");
      const result = await createEntryFromBankLineAction(slug, { lineId: line.id, categoryId: text("categoryId"), fundId: text("fundId"), costCentreId: text("costCentreId"), description: text("description") });
      if (!result.ok) return setError(result.error);
      showToast("Entry created and matched.", "success");
      onOpenChange(false);
      onDone();
    });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader title="Create an entry from this line" description={`${line.postedOn}: ${kind === "INCOME" ? "money in" : "money out"} ${formatMoney(Math.abs(line.amountMinor), line.currency)}. Date, amount and account come from the bank line.`} />
        <form action={submit}>
          <DialogBody className="flex flex-col gap-4">
            <Field label="Description"><Input name="description" defaultValue={line.description.slice(0, 120)} maxLength={120} required /></Field>
            <Field label="Category" optional>
              <Dropdown name="categoryId" defaultValue="">
                <option value="">No category</option>
                {options.categories.filter((c) => c.kind === kind).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Dropdown>
            </Field>
            <Field label="Fund" optional>
              <Dropdown name="fundId" defaultValue="">
                <option value="">No fund</option>
                {options.funds.filter((f) => f.currency === line.currency).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </Dropdown>
            </Field>
            <Field label="Cost centre" optional>
              <Dropdown name="costCentreId" defaultValue="">
                <option value="">No cost centre</option>
                {options.centres.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Dropdown>
            </Field>
            {error ? <p role="alert" className="text-caption text-danger-fg">{error}</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" variant="primary" loading={pending}>Create and match</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
