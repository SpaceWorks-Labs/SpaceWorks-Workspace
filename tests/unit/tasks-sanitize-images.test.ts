import { describe, expect, it } from "vitest";
import { sanitizeDescription } from "@/lib/tasks/sanitize";

describe("description sanitiser and images", () => {
  it("keeps an image from our file route and its alt text", () => {
    expect(sanitizeDescription('<p>Wiring</p><img src="/api/files/abc123" alt="Wiring diagram">')).toBe('<p>Wiring</p><img src="/api/files/abc123" alt="Wiring diagram" />');
  });
  it("drops images from anywhere else, and unsafe attributes", () => {
    const html = '<p>Hi</p><img src="https://evil.test/x.png"><img src="data:image/png;base64,AAAA"><img src="//evil.test/x.png"><img src="/api/files/ok1" onerror="alert(1)" srcset="a.png">';
    expect(sanitizeDescription(html)).toBe('<p>Hi</p><img src="/api/files/ok1" />');
  });
  it("keeps a description that is only an image", () => {
    expect(sanitizeDescription('<img src="/api/files/only">')).toBe('<img src="/api/files/only" />');
  });
  it("still drops an empty description and script content", () => {
    expect(sanitizeDescription("<p> </p>")).toBeNull();
    expect(sanitizeDescription('<img src="https://evil.test/x.png">')).toBeNull();
    expect(sanitizeDescription('<p>a</p><script>alert(1)</script>')).toBe("<p>a</p>");
  });
});
