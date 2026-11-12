"use client";

import { useState, useTransition } from "react";
import { importContactsAction, importCsvAction } from "@/app/actions/campaignSubscribers";
import type { ImportSummary } from "@/lib/campaigns/import";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";

type Result = { ok: true; data?: ImportSummary } | { ok: false; error: string };

export function ImportForm({ slug, lists }: { slug: string; lists: { id: string; name: string }[] }) {
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const read = (fd: FormData) => ({ listIds: fd.getAll("list").map(String), attest: fd.get("attest") === "on" });
  const checks = (
    <>
      <fieldset><legend className="text-label text-ink">Add to lists</legend><div className="mt-1 flex flex-wrap gap-4">{lists.map((l) => <label key={l.id} className="flex min-h-11 items-center gap-2"><input type="checkbox" name="list" value={l.id} />{l.name}</label>)}</div></fieldset>
      <label className="flex items-center gap-2"><input type="checkbox" name="attest" required /> I have permission to email these people</label>
    </>
  );
  return (
    <div className="min-w-0 space-y-6" aria-busy={pending}>
      {result && !result.ok ? <Callout tone="danger" role="alert">{result.error}</Callout> : null}
      {result?.ok && result.data ? (
        <Callout tone="success" title="Import finished" role="status">
          {result.data.created} new, {result.data.existing} already known, {result.data.skipped} skipped (blocklisted), {result.data.problemCount} rows with problems.
          {result.data.problems.length ? <ul className="mt-2 list-disc pl-5">{result.data.problems.map((p) => <li key={p.line}>Row {p.line}: {p.message}</li>)}</ul> : null}
        </Callout>
      ) : null}
      <form className="grid gap-4 rounded-xl border border-line bg-panel p-6" onSubmit={(event) => { event.preventDefault(); const fd = new FormData(event.currentTarget); start(async () => setResult(await importCsvAction(slug, { csv, ...read(fd) }))); }}>
        <h2 className="text-h3">Import a CSV</h2>
        <p className="text-caption text-ink-muted">Up to 10,000 rows and 2 MB. Needs an email column; name is optional and any other column becomes an attribute. Previous unsubscribes are kept.</p>
        <input type="file" accept=".csv,text/csv" aria-label="CSV file" required onChange={async (e) => setCsv((await e.target.files?.[0]?.text()) ?? "")} />
        {checks}
        <div><Button type="submit" variant="primary" disabled={pending || !csv}>Import CSV</Button></div>
      </form>
      <form className="grid gap-4 rounded-xl border border-line bg-panel p-6" onSubmit={(event) => { event.preventDefault(); const fd = new FormData(event.currentTarget); start(async () => setResult(await importContactsAction(slug, { ...read(fd), includeUnknown: fd.get("unknown") === "on" }))); }}>
        <h2 className="text-h3">Import from contacts</h2>
        <p className="text-caption text-ink-muted">Takes contacts that are not marked do-not-contact and have given consent. People who later unsubscribe are marked as not consenting.</p>
        <label className="flex items-center gap-2"><input type="checkbox" name="unknown" /> Also include contacts whose consent is unknown</label>
        {checks}
        <div><Button type="submit" variant="primary" disabled={pending}>Import contacts</Button></div>
      </form>
    </div>
  );
}
