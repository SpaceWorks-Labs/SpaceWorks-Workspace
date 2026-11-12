import type { CampaignStatus } from "@prisma/client";

/** Pure campaign state machine. */
export type CampaignAction = "edit" | "delete" | "schedule" | "unschedule" | "start" | "pause" | "resume" | "cancel" | "finish";

const ALLOWED: Record<CampaignAction, ReadonlyArray<CampaignStatus>> = {
  edit: ["DRAFT"],
  delete: ["DRAFT", "CANCELLED"],
  schedule: ["DRAFT"],
  unschedule: ["SCHEDULED"],
  start: ["SCHEDULED"],
  pause: ["RUNNING"],
  resume: ["PAUSED"],
  cancel: ["SCHEDULED", "RUNNING", "PAUSED"],
  finish: ["RUNNING"],
};

const TARGET: Partial<Record<CampaignAction, CampaignStatus>> = {
  schedule: "SCHEDULED",
  unschedule: "DRAFT",
  start: "RUNNING",
  pause: "PAUSED",
  resume: "RUNNING",
  cancel: "CANCELLED",
  finish: "FINISHED",
};

export function canApply(status: CampaignStatus, action: CampaignAction): boolean {
  return ALLOWED[action].includes(status);
}

/** The status an action leads to (undefined for edit and delete). */
export function targetStatus(action: CampaignAction): CampaignStatus | undefined {
  return TARGET[action];
}

export const TERMINAL_STATUSES: ReadonlyArray<CampaignStatus> = ["CANCELLED", "FINISHED"];

export const PAUSE_REASONS = {
  manual: "Paused by a person.",
  monthly_cap: "The monthly email cap was reached.",
  max_errors: "Too many sends failed in a row.",
  no_smtp: "No email transport is configured.",
  footer_missing: "The footer postal address is not set.",
} as const;

export function describePausedReason(reason: string | null): string {
  return reason && reason in PAUSE_REASONS ? PAUSE_REASONS[reason as keyof typeof PAUSE_REASONS] : "Paused.";
}
