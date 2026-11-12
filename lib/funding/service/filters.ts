import "server-only";
import { Prisma } from "@prisma/client";
import {
  SECTION_KINDS,
  dayInZone,
  type Section,
} from "@/lib/funding/schema";
import type { Actor } from "./access";

export type Filters = {
  q?: string;
  kind?: string;
  status?: string;
  owner?: string;
  overdue?: string;
  archived?: string;
  page?: string;
  person?: string;
  year?: string;
  contact?: string;
  segment?: string;
  major?: string;
  currency?: string;
  /** "pending": received money gifts not yet posted to the ledger. */
  ledger?: string;
};
export function recordsWhere(
  actor: Actor,
  section: Section,
  filters: Filters,
): Prisma.FundingRecordWhereInput {
  const kinds = SECTION_KINDS[section];
  const kind = kinds.find((k) => k === filters.kind);
  return {
    workspaceId: actor.workspace.id,
    archivedAt: filters.archived === "1" ? { not: null } : null,
    kind: kind ?? { in: kinds },
    ...(filters.q
      ? { title: { contains: filters.q.slice(0, 200), mode: "insensitive" } }
      : {}),
    ...(filters.status ? { status: filters.status.slice(0, 30) } : {}),
    ...(filters.owner ? { ownerId: filters.owner.slice(0, 64) } : {}),
    ...(filters.contact ? { contactId: filters.contact.slice(0, 64) } : {}),
    ...(filters.ledger === "pending" && section === "donations"
      ? { kind: "DONATION" as const, status: "RECEIVED", ledgerEntryId: null, details: { path: ["mode"], not: "IN_KIND" } }
      : {}),
    ...(filters.person && section === "access"
      ? {
          kind: "TOOL_ACCOUNT",
          details: { path: ["userId"], equals: filters.person.slice(0, 64) },
        }
      : {}),
    ...(filters.year && /^20\d{2}$/.test(filters.year)
      ? section === "tracker"
        ? { details: { path: ["year"], equals: Number(filters.year) } }
        : {
            dateOn: {
              gte: new Date(`${filters.year}-01-01`),
              lt: new Date(`${Number(filters.year) + 1}-01-01`),
            },
          }
      : {}),
    ...(filters.overdue === "1"
      ? {
          dueOn: {
            lt: new Date(dayInZone(new Date(), actor.workspace.timezone)),
          },
          status: {
            in: [
              "TODO",
              "EXPECTED",
              "APPLYING",
              "SUBMITTED",
              "RECEIVING",
              "REPORTING",
              "IDEA",
              "AWARDED",
            ],
          },
        }
      : {}),
  };
}
