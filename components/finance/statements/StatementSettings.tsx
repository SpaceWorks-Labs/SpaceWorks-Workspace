"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setFiscalYearStart, setFundFcra } from "@/app/actions/finance-statements";
import { Card, CardHeader } from "@/components/ui/display";
import { Field, Dropdown, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { SwitchRow } from "@/components/ui/choice";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Admin-only controls: financial year start month, and which funds are FCRA funds. */
export function StatementSettings({ slug, startMonth, funds, fcraCsvHref }: { slug: string; startMonth: number; funds: Array<{ id: string; name: string; fcra: boolean }>; fcraCsvHref: string }) {
  const router = useRouter();
  const [month, setMonth] = useState(String(startMonth));
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => {
    try { const r = await fn(); setMessage(r.ok ? "Saved." : r.error ?? "Couldn't save. Try again."); if (r.ok) router.refresh(); }
    catch { setMessage("Couldn't save. Try again."); }
  });
  return (
    <Card className="flex flex-col gap-4 print:hidden">
      <CardHeader title="Statement settings" description="Only owners and admins can change these." />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Financial year starts in"><Dropdown value={month} onChange={(e) => setMonth(e.target.value)}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Dropdown></Field>
        <Button variant="secondary" loading={pending} onClick={() => run(() => setFiscalYearStart(slug, month))}>Save year start</Button>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-title">FCRA funds</h3>
        <p className="text-caption text-ink-muted">Gifts marked foreign-source can only be recorded in a fund marked FCRA.</p>
        {funds.length ? funds.map((f) => <SwitchRow key={f.id} label={f.name} checked={f.fcra} disabled={pending} onCheckedChange={(v) => run(() => setFundFcra(slug, f.id, v))} />) : <p className="text-ink-muted">No funds yet. Add one under Funds.</p>}
        <div className="flex flex-wrap items-end gap-3">
          <form method="get" action={fcraCsvHref} className="flex flex-wrap items-end gap-3">
            <Field label="FCRA receipts, year"><Input name="year" type="number" min={2000} max={2200} defaultValue={new Date().getFullYear()} /></Field>
            <Field label="Quarter"><Dropdown name="quarter" defaultValue="1">{[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}</Dropdown></Field>
            <Button type="submit" variant="secondary">Download FCRA receipts CSV</Button>
          </form>
        </div>
      </div>
      <p role="status" className="text-caption">{message}</p>
    </Card>
  );
}
