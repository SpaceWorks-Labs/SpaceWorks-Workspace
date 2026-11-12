import Link from "next/link";

/** Previous/next links that keep the other query parameters. */
export function Pager({ basePath, params, page, pages }: { basePath: string; params: Record<string, string | undefined>; page: number; pages: number }) {
  if (pages <= 1) return null;
  const href = (target: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
    search.set("page", String(target));
    return `${basePath}?${search.toString()}`;
  };
  const link = "rounded-md border border-line bg-panel px-3 py-2 text-label text-ink hover:bg-muted";
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-3 text-body-ui text-ink-muted">
      {page > 1 ? <Link className={link} href={href(page - 1)}>Previous</Link> : <span />}
      <span>Page {page} of {pages}</span>
      {page < pages ? <Link className={link} href={href(page + 1)}>Next</Link> : <span />}
    </nav>
  );
}
