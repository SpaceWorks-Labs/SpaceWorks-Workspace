import { Parser } from "htmlparser2";

const BLOCKS = new Set(["p", "div", "h1", "h2", "h3", "h4", "tr", "blockquote", "ul", "ol", "table"]);

/** Plain-text alternative for sanitised campaign HTML. Links are written as `text (url)`. */
export function htmlToPlainText(html: string): string {
  let out = "";
  const hrefs: Array<string | null> = [];
  const parser = new Parser({
    onopentag(name, attribs) {
      if (name === "a") {
        hrefs.push(attribs.href ?? null);
      } else if (name === "li") {
        out += "\n- ";
      } else if (name === "br") {
        out += "\n";
      } else if (name === "hr") {
        out += "\n----\n";
      } else if (BLOCKS.has(name)) {
        out += "\n\n";
      } else if (name === "td" || name === "th") {
        out += " ";
      } else if (name === "img" && attribs.alt) {
        out += attribs.alt;
      }
    },
    ontext(text) {
      out += text.replace(/\s+/g, " ");
    },
    onclosetag(name) {
      if (name === "a") {
        const href = hrefs.pop();
        if (href && !out.trimEnd().endsWith(href)) out += ` (${href})`;
      } else if (BLOCKS.has(name)) {
        out += "\n";
      }
    },
  }, { decodeEntities: true });
  parser.write(html);
  parser.end();
  return out
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
