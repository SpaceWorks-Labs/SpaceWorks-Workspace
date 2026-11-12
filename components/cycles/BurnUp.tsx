import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { burnUp, type CycleTask } from "@/lib/cycles/progress";
import { formatDate } from "@/lib/format/datetime";
export function BurnUp({
  tasks,
  startsAt,
  endsAt,
  timezone,
}: {
  tasks: CycleTask[];
  startsAt: Date;
  endsAt: Date;
  timezone: string;
}) {
  const points = burnUp(tasks, startsAt, endsAt);
  const max = Math.max(1, tasks.length);
  const line = (key: "scope" | "completed") =>
    points
      .map(
        (p, i) =>
          `${10 + (i / Math.max(1, points.length - 1)) * 480},${150 - (p[key] / max) * 130}`,
      )
      .join(" ");
  return (
    <figure className="space-y-3">
      <figcaption className="text-label">
        Burn-up: completed tasks and current scope
      </figcaption>
      <svg
        viewBox="0 0 500 170"
        role="img"
        aria-label="Cycle burn-up. Exact values are in the data table below."
        className="w-full max-w-2xl"
      >
        <polyline
          points={line("scope")}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray="8 4"
          className="text-chart-info"
        />
        <polyline
          points={line("completed")}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          className="text-chart-accent"
        />
      </svg>
      <p className="text-caption text-ink-muted">
        Solid line: completed. Dashed line: scope. History reflects the current
        task set until completion; the cycle review saves a snapshot before
        carry-over.
      </p>
      <details>
        <summary className="min-h-11 cursor-pointer text-accent-text">
          View chart data
        </summary>
        <div className="overflow-x-auto">
          <Table className="w-full text-left text-body-ui">
            <caption className="sr-only">Burn-up values</caption>
            <THead>
              <TR>
                <TH className="p-2" scope="col">
                  Date
                </TH>
                <TH scope="col">Scope</TH>
                <TH scope="col">Completed</TH>
              </TR>
            </THead>
            <TBody>
              {points.map((p, i) => (
                <TR key={i} className="border-t border-line">
                  <TH scope="row" className="p-2 font-medium">
                    {formatDate(p.at, timezone)}
                  </TH>
                  <TD>{p.scope}</TD>
                  <TD>{p.completed}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      </details>
    </figure>
  );
}
