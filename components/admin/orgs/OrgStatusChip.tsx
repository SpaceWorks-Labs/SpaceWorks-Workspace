import type { WorkspaceStatus } from "@prisma/client";
import { Chip, type ChipTone } from "@/components/ui/display";

const TONES: Record<WorkspaceStatus, { tone: ChipTone; label: string }> = {
  ACTIVE: { tone: "success", label: "Active" },
  PENDING: { tone: "info", label: "Pending" },
  SUSPENDED: { tone: "warning", label: "Suspended" },
  REJECTED: { tone: "danger", label: "Rejected" },
};

export function OrgStatusChip({ status }: { status: WorkspaceStatus }) {
  const { tone, label } = TONES[status];
  return <Chip tone={tone} size="sm">{label}</Chip>;
}
