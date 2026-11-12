import { DAY_MS, isoDateOfDayNumber, localDayNumber, localToInstant, weekdayOfDayNumber } from "@/lib/tasks/localDate";

/**
 * Due dates (pure, client-safe). A task's `dueAt` is the start of its local
 * due day in the workspace time zone; the UI shows the date only.
 */

export type DueBucket = "overdue" | "today" | "week" | "later" | "none";

export const DUE_BUCKETS: ReadonlyArray<{ key: DueBucket; label: string }> = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Due today" },
  { key: "week", label: "Due this week" },
  { key: "later", label: "Later" },
  { key: "none", label: "No due date" },
];

/** Group for "My tasks": overdue, today, the rest of this week (to Sunday), later, no date. */
export function dueBucket(dueAt: Date | string | null | undefined, now: Date, timeZone: string): DueBucket {
  if (!dueAt) return "none";
  const due = localDayNumber(new Date(dueAt), timeZone);
  const today = localDayNumber(now, timeZone);
  if (due < today) return "overdue";
  if (due === today) return "today";
  const endOfWeek = today + (6 - weekdayOfDayNumber(today));
  return due <= endOfWeek ? "week" : "later";
}

export function isOverdue(dueAt: Date | string | null | undefined, completedAt: Date | string | null | undefined, now: Date, timeZone: string): boolean {
  return !completedAt && dueBucket(dueAt, now, timeZone) === "overdue";
}

/** Local hour at which due and overdue reminders go out. */
export const REMINDER_HOUR = 9;

/**
 * When the reminders for a due date fire: "due today" at 9 AM on the due
 * day, "overdue" at 9 AM the day after.
 */
export function reminderTimes(dueAt: Date, timeZone: string): { dueReminderAt: Date; overdueReminderAt: Date } {
  const day = localDayNumber(dueAt, timeZone);
  return {
    dueReminderAt: localToInstant(day, REMINDER_HOUR, 0, timeZone),
    overdueReminderAt: localToInstant(day + 1, REMINDER_HOUR, 0, timeZone),
  };
}

/** Which reminder (if any) is due now. Overdue wins once its time has come; stale ones (over a week) are skipped. */
export function reminderDue(dueAt: Date, now: Date, timeZone: string): "due" | "overdue" | null {
  const { dueReminderAt, overdueReminderAt } = reminderTimes(dueAt, timeZone);
  if (now >= overdueReminderAt) return now.getTime() - overdueReminderAt.getTime() <= 7 * DAY_MS ? "overdue" : null;
  if (now >= dueReminderAt) return "due";
  return null;
}

export type DueQuickPick = { key: "today" | "tomorrow" | "next-week" | "clear"; label: string; /** "YYYY-MM-DD" in the workspace zone, "" clears the date. */ value: string };

/**
 * One-click due dates: today, tomorrow, next Monday ("Next week") and Clear.
 * Dates are local calendar days in the workspace time zone.
 */
export function dueQuickPicks(now: Date, timeZone: string): DueQuickPick[] {
  const today = localDayNumber(now, timeZone);
  const nextMonday = today + (7 - weekdayOfDayNumber(today));
  return [
    { key: "today", label: "Today", value: isoDateOfDayNumber(today) },
    { key: "tomorrow", label: "Tomorrow", value: isoDateOfDayNumber(today + 1) },
    { key: "next-week", label: "Next week", value: isoDateOfDayNumber(nextMonday) },
    { key: "clear", label: "Clear", value: "" },
  ];
}
