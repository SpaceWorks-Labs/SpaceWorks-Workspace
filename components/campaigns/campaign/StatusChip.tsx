import type { CampaignStatus } from "@prisma/client";
import { Chip, type ChipTone } from "@/components/ui/display";

const TONES: Record<CampaignStatus, { tone: ChipTone; label: string }> = {
  DRAFT: { tone: "neutral", label: "Draft" },
  SCHEDULED: { tone: "info", label: "Scheduled" },
  RUNNING: { tone: "accent", label: "Sending" },
  PAUSED: { tone: "warning", label: "Paused" },
  CANCELLED: { tone: "outline", label: "Cancelled" },
  FINISHED: { tone: "success", label: "Finished" },
};

export function CampaignStatusChip({ status }: { status: CampaignStatus }) {
  const { tone, label } = TONES[status];
  return <Chip tone={tone}>{label}</Chip>;
}
