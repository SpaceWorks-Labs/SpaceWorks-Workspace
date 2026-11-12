"use client";

import { Button } from "@/components/ui/button";
import { dueQuickPicks } from "@/lib/tasks/due";
import { useNow } from "./useNow";

/** One-click due dates: Today, Tomorrow, Next week (Monday) and Clear (only when there is a date to clear). */
export function DueQuickPicks({ timeZone, hasDate, onPick }: { timeZone: string; hasDate: boolean; onPick: (value: string) => void }) {
  const now = useNow();
  return (
    <div role="group" aria-label="Quick due dates" className="flex flex-wrap items-center gap-1.5">
      {dueQuickPicks(now, timeZone)
        .filter((pick) => pick.key !== "clear" || hasDate)
        .map((pick) => (
          <Button key={pick.key} variant={pick.key === "clear" ? "quiet" : "secondary"} size="sm" onClick={() => onPick(pick.value)}>
            {pick.label}
          </Button>
        ))}
    </div>
  );
}
