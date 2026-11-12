import { parseCsvText } from "@/lib/csv";
import { attributeKey, isDomainBlocked, isValidEmail, normaliseEmail } from "./policy";

export const MAX_IMPORT_ROWS = 10_000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_ATTRIBUTES = 20;

export type ImportRowOk = { line: number; email: string; name: string | null; attributes: Record<string, string> };
export type ImportProblem = { line: number; message: string };
export type ParsedImport = { ok: true; rows: ImportRowOk[]; problems: ImportProblem[] } | { ok: false; error: string };

/**
 * Validate an import file: needs an `email` column, may have `name` and extra
 * columns (kept as attributes). Bad rows are reported per row, not fatal;
 * duplicates inside the file keep the first row. More than 10,000 rows or
 * 2 MB rejects the whole file.
 */
export function parseSubscriberCsv(text: string, domainBlocklist: readonly string[] = []): ParsedImport {
  if (Buffer.byteLength(text, "utf8") > MAX_IMPORT_BYTES) return { ok: false, error: "That file is over 2 MB. Split it into smaller files." };
  const parsed = parseCsvText(text);
  if (!parsed.ok) return parsed;
  const [header, ...data] = parsed.rows;
  if (!header) return { ok: false, error: "The file is empty. Add a header row with an email column." };
  const columns = header.map((h) => h.trim().toLowerCase());
  const emailIndex = columns.indexOf("email");
  if (emailIndex < 0) return { ok: false, error: "Add a column named email to the first row." };
  if (data.length > MAX_IMPORT_ROWS) return { ok: false, error: `That file has ${data.length.toLocaleString("en-US")} rows. Import up to 10,000 at a time.` };
  const nameIndex = columns.indexOf("name");
  const extra = columns.map((h, i) => ({ i, key: i === emailIndex || i === nameIndex ? null : attributeKey(h) })).filter((c): c is { i: number; key: string } => c.key !== null).slice(0, MAX_ATTRIBUTES);
  const rows: ImportRowOk[] = [];
  const problems: ImportProblem[] = [];
  const seen = new Set<string>();
  data.forEach((cells, index) => {
    const line = index + 2;
    const raw = (cells[emailIndex] ?? "").trim();
    if (!isValidEmail(raw)) return void problems.push({ line, message: raw ? "Not a valid email address." : "Email is empty." });
    const email = normaliseEmail(raw);
    if (isDomainBlocked(email, domainBlocklist)) return void problems.push({ line, message: "This email domain is blocklisted." });
    if (seen.has(email)) return void problems.push({ line, message: "Duplicate of an earlier row." });
    seen.add(email);
    const attributes: Record<string, string> = {};
    for (const { i, key } of extra) { const v = (cells[i] ?? "").trim().slice(0, 500); if (v) attributes[key] = v; }
    rows.push({ line, email, name: nameIndex >= 0 ? (cells[nameIndex] ?? "").trim().slice(0, 160) || null : null, attributes });
  });
  return { ok: true, rows, problems };
}
