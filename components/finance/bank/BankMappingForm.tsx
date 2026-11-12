"use client";

import { Dropdown, Field } from "@/components/ui/field";
import type { BankMapping } from "@/lib/finance/bank/csv";

type Draft = Partial<BankMapping>;
const NONE = "";

/** One dropdown per bank field, listing the file's columns. Amount is either one column or debit plus credit. */
export function BankMappingForm({ header, mapping, onChange }: { header: string[]; mapping: Draft; onChange: (next: Draft) => void }) {
  const columns = header.map((name, i) => ({ value: String(i), label: `${i + 1}. ${name.trim() || "(blank)"}` }));
  const pick = (key: "date" | "description" | "amount" | "debit" | "credit" | "balance" | "reference", optional: boolean, label: string, helper?: string) => (
    <Field label={label} optional={optional} helperText={helper}>
      <Dropdown
        value={mapping[key] === undefined || mapping[key] === null ? NONE : String(mapping[key])}
        onChange={(event) => onChange({ ...mapping, [key]: event.target.value === NONE ? (optional ? null : undefined) : Number(event.target.value) })}
      >
        <option value={NONE}>{optional ? "Not in this file" : "Choose a column"}</option>
        {columns.map((c) => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </Dropdown>
    </Field>
  );
  const split = mapping.amount === null || mapping.amount === undefined ? (mapping.debit !== null && mapping.debit !== undefined) || (mapping.credit !== null && mapping.credit !== undefined) : false;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {pick("date", false, "Date")}
      {pick("description", false, "Description")}
      <Field label="Amount layout">
        <Dropdown value={split ? "split" : "single"} onChange={(event) => onChange(event.target.value === "split" ? { ...mapping, amount: null } : { ...mapping, debit: null, credit: null })}>
          <option value="single">One signed amount column</option>
          <option value="split">Separate debit and credit columns</option>
        </Dropdown>
      </Field>
      {split ? (
        <>
          {pick("debit", true, "Debit (money out)")}
          {pick("credit", true, "Credit (money in)")}
        </>
      ) : (
        pick("amount", false, "Amount", "Negative numbers, brackets and Dr/Cr are read as money out.")
      )}
      {pick("balance", true, "Balance")}
      {pick("reference", true, "Reference")}
      <Field label="Date order" helperText="Used only for dates like 03/04/2026.">
        <Dropdown value={mapping.dateOrder ?? "dmy"} onChange={(event) => onChange({ ...mapping, dateOrder: event.target.value as "dmy" | "mdy" })}>
          <option value="dmy">Day first (DD/MM/YYYY)</option>
          <option value="mdy">Month first (MM/DD/YYYY)</option>
        </Dropdown>
      </Field>
    </div>
  );
}
