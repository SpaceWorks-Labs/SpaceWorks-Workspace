// Generated from app/w/[workspaceSlug]/funding/[section]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canViewFunding } from "@/lib/roles";
import { loadFunding, type Filters } from "@/lib/funding/service";
import { SECTIONS, SECTION_KINDS, type Kind, type Section } from "@/lib/funding/schema";
import { loadLedgerChoices } from "@/lib/funding/service/ledger-link-queries";

export async function loadPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/funding/[section]">) {
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
return viewDto({ actor, section, filters, create, data, ledger } as const);
}
