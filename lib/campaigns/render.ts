import { htmlToPlainText } from "@/lib/campaigns/plaintext";

/**
 * Pure campaign rendering: template slot, mandatory footer and placeholder
 * substitution. There is no template engine: a placeholder is a lookup in a
 * fixed value map, values are always escaped for HTML, unknown names render
 * empty, and substituted text is never expanded again.
 */

export const PLACEHOLDER_NAMES = ["name", "first_name", "email", "unsubscribe_url", "preferences_url", "workspace_name"] as const;

/** Built-in default template. `{{content}}` marks where the body goes. */
export const DEFAULT_TEMPLATE_HTML =
  '<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4"><tbody><tr><td align="center" style="padding:24px">' +
  '<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff"><tbody><tr><td style="padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#111111">' +
  "{{content}}</td></tr></tbody></table></td></tr></tbody></table>";

export const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const PLACEHOLDER = /\{\{\s*([a-z_]+(?:\.[a-z0-9_]{1,40})?)\s*\}\}/gi;
/** Values that are filled in by the sender and must not be escaped twice (already safe markup or URLs). */
export type PlaceholderValues = Record<string, string>;

export type SubscriberView = { email: string; name: string | null; attributes: unknown };

function attributeText(attributes: unknown, key: string): string {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) return "";
  const value = (attributes as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value).slice(0, 500) : "";
}

export function placeholderValues(subscriber: SubscriberView, extra: { workspaceName: string; unsubscribeUrl: string; preferencesUrl: string }): PlaceholderValues {
  const name = subscriber.name?.trim() ?? "";
  const values: PlaceholderValues = {
    name,
    first_name: name.split(/\s+/)[0] ?? "",
    email: subscriber.email,
    unsubscribe_url: extra.unsubscribeUrl,
    preferences_url: extra.preferencesUrl,
    workspace_name: extra.workspaceName,
  };
  if (subscriber.attributes && typeof subscriber.attributes === "object" && !Array.isArray(subscriber.attributes)) {
    for (const key of Object.keys(subscriber.attributes)) {
      if (/^[a-z0-9_]{1,40}$/.test(key)) values[`attr.${key}`] = attributeText(subscriber.attributes, key);
    }
  }
  return values;
}

/** Replace `{{name}}` style placeholders in a single pass. */
export function fillPlaceholders(source: string, values: PlaceholderValues, mode: "html" | "text" | "header"): string {
  return source.replace(PLACEHOLDER, (_match, rawName: string) => {
    const value = values[rawName.toLowerCase()] ?? "";
    if (mode === "html") return escapeHtml(value);
    return mode === "header" ? value.replace(/[\r\n]+/g, " ") : value;
  });
}

/** Footer with workspace name, postal address and unsubscribe link (always appended). */
export function footerHtml(address: string): string {
  const lines = escapeHtml(address).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join("<br>");
  return (
    '<table width="100%" cellpadding="0" cellspacing="0"><tbody><tr><td align="center" style="padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#666666">' +
    `<p>{{workspace_name}}<br>${lines}</p>` +
    '<p><a href="{{unsubscribe_url}}">Unsubscribe</a> | <a href="{{preferences_url}}">Manage preferences</a></p>' +
    "</td></tr></tbody></table>"
  );
}

export function footerText(address: string): string {
  return `\n\n--\n{{workspace_name}}\n${address.trim()}\nUnsubscribe: {{unsubscribe_url}}\nPreferences: {{preferences_url}}`;
}

/** Put content into the template slot (content is appended when the slot is missing). */
export function applyTemplate(templateHtml: string | null | undefined, contentHtml: string): string {
  const template = templateHtml?.trim() ? templateHtml : DEFAULT_TEMPLATE_HTML;
  return template.includes("{{content}}") ? template.replace("{{content}}", () => contentHtml) : `${template}${contentHtml}`;
}

export type CompiledCampaign = { html: string; text: string };

/**
 * Per-campaign source with placeholders left in. `html` and `text` still need
 * `fillPlaceholders` once per recipient (after link rewriting and pixel).
 */
export function compileCampaign(input: { templateHtml?: string | null; contentHtml: string; contentText?: string; footerAddress: string }): CompiledCampaign {
  const body = applyTemplate(input.templateHtml, input.contentHtml);
  const html = `${body}${footerHtml(input.footerAddress)}`;
  const text = `${input.contentText?.trim() || htmlToPlainText(input.contentHtml)}${footerText(input.footerAddress)}`;
  return { html, text };
}
