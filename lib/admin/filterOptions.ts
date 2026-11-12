/** Pure filter values for the admin organisation list and request queue (client-safe). */
import type { OrgRequestKind, OrgRequestStatus, WorkspaceStatus } from "@prisma/client";

export const ORG_STATUSES: readonly WorkspaceStatus[] = ["PENDING", "ACTIVE", "SUSPENDED", "REJECTED"];
export const REQUEST_KINDS: readonly OrgRequestKind[] = ["NEW_ORG", "MORE_LIMIT", "FEATURE", "OTHER"];
export const REQUEST_STATUSES: readonly OrgRequestStatus[] = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"];
