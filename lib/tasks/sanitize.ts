import "server-only";

import sanitizeHtml from "sanitize-html";
import { isInlineImageSrc } from "@/lib/tasks/inlineImages";

/**
 * Task descriptions are rich text from the editor (tiptap). Everything is
 * sanitised on the server before it is stored; the stored HTML is the only
 * thing ever rendered. Only the formatting the editor produces survives.
 */

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s", "code", "pre", "blockquote", "ul", "ol", "li", "h2", "h3", "h4", "hr", "a", "img"],
  allowedAttributes: { a: ["href", "rel", "target"], ol: ["start"], img: ["src", "alt"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer nofollow", target: "_blank" }),
    h1: "h2",
    b: "strong",
    i: "em",
  },
  /** Images only from our own authenticated file route; anything else is dropped. */
  exclusiveFilter: (frame) => frame.tag === "img" && !isInlineImageSrc(frame.attribs.src),
  disallowedTagsMode: "discard",
};

export const MAX_DESCRIPTION_HTML = 50_000;

/** Sanitised HTML, or null when nothing readable is left. */
export function sanitizeDescription(html: string | null | undefined): string | null {
  if (!html) return null;
  const clean = sanitizeHtml(html.slice(0, MAX_DESCRIPTION_HTML * 2), OPTIONS).trim();
  if (!clean || (htmlToText(clean).length === 0 && !clean.includes("<img"))) return null;
  return clean.slice(0, MAX_DESCRIPTION_HTML);
}

/** Plain text for search and notifications. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  return sanitizeHtml(html.replace(/<\/(p|li|h[1-6]|blockquote|pre)>|<br\s*\/?>/gi, "$& "), { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
