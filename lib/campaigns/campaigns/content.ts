import type { CampaignContentType } from "@prisma/client";
import { markdownToHtml, plainToHtml } from "@/lib/campaigns/markdown";
import { htmlToPlainText } from "@/lib/campaigns/plaintext";
import { compileCampaign, fillPlaceholders, placeholderValues } from "@/lib/campaigns/render";
import { sanitizeCampaignHtml } from "@/lib/campaigns/sanitize";

/** Sanitised HTML and the generated plain-text alternative for a campaign body. */
export function buildBody(contentType: CampaignContentType, source: string): { bodyHtml: string; bodyText: string } {
  if (contentType === "PLAIN") return { bodyHtml: sanitizeCampaignHtml(plainToHtml(source)), bodyText: source.trim() };
  const html = sanitizeCampaignHtml(contentType === "MARKDOWN" ? markdownToHtml(source) : source);
  return { bodyHtml: html, bodyText: htmlToPlainText(html) };
}

/** Rendered preview with sample data. Same pipeline as sending, without tracking. */
export function renderPreviewHtml(input: { bodyHtml: string; bodyText: string; templateHtml?: string | null; footerAddress: string; workspaceName: string; sample?: { name: string; email: string } }): { html: string; text: string } {
  const compiled = compileCampaign({ templateHtml: input.templateHtml, contentHtml: input.bodyHtml, contentText: input.bodyText, footerAddress: input.footerAddress || "(Postal address not set)" });
  const values = placeholderValues(
    { email: input.sample?.email ?? "sample@example.com", name: input.sample?.name ?? "Sample Subscriber", attributes: {} },
    { workspaceName: input.workspaceName, unsubscribeUrl: "#", preferencesUrl: "#" },
  );
  return { html: fillPlaceholders(compiled.html, values, "html"), text: fillPlaceholders(compiled.text, values, "text") };
}
