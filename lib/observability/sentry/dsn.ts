/** Minimal Sentry DSN parser (https://<key>@<host>/<project>). Pure. */
export type ParsedDsn = { key: string; host: string; projectId: string; origin: string; pathPrefix: string };

export function parseDsn(dsn: string | null | undefined): ParsedDsn | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn.trim());
    if (url.protocol !== "https:" || !url.username) return null;
    const segments = url.pathname.split("/").filter(Boolean);
    const projectId = segments.pop();
    if (!projectId || !/^[0-9]+$/.test(projectId)) return null;
    return { key: url.username, host: url.host, projectId, origin: url.origin, pathPrefix: segments.length ? `/${segments.join("/")}` : "" };
  } catch {
    return null;
  }
}

export function envelopeUrl(dsn: ParsedDsn): string {
  return `${dsn.origin}${dsn.pathPrefix}/api/${dsn.projectId}/envelope/?sentry_key=${encodeURIComponent(dsn.key)}&sentry_version=7`;
}

/** Two DSNs are the same when key, host and project match. */
export function sameDsn(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = parseDsn(a);
  const right = parseDsn(b);
  return Boolean(left && right && left.key === right.key && left.host === right.host && left.projectId === right.projectId && left.pathPrefix === right.pathPrefix);
}
