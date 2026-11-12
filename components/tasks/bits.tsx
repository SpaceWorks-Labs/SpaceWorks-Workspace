import type { TaskPriority } from "@prisma/client";

import { Avatar, Chip, type ChipTone } from "@/components/ui/display";
import { cn } from "@/lib/cn";
import { formatRelativeDay } from "@/lib/format/datetime";
import { labelChipTone } from "@/lib/labels";
import { dueBucket } from "@/lib/tasks/due";
import { PRIORITY_LABELS } from "@/lib/tasks/filters";
import type { TaskTypeRef } from "@/lib/tasks/taskTypes";
import type { LabelRef, PersonRef } from "@/lib/tasks/types";
import { TASK_TYPE_GLYPHS } from "./typeIcons";

/** Small presentational pieces shared by cards, rows and the task detail (server- and client-safe). */

const PRIORITY_TONES: Record<TaskPriority, ChipTone> = { URGENT: "danger", HIGH: "warning", MEDIUM: "info", LOW: "neutral", NONE: "outline" };

export function PriorityChip({ priority, size = "sm", hideNone = true }: { priority: TaskPriority; size?: "sm" | "md"; hideNone?: boolean }) {
  if (priority === "NONE" && hideNone) return null;
  return (
    <Chip tone={PRIORITY_TONES[priority]} size={size}>
      {PRIORITY_LABELS[priority]}
    </Chip>
  );
}

export function DueChip({ dueAt, completedAt, timeZone, size = "sm", now }: { dueAt: string | null; completedAt?: string | null; timeZone: string; size?: "sm" | "md"; now?: Date }) {
  if (!dueAt) return null;
  const reference = now ?? new Date();
  const bucket = dueBucket(dueAt, reference, timeZone);
  const tone: ChipTone = completedAt ? "neutral" : bucket === "overdue" ? "danger" : bucket === "today" ? "warning" : "neutral";
  const label = formatRelativeDay(dueAt, timeZone, reference);
  const phrase = /^(Today|Tomorrow|Yesterday|In )/.test(label) ? `${label.charAt(0).toLowerCase()}${label.slice(1)}` : label;
  return (
    <Chip tone={tone} size={size}>
      <span className="tabular-nums">{!completedAt && bucket === "overdue" ? `Overdue · ${label}` : `Due ${phrase}`}</span>
    </Chip>
  );
}

/** Type icon and name (`type` is the task's effective type). */
export function TypeChip({ type, size = "sm" }: { type: TaskTypeRef | null | undefined; size?: "sm" | "md" }) {
  if (!type) return null;
  const Glyph = TASK_TYPE_GLYPHS[type.icon];
  return (
    <Chip tone={labelChipTone(type.tone)} size={size} icon={<Glyph />}>
      {type.name}
    </Chip>
  );
}

export function BlockedChip({ size = "sm" }: { size?: "sm" | "md" }) {
  return (
    <Chip tone="danger" size={size} icon={null}>
      Blocked
    </Chip>
  );
}

export function RepeatChip({ label = "Repeats", size = "sm" }: { label?: string; size?: "sm" | "md" }) {
  return (
    <Chip tone="accent" size={size} icon={null}>
      {label}
    </Chip>
  );
}

export function LabelChips({ labelIds, labels, size = "sm", max = 3 }: { labelIds: string[]; labels: LabelRef[]; size?: "sm" | "md"; max?: number }) {
  const picked = labelIds.map((id) => labels.find((label) => label.id === id)).filter((label): label is LabelRef => Boolean(label));
  if (picked.length === 0) return null;
  const shown = picked.slice(0, max);
  return (
    <>
      {shown.map((label) => (
        <Chip key={label.id} tone={labelChipTone(label.tone)} size={size}>
          {label.name}
        </Chip>
      ))}
      {picked.length > shown.length ? (
        <Chip tone="outline" size={size}>
          {`+${picked.length - shown.length}`}
        </Chip>
      ) : null}
    </>
  );
}

export function AvatarStack({ people, max = 3, size = "xs", className }: { people: PersonRef[]; max?: number; size?: "xs" | "sm"; className?: string }) {
  if (people.length === 0) return null;
  const shown = people.slice(0, max);
  const names = people.map((person) => person.name ?? "Member").join(", ");
  return (
    <span className={cn("inline-flex items-center", className)} title={names}>
      <span className="sr-only">Assigned to {names}</span>
      <span aria-hidden className="inline-flex -space-x-1.5">
        {shown.map((person) => (
          <Avatar key={person.id} name={person.name} src={person.image} size={size} className="ring-2 ring-panel" />
        ))}
        {people.length > shown.length ? (
          <span className={cn("inline-flex items-center justify-center rounded-full bg-emphasis font-semibold text-ink-secondary ring-2 ring-panel", size === "xs" ? "size-6 text-xs" : "size-8 text-xs")}>
            +{people.length - shown.length}
          </span>
        ) : null}
      </span>
    </span>
  );
}

export function TaskRefText({ reference, className }: { reference: string; className?: string }) {
  return <span className={cn("text-caption font-semibold tabular-nums text-ink-muted", className)}>{reference}</span>;
}

/** "3/5" with a thin bar, for subtask progress. */
export function SubtaskProgress({ done, total }: { done: number; total: number }) {
  if (total === 0) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-caption tabular-nums text-ink-muted" title={`${done} of ${total} subtasks done`}>
      <span aria-hidden className="relative inline-block h-1.5 w-8 overflow-hidden rounded-full bg-track">
        <span className="absolute inset-y-0 left-0 rounded-full bg-success-solid" style={{ width: `${(done / total) * 100}%` }} />
      </span>
      <span>
        {done}/{total}
        <span className="sr-only"> subtasks done</span>
      </span>
    </span>
  );
}
