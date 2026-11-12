"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cancelRequest } from "@/app/actions/orgRequests";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/display";
import { RequestOrganisationForm } from "@/components/orgs/RequestOrganisationForm";
import { RequestStatusChip } from "@/components/orgs/RequestStatusChip";
import type { OrgRequestStatus } from "@prisma/client";

export type RequestListItem = {
  id: string;
  summary: string;
  status: OrgRequestStatus;
  createdAt: string;
  decisionNote: string | null;
  message: string | null;
  /** Set for a pending new-organisation request, which the requester may still change. */
  editable: { name: string; slug: string; message: string } | null;
  /** The organisation an approved request created or changed, while it is open. */
  openHref: string | null;
};

const NEXT_STEP: Partial<Record<OrgRequestStatus, string>> = {
  PENDING: "The instance admin reviews it. We'll email you when it's decided.",
  REJECTED: "You can send a new request above with the changes the admin asked for.",
};

/** The requester's own requests: change or cancel while pending, open the organisation once approved. */
export function MyRequestsList({ items }: { items: RequestListItem[] }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.id}>
          <Card className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <p className="text-label text-ink">{item.summary}</p>
                <p className="text-caption text-ink-muted">Sent {item.createdAt}</p>
                {item.message ? <p className="text-body-ui text-ink-muted">Your reason: {item.message}</p> : null}
                {item.decisionNote ? <p className="text-body-ui text-ink">Note from the admin: {item.decisionNote}</p> : null}
                {NEXT_STEP[item.status] ? <p className="text-body-ui text-ink-secondary">{NEXT_STEP[item.status]}</p> : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <RequestStatusChip status={item.status} />
                {item.openHref ? <Link href={item.openHref} className={buttonClasses({ size: "sm" })}>Open organisation</Link> : null}
                {item.editable && editing !== item.id ? <Button size="sm" onClick={() => setEditing(item.id)}>Edit</Button> : null}
                {item.status === "PENDING" ? (
                  <Button
                    size="sm"
                    variant="quiet"
                    loading={pending}
                    onClick={() => startTransition(async () => {
                      const result = await cancelRequest(item.id);
                      showToast(result.ok ? "Request cancelled." : result.error, result.ok ? "success" : "error");
                      router.refresh();
                    })}
                  >
                    Cancel request
                  </Button>
                ) : null}
              </div>
            </div>
            {item.editable && editing === item.id ? (
              <RequestOrganisationForm edit={{ requestId: item.id, initial: item.editable, onDone: () => setEditing(null) }} />
            ) : null}
          </Card>
        </li>
      ))}
    </ul>
  );
}
