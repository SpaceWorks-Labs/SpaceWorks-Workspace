/**
 * Small Markdown to HTML converter for campaign bodies: headings, emphasis,
 * code spans, links, https images, lists, quotes and rules. Source text is
 * escaped first and the result is sanitised again before storage.
 */

const escapeText = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(raw: string): string {
  let text = escapeText(raw);
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  text = text.replace(/!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1">');
  text = text.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:|\{\{)[^\s)]*)\)/g, '<a href="$2">$1</a>');
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/__([^_]+)__/g, "<strong>$1</strong>");
  return text.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\*)/g, "$1<em>$2</em>").replace(/(^|[^_\w])_([^_\s][^_]*)_(?!\w)/g, "$1<em>$2</em>");
}

export function markdownToHtml(source: string): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((item) => `<li>${inline(item)}</li>`).join("")}</${list.tag}>`);
    list = null;
  };
  for (const line of lines) {
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);
    if (!line.trim()) {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      out.push(`<h${heading[1]!.length}>${inline(heading[2]!)}</h${heading[1]!.length}>`);
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushParagraph();
      flushList();
      out.push("<hr>");
    } else if (bullet || ordered) {
      flushParagraph();
      const tag = bullet ? "ul" : "ol";
      if (list && list.tag !== tag) flushList();
      list ??= { tag, items: [] };
      list.items.push((bullet ?? ordered)![1]!);
    } else if (quote) {
      flushParagraph();
      flushList();
      out.push(`<blockquote><p>${inline(quote[1]!)}</p></blockquote>`);
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return out.join("\n");
}

/** Plain text to paragraphs with line breaks. */
export function plainToHtml(source: string): string {
  return source
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeText(block).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}
