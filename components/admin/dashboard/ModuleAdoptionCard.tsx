import { Card, CardHeader, Chip, EmptyState, ProgressBar } from "@/components/ui/display";
import type { ModuleAdoption } from "@/lib/admin/dashboard/types";

export function ModuleAdoptionCard({ adoption, activeOrgs }: { adoption: ModuleAdoption[]; activeOrgs: number }) {
  const sorted = [...adoption].sort((a, b) => b.on - a.on || a.label.localeCompare(b.label));
  return (
    <Card as="section" aria-label="Module adoption" className="min-w-0">
      <CardHeader title="Module adoption" description={`Modules switched on across ${activeOrgs} active ${activeOrgs === 1 ? "organisation" : "organisations"}. Core is always on.`} />
      {activeOrgs === 0 ? (
        <EmptyState className="border-0" title="No active organisations yet." />
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {sorted.map((module) => (
            <li key={module.key} className="flex flex-col gap-1.5 py-2.5">
              <div className="flex items-center justify-between gap-3 text-body-ui">
                <span className="flex min-w-0 items-center gap-2 text-ink">
                  <span className="truncate">{module.label}</span>
                  {module.optIn ? <Chip tone="neutral" size="sm">Opt-in</Chip> : null}
                </span>
                <span className="shrink-0 tabular-nums text-ink-muted">{module.on} on, {module.off} off</span>
              </div>
              <ProgressBar label={`${module.label}: on in ${module.on} of ${activeOrgs}`} value={module.on} max={activeOrgs} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
