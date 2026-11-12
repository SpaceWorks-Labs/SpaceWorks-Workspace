import "server-only";
import { getObsSettings } from "../keys";
import { envelopeUrl, parseDsn, sameDsn } from "./dsn";

export const SENTRY_TUNNEL_MAX_BYTES = 200 * 1024;

/** Read at most `max` bytes; null when the body is larger. */
export async function readCapped(request: Request, max: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}

/** The envelope header is its first line (JSON). Returns its `dsn`, or null. */
export function envelopeDsn(body: Uint8Array): string | null {
  const newline = body.indexOf(10);
  const head = new TextDecoder().decode(newline === -1 ? body : body.subarray(0, newline));
  try {
    const parsed = JSON.parse(head) as { dsn?: unknown };
    return typeof parsed.dsn === "string" ? parsed.dsn : null;
  } catch {
    return null;
  }
}

export async function handleSentryTunnel(request: Request, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const settings = await getObsSettings();
  const dsn = parseDsn(settings.sentry.dsn);
  if (!settings.sentry.enabled || !dsn) return new Response(null, { status: 404 });
  const body = await readCapped(request, SENTRY_TUNNEL_MAX_BYTES);
  if (!body) return new Response(null, { status: 413 });
  const claimed = envelopeDsn(body);
  if (!claimed || !sameDsn(claimed, settings.sentry.dsn)) return new Response(null, { status: 403 });
  try {
    // Only the configured DSN's host is ever contacted, and redirects are not followed.
    const upstream = await fetchImpl(envelopeUrl(dsn), {
      method: "POST",
      headers: { "content-type": "application/x-sentry-envelope" },
      body: body as unknown as BodyInit,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    return new Response(null, { status: upstream.status >= 200 && upstream.status < 300 ? 200 : 502 });
  } catch {
    return new Response(null, { status: 502 });
  }
}
