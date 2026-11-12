import type { OrgRequestKind, OrgRequestStatus } from "@prisma/client";

export type OrgRequestInput =
  | { kind: "NEW_ORG"; name: string; slug: string; message?: string | null }
  | { kind: "MORE_LIMIT"; workspaceId: string; limit: string; requested: number; message?: string | null }
  | { kind: "FEATURE"; workspaceId: string; module: string; message?: string | null };

export type OrgRequestRow = {
  id: string;
  kind: OrgRequestKind;
  status: OrgRequestStatus;
  workspaceId: string | null;
  workspaceName: string | null;
  workspaceSlug: string | null;
  /** The linked organisation exists, is ACTIVE and not archived. */
  workspaceOpen: boolean;
  requestedName: string | null;
  requestedSlug: string | null;
  payload: Record<string, unknown>;
  message: string | null;
  decisionNote: string | null;
  decidedAt: Date | null;
  createdAt: Date;
};

export type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export const fail = (error: string, fieldErrors?: Record<string, string[]>): { ok: false; error: string; fieldErrors?: Record<string, string[]> } =>
  fieldErrors ? { ok: false, error, fieldErrors } : { ok: false, error };
