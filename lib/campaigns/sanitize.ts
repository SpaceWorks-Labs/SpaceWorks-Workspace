import sanitizeHtml from "sanitize-html";

/**
 * Email allow-list sanitiser. Campaign bodies and templates pass through it
 * on save. Allowed: images over https, tables, spans, headings, paragraphs,
 * links, lists, emphasis, breaks, rules and a short list of inline styles.
 * Never allowed: scripts, iframes, forms, style tags, event handlers or
 * `data:` URLs.
 */

export const MAX_CAMPAIGN_HTML_LENGTH = 500_000;

/** Link targets that are replaced per recipient at send time. */
export const PLACEHOLDER_HREFS = new Set(["{{unsubscribe_url}}", "{{preferences_url}}"]);

const SAFE_VALUE = /^(?!.*(?:url\s*\(|expression|javascript|@import|behavior|\\))[#(),.\w\s%'-]{1,120}$/i;
const STYLE_PROPERTIES = [
  "color", "background-color", "font-size", "font-weight", "font-style", "font-family", "text-align", "text-decoration",
  "line-height", "padding", "padding-top", "padding-right", "padding-bottom", "padding-left", "margin", "margin-top",
  "margin-bottom", "border", "border-top", "border-bottom", "border-radius", "width", "max-width", "height", "vertical-align",
];

const ALLOWED_STYLES = { "*": Object.fromEntries(STYLE_PROPERTIES.map((name) => [name, [SAFE_VALUE]])) };

const TABLE_ATTRIBUTES = ["style", "width", "align", "valign", "colspan", "rowspan", "cellpadding", "cellspacing", "border", "bgcolor"];

function safeHref(raw: string): string {
  const value = raw.trim();
  if (PLACEHOLDER_HREFS.has(value.replace(/\s+/g, ""))) return value.replace(/\s+/g, "");
  return /^(https?:\/\/[^\s]+|mailto:[^\s]+)$/i.test(value) ? value : "";
}

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1", "h2", "h3", "h4", "p", "br", "hr", "div", "span", "blockquote", "strong", "b", "em", "i", "u", "s", "small", "a",
    "ul", "ol", "li", "img", "table", "thead", "tbody", "tr", "th", "td",
  ],
  allowedAttributes: {
    "*": ["style"],
    a: ["href", "title", "style"],
    img: ["src", "alt", "width", "height", "style"],
    table: TABLE_ATTRIBUTES,
    th: TABLE_ATTRIBUTES,
    td: TABLE_ATTRIBUTES,
    tr: ["style"],
    ol: ["start", "style"],
  },
  allowedStyles: ALLOWED_STYLES,
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["https"] },
  allowedSchemesAppliedToAttributes: ["href", "src"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  nonTextTags: ["script", "style", "textarea", "option", "noscript", "title", "iframe", "object", "embed", "svg", "math", "template", "form", "head"],
  transformTags: {
    b: "strong",
    i: "em",
    a: (tagName, attribs): sanitizeHtml.Tag => {
      const href = safeHref(attribs.href ?? "");
      const next: Record<string, string> = {};
      if (href) next.href = href;
      if (attribs.title) next.title = attribs.title;
      if (attribs.style) next.style = attribs.style;
      return { tagName, attribs: next };
    },
  },
};

export function sanitizeCampaignHtml(html: string): string {
  return sanitizeHtml(html.slice(0, MAX_CAMPAIGN_HTML_LENGTH), OPTIONS);
}
