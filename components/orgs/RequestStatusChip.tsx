import type { OrgRequestStatus } from "@prisma/client";
import { Chip, type ChipTone } from "@/components/ui/display";

const STATUS: Record<OrgRequestStatus, { tone: ChipTone; label: string }> = {
  PENDING: { tone: "warning", label: "Waiting for approval" },
  APPROVED: { tone: "success", label: "Approved" },
  REJECTED: { tone: "danger", label: "Not approved" },
  CANCELLED: { tone: "neutral", label: "Cancelled" },
};

export function RequestStatusChip({ status }: { status: OrgRequestStatus }) {
  const { tone, label } = STATUS[status];
  return <Chip tone={tone} size="sm">{label}</Chip>;
}
