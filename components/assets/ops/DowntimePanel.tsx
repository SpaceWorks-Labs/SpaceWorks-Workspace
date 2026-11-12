import type { AssetDowntime } from "@prisma/client";
import { markBackInService, markOutOfService } from "@/app/actions/makerspace";
import { OpsForm } from "@/components/requests/OpsForm";
import { PersistentSection } from "@/components/stock/PersistentSection";
import { Callout } from "@/components/ui/display";
import { formatDate } from "@/lib/format/datetime";

type Props = { slug: string; assetId: string; current: AssetDowntime | null; history: AssetDowntime[]; canManage: boolean; timeZone: string };

export function DowntimePanel({ slug, assetId, current, history, canManage, timeZone }: Props) {
  return (
    <PersistentSection id={`asset-downtime-${assetId}`} title="Downtime" count={history.length} defaultOpen={Boolean(current)}>
      <div className="space-y-4">
        {current ? (
          <Callout tone="danger" title={`Out of service since ${formatDate(current.from, timeZone)}`} role="status">
            {current.reason}
          </Callout>
        ) : null}
        {canManage && current ? <OpsForm action={markBackInService.bind(null, slug)} hidden={{ downtimeId: current.id }} label="Back in service" /> : null}
        {canManage && !current ? (
          <OpsForm
            action={markOutOfService.bind(null, slug)}
            hidden={{ assetId }}
            label="Mark out of service"
            fields={[{ name: "reason", label: "Reason", required: true, type: "textarea" }, { name: "from", label: "From", type: "date", helper: "Leave empty to start now." }]}
          />
        ) : null}
        {history.length ? (
          <ul className="space-y-1">
            {history.map((d) => (
              <li key={d.id} className="text-body-ui">
                {formatDate(d.from, timeZone)} to {d.to ? formatDate(d.to, timeZone) : "now"}: {d.reason}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body-ui text-ink-muted">No downtime recorded.</p>
        )}
      </div>
    </PersistentSection>
  );
}
