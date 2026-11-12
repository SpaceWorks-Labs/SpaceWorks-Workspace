import { REQUESTABLE_LIMITS, moduleLabel, type RequestableLimit } from "./constants";
import { formatBytes } from "@/lib/limits/format";

/** One-line description of a request, for emails and lists. */
export function describeRequest(request: { kind: string; requestedName: string | null; payload: unknown }, workspaceName?: string | null): string {
  const payload = (request.payload ?? {}) as Record<string, unknown>;
  const where = workspaceName ? ` for ${workspaceName}` : "";
  if (request.kind === "NEW_ORG") return `New organisation "${request.requestedName ?? "Untitled"}"`;
  if (request.kind === "MORE_LIMIT") {
    const key = String(payload.limit ?? "") as RequestableLimit;
    const meta = REQUESTABLE_LIMITS[key];
    const requested = Number(payload.requested ?? 0);
    const value = meta?.unit === "bytes" ? formatBytes(requested) : requested.toLocaleString("en");
    return `${meta?.label ?? "Limit"} raised to ${value}${where}`;
  }
  if (request.kind === "FEATURE") return `Access to ${moduleLabel(String(payload.module ?? ""))}${where}`;
  return `Request${where}`;
}
