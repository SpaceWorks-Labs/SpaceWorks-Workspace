import "server-only";
import { checkPort, privateTargetsEnabled, resolveTarget, STRICT_POLICY } from "@/lib/monitor/ssrf";

/** One guarded GET to a health URL. Never follows redirects and returns a short, safe sentence. */
export async function probeHealth(base: string, path: string): Promise<{ ok: boolean; message: string }> {
  let url: URL;
  try { url = new URL(path, base.endsWith("/") ? base : `${base}/`); } catch { return { ok: false, message: "That URL is not valid." }; }
  if (url.protocol !== "https:" && !privateTargetsEnabled()) return { ok: false, message: "Use an https URL." };
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  const portVerdict = checkPort(port);
  if (!portVerdict.ok) return { ok: false, message: portVerdict.message };
  const target = await resolveTarget(url.hostname, privateTargetsEnabled() ? { ...STRICT_POLICY, allowPrivate: true } : STRICT_POLICY);
  if (!target.ok) return { ok: false, message: target.message };
  try {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" } });
    return response.ok ? { ok: true, message: "Reachable." } : { ok: false, message: `The service answered ${response.status}. Check the URL.` };
  } catch {
    return { ok: false, message: "Couldn't reach it. Check the URL and the network." };
  }
}
