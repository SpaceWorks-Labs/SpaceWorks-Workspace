import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canViewFunding } from "@/lib/roles";
import { loadFunding, type Filters } from "@/lib/funding/service";
import { SECTIONS, SECTION_KINDS, type Kind, type Section } from "@/lib/funding/schema";
import { loadLedgerChoices } from "@/lib/funding/service/ledger-link-queries";
import { FundingScreen } from "@/components/funding/Screen";
export const metadata = { title: "Funding tools" };
export default async function Page({ params, searchParams }: PageProps<"/w/[workspaceSlug]/funding/[section]">) {
  const { workspaceSlug, section: sectionParam } = await params;
  const actor = await requireWorkspace(workspaceSlug, "ADMIN");
  if (!canViewFunding(actor.membership) || !SECTIONS.includes(sectionParam as Section)) notFound();
  const section = sectionParam as Section;
  const query = await searchParams;
  const filters: Filters = Object.fromEntries(Object.entries(query).map(([key, value]) => [key, typeof value === "string" ? value : undefined]));
  const edit = typeof query.edit === "string" ? query.edit : undefined;
  const create = typeof query.new === "string" && SECTION_KINDS[section].includes(query.new as Kind) ? query.new as Kind : undefined;
  const data = await loadFunding(actor, section, filters, edit);
  if (edit && !data.selected) notFound();
  const ledger = section === "donations" ? await loadLedgerChoices(actor) : undefined;
  return <FundingScreen slug={workspaceSlug} timezone={actor.workspace.timezone} currency={actor.workspace.currency} section={section} filters={filters} data={data} create={create} ledger={ledger} />;
}
