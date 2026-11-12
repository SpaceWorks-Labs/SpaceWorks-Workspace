import "server-only";

import { checkRateLimitById } from "@/lib/rateLimit";
import { authenticateApiToken, type AuthenticatedToken } from "@/lib/apiTokens";
import { executeTool, type ExecuteOutcome } from "@/lib/assistant/tools";

/**
 * Shared plumbing for /api/v1 route handlers: bearer-token auth, per-token
 * rate limits, and error envelopes `{ error: { code, message } }`.
 */

const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;

export function apiError(status: number, code: string, message: string, extra: Record<string, string> = {}) {
  return Response.json({ error: { code, message } }, { status, headers: { ...HEADERS, ...extra } });
}

export function apiJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: HEADERS });
}

export const unauthorized = () => apiError(401, "UNAUTHORIZED", "Send a valid API token as 'Authorization: Bearer sww_…'.", { "WWW-Authenticate": 'Bearer realm="space-works"' });

/** Authenticate and rate-limit; returns the token or a ready error response. */
export async function requireApiToken(request: Request, kind: "read" | "write"): Promise<AuthenticatedToken | Response> {
  const token = await authenticateApiToken(request.headers.get("authorization"));
  if (!token) return unauthorized();
  if (!(await checkRateLimitById(kind === "write" ? "apiWrite" : "apiRead", `token:${token.principal.tokenId}`))) {
    return apiError(429, "RATE_LIMITED", "Too many requests. Try again later.", { "Retry-After": "60" });
  }
  return token;
}

const STATUS_BY_CODE: Record<string, number> = { forbidden: 403, not_found: 404, invalid: 400, conflict: 409, rate_limited: 429, unavailable: 503, internal: 500 };

/** Run an sw_* tool for a v1 endpoint and map failures to HTTP errors. */
export async function runApiTool(token: AuthenticatedToken, name: string, input: unknown): Promise<{ ok: true; data: unknown } | { ok: false; response: Response }> {
  const outcome: ExecuteOutcome = await executeTool(token.principal, name, input, { via: "api" });
  if (outcome.ok) return { ok: true, data: outcome.result.data };
  const status = STATUS_BY_CODE[outcome.code] ?? 400;
  return { ok: false, response: apiError(status, outcome.code.toUpperCase(), outcome.error) };
}

/** Read `?limit=&cursor=` (and other string params) into a plain object. */
export function queryParams(request: Request, numeric: readonly string[] = ["limit"]): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of new URL(request.url).searchParams) {
    if (!value) continue;
    out[key] = numeric.includes(key) && /^\d+$/.test(value) ? Number(value) : value;
  }
  return out;
}

export async function readJson(request: Request): Promise<unknown> {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return null;
  return request.json().catch(() => null);
}

/** Optional-body read: an absent/empty body is `{}`; a present body that is not JSON stays `null` (so the caller answers 400, never a silent default). */
async function readOptionalJson(request: Request): Promise<unknown> {
  const text = await request.text().catch(() => null);
  if (text === null) return null;
  if (text.trim() === "") return {};
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** GET list endpoint: run a list tool and answer `{ data: [...], nextCursor }`. */
export async function listEndpoint(request: Request, tool: string, key: string, numeric: readonly string[] = ["limit"]) {
  const token = await requireApiToken(request, "read");
  if (token instanceof Response) return token;
  const result = await runApiTool(token, tool, queryParams(request, numeric));
  if (!result.ok) return result.response;
  const body = result.data as Record<string, unknown>;
  return apiJson({ data: body[key] ?? [], nextCursor: (body.nextCursor as string | null | undefined) ?? null });
}

/** GET single-record endpoint: `{ data: {...} }`. */
export async function getEndpoint(request: Request, tool: string, input: Record<string, unknown>) {
  const token = await requireApiToken(request, "read");
  if (token instanceof Response) return token;
  const result = await runApiTool(token, tool, input);
  return result.ok ? apiJson({ data: result.data }) : result.response;
}

/** POST/PATCH endpoint: JSON body merged with the path input; `{ data }` (201 for creates). */
export async function writeEndpoint(request: Request, tool: string, pathInput: Record<string, unknown>, status = 200, options: { bodyOptional?: boolean; requiredStrings?: readonly string[] } = {}) {
  const token = await requireApiToken(request, "write");
  if (token instanceof Response) return token;
  const body = options.bodyOptional ? await readOptionalJson(request) : await readJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(400, "INVALID", "Send a JSON object body with Content-Type: application/json.");
  for (const field of options.requiredStrings ?? []) {
    const value = (body as Record<string, unknown>)[field];
    if (typeof value !== "string" || !value.trim()) return apiError(400, "INVALID", `"${field}" is required.`);
  }
  const result = await runApiTool(token, tool, { ...(body as Record<string, unknown>), ...pathInput });
  return result.ok ? apiJson({ data: result.data }, status) : result.response;
}
