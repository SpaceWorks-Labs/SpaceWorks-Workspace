/**
 * Bulk-mail headers for campaign messages: RFC 8058 one-click unsubscribe, a
 * deterministic Message-ID (so a retry after a crash reuses the same id) and
 * an opaque campaign reference.
 */
export function campaignHeaders(input: { unsubscribeUrl: string; messageId: string; domain: string; ref: string }): Record<string, string> {
  const clean = (value: string) => value.replace(/[\r\n<>]/g, "");
  return {
    "List-Unsubscribe": `<${clean(input.unsubscribeUrl)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    "Message-ID": `<c-${clean(input.messageId)}@${clean(input.domain)}>`,
    Precedence: "bulk",
    "X-Campaign-Ref": clean(input.ref),
  };
}
