"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveExternalCodesAction } from "@/app/actions/finance-mapping";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/display";
import { Input } from "@/components/ui/field";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

type Row = { id: string; name: string; detail: string; code: string };

/** One code per category and bank account: the ledger name or code your accounting software uses. */
export function AccountingMappingForm({ slug, categories, accounts, canManage }: { slug: string; categories: Row[]; accounts: Row[]; canManage: boolean }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, start] = useTransition();
  const [codes, setCodes] = useState<Record<string, string>>(() => Object.fromEntries([...categories, ...accounts].map((r) => [r.id, r.code])));
  const save = () =>
    start(async () => {
      const changed = (rows: Row[]) => rows.filter((r) => (codes[r.id] ?? "") !== r.code).map((r) => ({ id: r.id, code: codes[r.id] ?? "" }));
      const result = await saveExternalCodesAction(slug, { categories: changed(categories), accounts: changed(accounts) });
      if (!result.ok) return showToast(result.error, "error");
      showToast("Ledger codes saved.", "success");
      router.refresh();
    });
  const section = (title: string, rows: Row[]) => (
    <Table label={title}>
      <THead><TR><TH>{title}</TH><TH>Ledger name or code</TH></TR></THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.id}>
            <TD>{r.name} <span className="text-caption text-ink-muted">{r.detail}</span></TD>
            <TD>
              <Input aria-label={`Ledger code for ${r.name}`} value={codes[r.id] ?? ""} maxLength={100} readOnly={!canManage} onChange={(e) => setCodes({ ...codes, [r.id]: e.target.value })} />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
  return (
    <Card padding="lg">
      <CardHeader title="Ledger codes" description="Type the exact ledger name (Tally) or account code (Xero, QuickBooks, others). Entries whose category or account has no code are listed as unmapped and left out of the export." />
      <div className="mt-4 flex flex-col gap-5">
        {section("Category", categories)}
        {section("Bank account", accounts)}
        {canManage ? <div className="flex justify-end"><Button variant="primary" onClick={save} loading={pending}>Save codes</Button></div> : null}
      </div>
    </Card>
  );
}
