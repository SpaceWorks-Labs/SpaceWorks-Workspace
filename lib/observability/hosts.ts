import "server-only";
import { checkPort, privateTargetsEnabled, resolveTarget, STRICT_POLICY, normalizeHost, type LookupFn } from "@/lib/monitor/ssrf";

export type HostCheck = { ok: true; origin: string; hostname: string } | { ok: false; error: string };

/** Entries are exact host names or `*.suffix`. An empty allow-list allows nothing. */
export function hostMatchesAllowlist(hostname: string, allowlist: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return allowlist.some((raw) => {
    const entry = raw.trim().toLowerCase();
    if (!entry) return false;
    if (entry.startsWith("*.")) return host.endsWith(entry.slice(1)) && host.length > entry.length - 1;
    return host === entry;
  });
}

/** https, no credentials, no path: just an origin. */
export function parseHttpsOrigin(value: string): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { ok: false, error: "Enter a full https address, for example https://eu.i.posthog.com." };
  }
  if (url.protocol !== "https:") return { ok: false, error: "The address must start with https://." };
  if (url.username || url.password) return { ok: false, error: "Remove the user name and password from the address." };
  if (url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) return { ok: false, error: "Use the host only, without a path or query." };
  if (url.port && !checkPort(Number(url.port)).ok) return { ok: false, error: "Use a valid port." };
  return { ok: true, url };
}

/** A host a workspace may send data to: https, allow-listed, and not an internal address. */
export async function checkWorkspaceHost(value: string, allowlist: readonly string[], opts: { dns?: boolean; lookup?: LookupFn } = {}): Promise<HostCheck> {
  const parsed = parseHttpsOrigin(value);
  if (!parsed.ok) return parsed;
  const hostname = normalizeHost(parsed.url.hostname);
  if (!hostMatchesAllowlist(hostname, allowlist)) return { ok: false, error: "That host is not on this instance's allow-list. Ask the instance admin to add it." };
  const policy = privateTargetsEnabled() ? { allowPrivate: true, allowlist: [hostname] } : STRICT_POLICY;
  const target = await resolveTarget(hostname, policy, opts.dns === false ? async () => [{ address: "93.184.216.34", family: 4 }] : opts.lookup);
  if (!target.ok) return { ok: false, error: target.message };
  return { ok: true, origin: parsed.url.origin, hostname };
}

/** Link-out: any https URL, opened with rel="noopener noreferrer". */
export function parseLinkoutUrl(value: string): { ok: true; url: string } | { ok: false; error: string } {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("bad");
    return { ok: true, url: url.toString() };
  } catch {
    return { ok: false, error: "Enter a full https address, without a user name or password." };
  }
}
