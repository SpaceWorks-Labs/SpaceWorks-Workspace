import type { WorkspaceRole } from "@prisma/client";
import { hasRoleAtLeast } from "@/lib/roles";
import type { ApiScope } from "@/lib/apiTokens/scopes";

/**
 * Who is calling an assistant tool. Every tool reads and writes with the
 * caller's own rights, never more:
 *
 * - `user`: a signed-in member in the web chat (their live membership role).
 * - `token`: an API token (MCP or /api/v1). It acts for its creator, limited
 *   by its scopes; the creator must still be an active admin or owner. Tokens
 *   never see direct messages or private channels.
 * - `job`: a scheduled job. It runs for its creator but with member-level
 *   rights at most and without private channels, because its answer is posted
 *   where others can read it.
 */
export type PrincipalKind = "user" | "token" | "job";

export type PrincipalWorkspace = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  currency: string;
  financeVisibleToMembers: boolean;
};

export type Principal = {
  kind: PrincipalKind;
  workspace: PrincipalWorkspace;
  /** The signed-in user, the token's creator or the job's creator. */
  userId: string;
  userName: string | null;
  /** Effective role (capped at MEMBER for jobs). */
  role: WorkspaceRole;
  tokenId?: string;
  /** The API token's name (MCP and /api/v1 callers), for history provenance. */
  tokenName?: string;
  scopes?: readonly ApiScope[];
};

/** How a write reached us, for audit metadata. */
export type ToolChannel = "chat" | "mcp" | "api" | "job";

export function effectiveJobRole(role: WorkspaceRole): WorkspaceRole {
  return hasRoleAtLeast(role, "MEMBER") ? "MEMBER" : role;
}

/** Private channels (and DMs) are only reachable by signed-in members themselves. */
export function canUsePrivateChannels(principal: Pick<Principal, "kind">): boolean {
  return principal.kind === "user";
}
