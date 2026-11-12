import { describe, expect, it } from "vitest";
import { sanitizeCampaignHtml } from "@/lib/campaigns/sanitize";
import { markdownToHtml } from "@/lib/campaigns/markdown";
import { htmlToPlainText } from "@/lib/campaigns/plaintext";
import { collectLinks, rewriteLinks } from "@/lib/campaigns/links";
import { compileCampaign, fillPlaceholders, placeholderValues } from "@/lib/campaigns/render";
import { canApply, targetStatus } from "@/lib/campaigns/campaigns/state";
import { classifySendError } from "@/lib/campaigns/transport";
import { takeFromMemory, resetRateLimit } from "@/lib/campaigns/send/rate";

describe("sanitizer", () => {
  it("drops scripts, iframes, forms, handlers and data URLs", () => {
    const out = sanitizeCampaignHtml('<p onclick="x()">Hi</p><script>alert(1)</script><iframe src="https://e.test"></iframe><form><input></form><style>p{}</style><img src="data:image/png;base64,AAA"><img src="http://e.test/a.png"><img src="https://e.test/a.png" alt="a">');
    expect(out).not.toMatch(/script|iframe|form|style>|onclick|data:|http:\/\//i);
    expect(out).toContain('src="https://e.test/a.png"');
  });
  it("keeps tables, safe styles and placeholder links, rejects javascript links and url() styles", () => {
    const out = sanitizeCampaignHtml('<table><tbody><tr><td style="color:#111;background:url(x)">a</td></tr></tbody></table><a href="javascript:alert(1)">x</a><a href="{{unsubscribe_url}}">u</a><span style="color:red">s</span>');
    expect(out).toContain("<table>");
    expect(out).toContain("color:#111");
    expect(out).not.toMatch(/url\(|javascript/);
    expect(out).toContain('href="{{unsubscribe_url}}"');
  });
});

describe("rendering", () => {
  const values = placeholderValues({ email: "a@x.test", name: "Ann <b>Lee</b>", attributes: { city: "A&B", "bad key": "x" } }, { workspaceName: "Acme", unsubscribeUrl: "https://u.test/1?a=1&b=2", preferencesUrl: "https://p.test" });
  it("escapes values, blanks unknown placeholders and never re-expands", () => {
    expect(fillPlaceholders("Hi {{first_name}} {{ attr.city }} {{nope}} {{attr.bad key}}", values, "html")).toBe("Hi Ann A&amp;B  {{attr.bad key}}");
    expect(fillPlaceholders("{{name}}", { name: "{{email}}", email: "e" }, "html")).toBe("{{email}}");
    expect(fillPlaceholders("{{name}}", values, "html")).toContain("&lt;b&gt;");
  });
  it("header mode removes line breaks", () => {
    expect(fillPlaceholders("{{name}}", { name: "a\r\nBcc: x" }, "header")).not.toMatch(/[\r\n]/);
  });
  it("always appends the footer and fills the template slot", () => {
    const c = compileCampaign({ contentHtml: "<p>Body</p>", footerAddress: "1 Main St\nKochi" });
    expect(c.html).toContain("<p>Body</p>");
    expect(c.html).toContain("{{unsubscribe_url}}");
    expect(c.html).toContain("1 Main St<br>Kochi");
    expect(c.text).toContain("Unsubscribe: {{unsubscribe_url}}");
  });
});

describe("markdown and plain text", () => {
  it("escapes raw HTML and renders basics", () => {
    const html = markdownToHtml("# Title\n\n**bold** [site](https://e.test) <script>x</script>\n\n- a\n- b");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('<a href="https://e.test">site</a>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("<li>a</li>");
  });
  it("generates a text alternative with link targets", () => {
    expect(htmlToPlainText('<p>Hello <a href="https://e.test">there</a></p><ul><li>one</li></ul>')).toBe("Hello there (https://e.test)\n\n- one");
  });
});

describe("link rewriting", () => {
  it("rewrites only tracked http links and keeps placeholders", () => {
    const html = '<a href="https://e.test/?a=1&amp;b=2">x</a><a href="{{unsubscribe_url}}">u</a><a href="mailto:a@b.c">m</a>';
    const urls = collectLinks(html);
    expect(urls).toEqual(["https://e.test/?a=1&b=2"]);
    const out = rewriteLinks(html, new Map([[urls[0]!, "L1"]]), "https://app.test");
    expect(out).toContain('href="https://app.test/api/public/campaigns/c/{{click_token}}/L1"');
    expect(out).toContain('href="{{unsubscribe_url}}"');
    expect(out).toContain("mailto:a@b.c");
  });
});

describe("state machine, error classes and rate bucket", () => {
  it("guards transitions", () => {
    expect(canApply("DRAFT", "schedule")).toBe(true);
    expect(canApply("RUNNING", "edit")).toBe(false);
    expect(canApply("FINISHED", "cancel")).toBe(false);
    expect(canApply("PAUSED", "resume")).toBe(true);
    expect(canApply("RUNNING", "resume")).toBe(false);
    expect(canApply("SCHEDULED", "delete")).toBe(false);
    expect(targetStatus("pause")).toBe("PAUSED");
  });
  it("classifies send errors", () => {
    expect(classifySendError({ responseCode: 550 })).toBe("hard");
    expect(classifySendError({ rejected: ["a@b.c"] })).toBe("hard");
    expect(classifySendError({ responseCode: 451 })).toBe("transient");
    expect(classifySendError({ code: "ETIMEDOUT" })).toBe("transient");
    expect(classifySendError({ code: "EAUTH", responseCode: 535 })).toBe("transient");
  });
  it("limits the memory token bucket", () => {
    resetRateLimit();
    const t = 1_000_000;
    expect(takeFromMemory("w", 60, 100, t)).toBe(60);
    expect(takeFromMemory("w", 60, 100, t)).toBe(0);
    expect(takeFromMemory("w", 60, 100, t + 2_000)).toBe(2);
  });
});
