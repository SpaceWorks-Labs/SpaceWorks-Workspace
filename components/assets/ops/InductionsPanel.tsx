import { saveRequiredInductions } from "@/app/actions/makerspace";
import { OpsForm } from "@/components/requests/OpsForm";
import { PersistentSection } from "@/components/stock/PersistentSection";
import { Callout, Chip, type ChipTone } from "@/components/ui/display";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate } from "@/lib/format/datetime";
import { needsAttention, SIGNOFF_LABEL, type SignoffMatrix, type SignoffStatus } from "@/lib/makerspace/certStatus";

const TONE: Record<SignoffStatus, ChipTone> = { valid: "success", expiring: "warning", expired: "danger", missing: "neutral" };

type Props = { slug: string; assetId: string; matrix: SignoffMatrix; allTypes: { id: string; name: string }[]; canManage: boolean; timeZone: string };

export function InductionsPanel({ slug, assetId, matrix, allTypes, canManage, timeZone }: Props) {
  const attention = needsAttention(matrix);
  return (
    <PersistentSection id={`asset-inductions-${assetId}`} title="Required inductions" count={matrix.types.length}>
      <div className="space-y-4">
        {attention.length ? (
          <Callout tone="warning" title="Sign-offs expiring or expired" role="status">
            {attention.slice(0, 5).map((a) => `${a.name}: ${matrix.types.find((t) => t.id === a.typeId)?.name} ${a.status === "expired" ? "expired" : "expires"} ${a.expiresAt ? formatDate(a.expiresAt, timeZone) : ""}`).join(". ")}
            {attention.length > 5 ? `. And ${attention.length - 5} more.` : ""}
          </Callout>
        ) : null}
        {matrix.types.length ? (
          <Table label="Who is signed off">
            <THead><TR><TH>{matrix.full ? "Member" : "You"}</TH>{matrix.types.map((t) => <TH key={t.id}>{t.name}</TH>)}</TR></THead>
            <TBody>
              {matrix.rows.map((row) => (
                <TR key={row.userId}>
                  <TD>{row.name}</TD>
                  {matrix.types.map((t) => {
                    const cell = row.cells[t.id]!;
                    return <TD key={t.id}><Chip tone={TONE[cell.status]} size="sm">{SIGNOFF_LABEL[cell.status]}</Chip>{cell.expiresAt ? <span className="ml-2 text-caption text-ink-muted">{formatDate(cell.expiresAt, timeZone)}</span> : null}</TD>;
                  })}
                </TR>
              ))}
            </TBody>
          </Table>
        ) : <p className="text-body-ui text-ink-muted">No inductions required for this machine.</p>}
        {canManage ? (
          <OpsForm
            action={saveRequiredInductions.bind(null, slug)}
            hidden={{ assetId }}
            label="Save required inductions"
            fields={[{ name: "certTypeIds", label: "Required training", multiple: true, value: matrix.types.map((t) => t.id).join(","), options: allTypes.map((t) => ({ value: t.id, label: t.name })) }]}
          />
        ) : null}
      </div>
    </PersistentSection>
  );
}
