"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ignoreBankLineAction, matchBankLineAction, unmatchBankLineAction } from "@/app/actions/finance-bank";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/display";
import { Dropdown } from "@/components/ui/field";
import { confidenceLabel } from "@/lib/finance/bank/matcher";
import type { BankLineView } from "@/lib/finance/bank";
import { formatMoney } from "@/lib/format/money";
import { CreateEntryDialog, type EntryOptions } from "./CreateEntryDialog";

/** Everything you can do with one bank line, depending on its status. */
export function BankLineActions({ slug, line, options, canManage }: { slug: string; line: BankLineView; options: EntryOptions; canManage: boolean }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, start] = useTransition();
  const [creating, setCreating] = useState(false);
  const [chosen, setChosen] = useState("");
  const act = (work: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    start(async () => {
      const result = await work();
      if (!result.ok) return showToast(result.error ?? "Couldn't save. Try again.", "error");
      showToast(done, "success");
      router.refresh();
    });

  if (line.status === "MATCHED")
    return (
      <div className="flex flex-col items-start gap-1.5">
        <Chip tone="success">Matched</Chip>
        {line.matchedEntry ? <span className="text-caption text-ink-secondary">{line.matchedEntry.occurredOn}: {line.matchedEntry.description}</span> : null}
        {canManage ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => unmatchBankLineAction(slug, line.id), "Match removed.")}>Unmatch</Button> : null}
      </div>
    );
  if (line.status === "IGNORED")
    return (
      <div className="flex flex-col items-start gap-1.5">
        <Chip>Ignored</Chip>
        {canManage ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => ignoreBankLineAction(slug, line.id, false), "Line restored.")}>Restore</Button> : null}
      </div>
    );
  return (
    <div className="flex flex-col items-start gap-2">
      {line.suggestion ? (
        <div className="flex flex-col gap-1.5 rounded-md bg-surface p-2">
          <span className="text-caption text-ink-secondary">
            <Chip tone={line.suggestion.confidence >= 0.8 ? "success" : "info"} size="sm">{confidenceLabel(line.suggestion.confidence)}</Chip>{" "}
            {line.suggestion.entry.occurredOn}: {line.suggestion.entry.description} ({formatMoney(line.suggestion.entry.amountMinor, line.currency)})
          </span>
          <span className="text-caption text-ink-muted">{line.suggestion.reasons.join(", ")}</span>
          {canManage ? <Button size="sm" variant="primary" disabled={pending} onClick={() => act(() => matchBankLineAction(slug, line.id, line.suggestion!.entryId), "Matched and reconciled.")}>Accept match</Button> : null}
        </div>
      ) : null}
      {canManage ? (
        <>
          {line.options.length ? (
            <div className="flex items-center gap-2">
              <Dropdown aria-label="Pick an entry manually" value={chosen} onChange={(e) => setChosen(e.target.value)}>
                <option value="">Pick an entry</option>
                {line.options.map((e) => <option key={e.id} value={e.id}>{e.occurredOn}: {e.description.slice(0, 40)}</option>)}
              </Dropdown>
              <Button size="sm" variant="secondary" disabled={!chosen || pending} onClick={() => act(() => matchBankLineAction(slug, line.id, chosen), "Matched and reconciled.")}>Match</Button>
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => setCreating(true)}>Create entry</Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => ignoreBankLineAction(slug, line.id, true), "Line ignored.")}>Ignore</Button>
          </div>
          <CreateEntryDialog slug={slug} line={line} options={options} open={creating} onOpenChange={setCreating} onDone={() => router.refresh()} />
        </>
      ) : null}
    </div>
  );
}
