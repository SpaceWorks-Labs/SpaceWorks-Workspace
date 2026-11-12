import { normalizePath } from "../routes";

type Props = Record<string, unknown>;

/** Properties that can carry a URL, a host, a title or free text. */
const DROP = [
  "$referrer", "$referring_domain", "$initial_referrer", "$initial_referring_domain", "$initial_current_url", "$initial_pathname",
  "$session_entry_url", "$session_entry_pathname", "$session_entry_referrer", "$session_entry_referring_domain", "$host", "$title",
  "$initial_host", "title", "$ip",
];

/** Strip query, hash and ids from URL properties; keep only a templated path. */
export function sanitizePosthogProperties(properties: Props): Props {
  const out: Props = { ...properties };
  for (const key of DROP) delete out[key];
  const current = typeof out.$current_url === "string" ? out.$current_url : typeof out.$pathname === "string" ? out.$pathname : null;
  if (current !== null) {
    let path = current;
    try { path = new URL(current, "http://local.invalid").pathname; } catch { /* keep as is */ }
    const template = normalizePath(path);
    out.$current_url = template;
    out.$pathname = template;
  }
  return out;
}
