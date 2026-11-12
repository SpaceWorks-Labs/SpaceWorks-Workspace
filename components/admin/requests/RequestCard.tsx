"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideRequestAction } from "@/app/actions/adminRequests";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { Card, Chip } from "@/components/ui/display";
import { Field, Input, Textarea } from "@/components/ui/field";

export type RequestCardData = {
  id: string;
  kind: "NEW_ORG" | "MORE_LIMIT" | "FEATURE" | "OTHER";
  status: string;
  title: string;
  requester: string;
  message: string | null;
  decisionNote: string | null;
  createdLabel: string;
  workspaceHref: string | null;
};

const KIND_LABEL = { NEW_ORG: "New organisation", MORE_LIMIT: "More capacity", FEATURE: "Feature", OTHER: "Other" } as const;
const toNumber = (text: string) => (text.trim() === "" ? null : Number(text));

export function RequestCard({ data }: { data: RequestCardData }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [limits, setLimits] = useState({ maxMembers: "", maxGuests: "", maxProjects: "", maxStorageMb: "", plan: "" });
  const [error, setError] = useState<string | null>(null);
  const decide = (decision: "APPROVED" | "REJECTED") =>
    startTransition(async () => {
      const initialLimits = data.kind === "NEW_ORG" && decision === "APPROVED"
        ? { maxMembers: toNumber(limits.maxMembers), maxGuests: toNumber(limits.maxGuests), maxProjects: toNumber(limits.maxProjects), maxStorageMb: toNumber(limits.maxStorageMb), plan: limits.plan.trim() || null }
        : undefined;
      const result = await decideRequestAction({ requestId: data.id, decision, note: note || undefined, initialLimits });
      if (!result.ok) {
        const message = /already decided/i.test(result.error) ? "Already decided" : result.error;
        setError(message); showToast(message, "error"); router.refresh(); return;
      }
      showToast(decision === "APPROVED" ? "Request approved." : "Request rejected.", "success");
      router.refresh();
    });
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-label text-ink">{data.title}</p>
          <p className="text-caption text-ink-muted">{data.requester} · {data.createdLabel}</p>
        </div>
        <Chip tone={data.status === "PENDING" ? "info" : data.status === "APPROVED" ? "success" : "neutral"} size="sm">{KIND_LABEL[data.kind]} · {data.status.toLowerCase()}</Chip>
      </div>
      {data.message ? <p className="mt-3 text-body-ui text-ink">{data.message}</p> : null}
      {data.workspaceHref ? <a className="mt-2 inline-block text-caption underline underline-offset-4" href={data.workspaceHref}>View organisation</a> : null}
      {data.status !== "PENDING" ? (data.decisionNote ? <p className="mt-3 text-caption text-ink-muted">Decision: {data.decisionNote}</p> : null) : (
        <div className="mt-4 flex flex-col gap-4">
          {data.kind === "NEW_ORG" ? (
            <fieldset className="grid gap-3 sm:grid-cols-3">
              <legend className="mb-2 text-label text-ink">Starting limits (optional, empty inherits)</legend>
              {(["maxMembers", "maxGuests", "maxProjects", "maxStorageMb"] as const).map((key) => (
                <Field key={key} label={{ maxMembers: "Members", maxGuests: "Guests", maxProjects: "Projects", maxStorageMb: "Storage (MB)" }[key]}>
                  <Input type="number" min={0} inputMode="numeric" value={limits[key]} onChange={(e) => setLimits((v) => ({ ...v, [key]: e.target.value }))} />
                </Field>
              ))}
              <Field label="Plan label"><Input maxLength={60} value={limits.plan} onChange={(e) => setLimits((v) => ({ ...v, plan: e.target.value }))} /></Field>
            </fieldset>
          ) : null}
          <Field label="Note to the requester" helperText="Required to reject." error={error ?? undefined}>
            <Textarea rows={2} maxLength={1000} value={note} onChange={(e) => { setNote(e.target.value); setError(null); }} />
          </Field>
          <div className="flex gap-2">
            <Button variant="primary" loading={pending} onClick={() => decide("APPROVED")}>Approve</Button>
            <Button variant="dangerOutline" loading={pending} disabled={!note.trim()} onClick={() => decide("REJECTED")}>Reject</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
