"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/format/datetime";
import { groupHistory, historyText } from "@/lib/tasks/historyGroups";
import type { TaskDetailDTO } from "@/lib/tasks/types";

/** Task history in plain language (see lib/tasks/activityText). */
export function TaskHistory({ task }: { task: TaskDetailDTO }) {
  const [showAllActivity, setShowAllActivity] = useState(false);
  // Consecutive description saves by the same person read as one row.
  const grouped = useMemo(() => groupHistory(task.activity), [task.activity]);
  const visibleActivity = showAllActivity ? grouped : grouped.slice(0, 8);
  return (
    <section aria-labelledby={`history-${task.id}`} className="flex flex-col gap-3">
      <h3 id={`history-${task.id}`} className="text-title text-ink">
        History
      </h3>
      <ol className="flex flex-col gap-2.5 border-l border-line pl-4">
        {visibleActivity.map((item) => (
          <li key={item.id} className="text-body-ui text-ink-secondary">
            <span className="font-semibold text-ink">{item.actor?.name ?? (item.kind === "created_recurring" ? "This task" : "Someone")}</span> {historyText(item)}
            <span className="text-caption text-ink-muted"> · {formatRelativeTime(item.createdAt, task.timeZone)}</span>
          </li>
        ))}
      </ol>
      {grouped.length > 8 ? (
        <Button variant="quiet" size="sm" className="self-start" onClick={() => setShowAllActivity((value) => !value)}>
          {showAllActivity ? "Show less" : `Show all ${grouped.length}`}
        </Button>
      ) : null}
    </section>
  );
}
