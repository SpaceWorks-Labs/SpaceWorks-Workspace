"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { commitBankImportAction, previewBankImportAction } from "@/app/actions/finance-bank";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { Callout, Card, CardHeader } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/field";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { bankMappingSchema, guessMapping, type BankMapping } from "@/lib/finance/bank/csv";
import type { BankPreview } from "@/lib/finance/bank";
import { MAX_BANK_BYTES } from "@/lib/finance/bank/types";
import { parseCsv } from "@/lib/finance/csv";
import { formatMoney } from "@/lib/format/money";
import { BankMappingForm } from "./BankMappingForm";

type Loaded = { name: string; text: string; format: "CSV" | "OFX"; rows: string[][] };

/** Choose a file, map CSV columns, preview every line, then import. Nothing is saved until the last click. */
export function BankImport({ slug, accountId, accountName, currency }: { slug: string; accountId: string; accountName: string; currency: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [file, setFile] = useState<Loaded | null>(null);
  const [mapping, setMapping] = useState<Partial<BankMapping>>({ dateOrder: "dmy", hasHeader: true });
  const [preview, setPreview] = useState<BankPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const reset = () => {
    setPreview(null);
    setError(null);
  };
  const pick = async (chosen: File | undefined) => {
    reset();
    setFile(null);
    if (!chosen) return;
    if (chosen.size > MAX_BANK_BYTES) return setError("That file is too large. Import at most 1 MB at a time.");
    const text = await chosen.text();
    const format = /<OFX[\s>]/i.test(text) ? "OFX" : "CSV";
    if (format === "OFX") return setFile({ name: chosen.name, text, format, rows: [] });
    const parsed = parseCsv(text);
    if (!parsed.ok) return setError(parsed.error);
    if (parsed.rows.length < 2) return setError("The file has no transaction rows.");
    setMapping({ dateOrder: "dmy", hasHeader: true, ...guessMapping(parsed.rows[0]!) });
    setFile({ name: chosen.name, text, format, rows: parsed.rows });
  };

  const payload = () => {
    if (!file) return null;
    if (file.format === "OFX") return { accountId, format: "OFX", filename: file.name, text: file.text };
    const parsed = bankMappingSchema.safeParse({ hasHeader: true, dateOrder: "dmy", ...mapping, amount: mapping.amount ?? null, debit: mapping.debit ?? null, credit: mapping.credit ?? null });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Choose the date, description and amount columns.");
      return null;
    }
    return { accountId, format: "CSV", filename: file.name, text: file.text, mapping: parsed.data };
  };
  const runPreview = () => {
    reset();
    const body = payload();
    if (!body) return;
    start(async () => {
      const result = await previewBankImportAction(slug, body);
      if (!result.ok) return setError(result.error);
      setPreview(result.data ?? null);
    });
  };
  const commit = () => {
    const body = payload();
    if (!body) return;
    start(async () => {
      const result = await commitBankImportAction(slug, body);
      if (!result.ok) return showToast(result.error, "error");
      showToast(`Imported ${result.data?.imported ?? 0} lines${result.data?.skipped ? `; ${result.data.skipped} already imported were skipped` : ""}.`, "success");
      setFile(null);
      setPreview(null);
      router.refresh();
    });
  };
  const ready = !!preview && preview.problems.length === 0 && preview.newCount > 0 && !preview.fileAlreadyImported;

  return (
    <Card padding="lg">
      <CardHeader title={`Import a statement into ${accountName}`} description={`CSV or OFX/QFX, up to 1 MB and 5,000 lines. Amounts are read in ${currency}; Indian number formats like 1,00,000.50 work.`} />
      <div className="mt-4 flex flex-col gap-4">
        <Field label="Statement file" error={error ?? undefined}>
          <Input type="file" accept=".csv,.ofx,.qfx,.txt,text/csv" className="py-2" disabled={pending} onChange={(e) => void pick(e.target.files?.[0])} />
        </Field>
        {file?.format === "CSV" ? (
          <>
            <label className="flex items-center gap-2 text-body-ui">
              <input type="checkbox" checked={mapping.hasHeader ?? true} onChange={(e) => { setMapping({ ...mapping, hasHeader: e.target.checked }); reset(); }} />
              The first row holds column names
            </label>
            <BankMappingForm header={mapping.hasHeader === false ? file.rows[0]!.map((_, i) => `Column ${i + 1}`) : file.rows[0]!} mapping={mapping} onChange={(next) => { setMapping(next); reset(); }} />
            <p className="text-caption text-ink-muted">First row after the header: {file.rows[mapping.hasHeader === false ? 0 : 1]?.join(" | ").slice(0, 200)}</p>
          </>
        ) : null}
        {file ? <div><Button variant="secondary" onClick={runPreview} loading={pending && !preview}>Preview {file.name}</Button></div> : null}
        {preview ? <PreviewBody preview={preview} currency={currency} /> : null}
        {preview ? (
          <div className="flex justify-end gap-2.5">
            <Button variant="secondary" onClick={() => { setPreview(null); setFile(null); }} disabled={pending}>Cancel</Button>
            <Button variant="primary" onClick={commit} disabled={!ready} loading={pending && ready}>Import {preview.newCount} new {preview.newCount === 1 ? "line" : "lines"}</Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function PreviewBody({ preview, currency }: { preview: BankPreview; currency: string }) {
  return (
    <>
      {preview.fileAlreadyImported ? (
        <Callout tone="warning" title="This exact file was already imported for this account.">Choose a different statement.</Callout>
      ) : preview.problems.length ? (
        <Callout tone="danger" title={`${preview.problems.length} ${preview.problems.length === 1 ? "row needs" : "rows need"} fixing before import.`}>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
            {preview.problems.slice(0, 30).map((p) => <li key={p.row}>Row {p.row}: {p.message}.</li>)}
          </ul>
        </Callout>
      ) : (
        <Callout tone="success" title={`${preview.newCount} new ${preview.newCount === 1 ? "line" : "lines"} ready${preview.duplicateCount ? `; ${preview.duplicateCount} already imported will be skipped` : ""}.`}>
          {preview.fromDate && preview.toDate ? `Dated ${preview.fromDate} to ${preview.toDate}. ` : ""}Nothing changes until you import.
        </Callout>
      )}
      <Table label="Statement preview">
        <THead><TR><TH>Row</TH><TH>Date</TH><TH>Description</TH><TH>Reference</TH><TH className="text-right">Amount</TH></TR></THead>
        <TBody>
          {preview.sample.slice(0, 25).map((l) => (
            <TR key={l.row}>
              <TD className="tabular-nums text-ink-muted">{l.row}</TD>
              <TD className="whitespace-nowrap tabular-nums">{l.postedOn}</TD>
              <TD>{l.description}</TD>
              <TD className="text-ink-secondary">{l.reference ?? "-"}</TD>
              <TD className="whitespace-nowrap text-right font-semibold tabular-nums">{l.amountMinor < 0 ? "-" : "+"}{formatMoney(Math.abs(l.amountMinor), currency)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}
