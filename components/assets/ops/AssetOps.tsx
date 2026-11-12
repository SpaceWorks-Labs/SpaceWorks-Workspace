import type { AssetDowntime } from "@prisma/client";
import type { SignoffMatrix } from "@/lib/makerspace/certStatus";
import { DowntimePanel } from "./DowntimePanel";
import { InductionsPanel } from "./InductionsPanel";

type Props = { slug: string; assetId: string; downtime: { current: AssetDowntime | null; history: AssetDowntime[] }; matrix: SignoffMatrix; allTypes: { id: string; name: string }[]; canManage: boolean; timeZone: string };

/** Makerspace additions for one asset card: downtime and required inductions. */
export function AssetOps({ slug, assetId, downtime, matrix, allTypes, canManage, timeZone }: Props) {
  return (
    <div className="mt-4">
      <DowntimePanel slug={slug} assetId={assetId} current={downtime.current} history={downtime.history} canManage={canManage} timeZone={timeZone} />
      <InductionsPanel slug={slug} assetId={assetId} matrix={matrix} allTypes={allTypes} canManage={canManage} timeZone={timeZone} />
    </div>
  );
}
